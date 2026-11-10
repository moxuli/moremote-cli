import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { decode, openEnvelope, sealEnvelope } from './crypto.js';
import { exact, object, UUID, LIMITS } from './limits.js';
import { CloudClient } from './cloud-client.js';
import { saveConfig, type Pair, type Config } from './config.js';
export function tokenHash(token:string){return createHash('sha256').update(token).digest('hex')}
export function makeOffer(apiOrigin:string,now=Date.now()){
 const pair:Pair={pairId:randomUUID(),apiOrigin,rootKey:randomBytes(32).toString('base64url'),hostToken:randomBytes(32).toString('base64url'),enrollmentToken:randomBytes(32).toString('base64url'),expiresAt:now+LIMITS.enrollmentMs,active:false};
 return {pair,offer:{version:1,apiOrigin,pairId:pair.pairId,enrollmentToken:pair.enrollmentToken,rootKey:pair.rootKey,expiresAt:pair.expiresAt}};
}
export async function verifyClaim(pair:Pick<Pair,'pairId'|'rootKey'|'expiresAt'>,pending:unknown,now?:number){
 const clock=now===undefined?Date.now:()=>now!;now=now??clock();
 if(!Number.isSafeInteger(pair.expiresAt)||now>=pair.expiresAt!)throw Error('PAIRING_EXPIRED');
 const p=object(pending);if(typeof p.claimId!=='string'||!UUID.test(p.claimId)||typeof p.phoneTokenHash!=='string'||!/^([a-f0-9]{64})$/.test(p.phoneTokenHash))throw Error('INVALID_CLAIM');
 const envelope=object(p.proof);if(envelope.pairId!==pair.pairId||envelope.id!==p.claimId||envelope.channel!=='enrollment'||Number(envelope.issuedAt)<pair.expiresAt!-LIMITS.enrollmentMs||Number(envelope.expiresAt)>pair.expiresAt!)throw Error('CLAIM_CONTEXT_MISMATCH');const body=object(await openEnvelope(decode(pair.rootKey,32),p.proof,now));exact(body,['type','claimId','phoneTokenHash']);if(body.type!=='phoneHello'||body.claimId!==p.claimId||body.phoneTokenHash!==p.phoneTokenHash)throw Error('CLAIM_PROOF_MISMATCH');if(clock()>=pair.expiresAt!)throw Error('PAIRING_EXPIRED');return {claimId:p.claimId,phoneTokenHash:p.phoneTokenHash};
}
export async function activatePending(config:Config,dir:string,pair:Pair,cloud:CloudClient,daemonServerId:string,hostName=hostname()){
 const result=await cloud.pair();const state=object(result.pair);if(state.state==='revoked')return false;
 if(pair.active)return state.state==='active';if(!Number.isSafeInteger(pair.expiresAt)||Date.now()>=pair.expiresAt!)throw Error('PAIRING_EXPIRED');if(!state.pendingClaim)return false;
 const accepted=await verifyClaim(pair,state.pendingClaim);if(pair.claimId&&(pair.claimId!==accepted.claimId||pair.phoneTokenHash!==accepted.phoneTokenHash))throw Error('CLAIM_REPLACEMENT_REFUSED');
 pair.claimId=accepted.claimId;pair.phoneTokenHash=accepted.phoneTokenHash;pair.daemonServerId=daemonServerId;
 if(!pair.activationProof){const now=Date.now();pair.activationProof=await sealEnvelope(decode(pair.rootKey,32),{version:1,pairId:pair.pairId,id:accepted.claimId,channel:'activation',issuedAt:now,expiresAt:Math.min(pair.expiresAt||now+LIMITS.enrollmentMs,now+LIMITS.enrollmentMs)},{type:'companionHello',...accepted,daemonServerId,hostName:hostName.slice(0,256)})}
 // Bind accepted phone durably before activation; execute only after exact cloud confirmation.
 await saveConfig(dir,config);if(Date.now()>=pair.expiresAt!)throw Error('PAIRING_EXPIRED');await cloud.activate({claimId:accepted.claimId,proof:pair.activationProof});if(Date.now()>=pair.expiresAt!)throw Error('PAIRING_EXPIRED');pair.active=true;delete pair.enrollmentToken;await saveConfig(dir,config);return true;
}
