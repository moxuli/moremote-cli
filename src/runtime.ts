import {randomUUID,createHash} from 'node:crypto';
import {join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {loadConfig,saveConfig,privateDirectory,pruneRetiredPairs,type Pair} from './config.js';
import {OfficialClient,type Attention} from './official-client.js';
import {CloudClient,CloudError} from './cloud-client.js';
import {sealEnvelope,decode,presenceTopic,type Envelope} from './crypto.js';
import {OperationJournal,type Occurrence} from './journal.js';
import {executeOperation,reconcileJournal} from './operations.js';
import {activatePending} from './pairing.js';
import {processControl,retransmitControls} from './controls.js';
import {occurrenceBinding} from './bindings.js';
import {projectSnapshot} from './projection.js';
import {ownRuntime} from './control.js';
import {LIMITS} from './limits.js';
function stableId(value:unknown){const h=createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,32);return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20)}
export async function queueAttention(journal:OperationJournal,pair:Pair,event:Attention&{sourceFingerprint?:string;occurrence?:Occurrence},now=Date.now()){
 if(event.timestamp+LIMITS.snapshotMs<=now||event.timestamp>now+LIMITS.futureMs)return;
 const payload:Attention={agentId:event.agentId,kind:event.kind,timestamp:event.timestamp,...(event.requestId?{requestId:event.requestId}:{}),...(event.requestBinding?{requestBinding:event.requestBinding}:{})};
 const id=stableId([pair.pairId,event.agentId,event.kind,event.requestId||'',event.sourceFingerprint||'',event.requestId&&!event.sourceFingerprint?null:event.timestamp]);const issuedAt=event.timestamp;const envelope=await sealEnvelope(decode(pair.rootKey,32),{version:1,pairId:pair.pairId,id,channel:'attention',issuedAt,expiresAt:issuedAt+LIMITS.snapshotMs},payload);
 const topic=await presenceTopic(decode(pair.rootKey,32),pair.pairId,event.agentId);if(event.occurrence&&!journal.isCurrent(event.occurrence))return;
 journal.queueAttention(pair.pairId,id,envelope.expiresAt,{id,kind:event.kind,topic,envelope},payload);
}
async function boundAttention(journal:OperationJournal,pair:Pair,event:Attention,official:OfficialClient){if(!event.requestId)return event;const occurrence=journal.currentOccurrence(official.requestContext().serverId,event.agentId,event.requestId);if(!occurrence||occurrence.generation!==official.generation)return null;const requestBinding=await occurrenceBinding(pair,occurrence);if(!journal.isCurrent(occurrence))return null;return {...event,occurrence,sourceFingerprint:occurrence.fingerprint,requestBinding}}
async function publishResolutions(journal:OperationJournal,pair:Pair,cloud:CloudClient){for(const event of journal.attentionResolutions(pair.pairId)){try{await cloud.resolveAttention(event.id,event.resolvedAt)}catch(error){if(!(error instanceof CloudError&&error.status===404))throw error}journal.attentionResolutionSent(pair.pairId,event.id)}}
export async function runRuntime(dir:string){
 await privateDirectory(dir);let stopped=false;let official:OfficialClient|undefined;let stage='starting';let lastError:string|null=null;let activePairs=0;
 const controller=new AbortController();const stop=()=>{stopped=true;controller.abort();void official?.sdk.close().catch(()=>{})};const release=await ownRuntime(dir,()=>({stage,lastError,activePairs}),stop);const journal=new OperationJournal(join(dir,'journal.sqlite'));
 const attentionQueue:Attention[]=[];let detach:(()=>void)|undefined;let backoff:number=LIMITS.pollMs;let measuredAt=0;let snapshot:Awaited<ReturnType<OfficialClient['snapshot']>>|undefined;const stateEnvelopes=new Map<string,Envelope>();
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{while(!stopped){try{
 journal.cleanup(Date.now());const config=await loadConfig(dir);let failure:unknown=null;const clouds=new Map<string,CloudClient>();
 // Endpoint revocation must work even when the official daemon is offline.
 if(config.cloudEnabled)for(const pair of config.pairs){if(stopped)break;const revokedAt=journal.revocationTime(pair.pairId);if(revokedAt!==undefined&&pair.revokedAt===undefined){pair.active=false;pair.revokedAt=revokedAt;await saveConfig(dir,config)}const origin=pair.apiOrigin||config.apiOrigin;if(!origin||(!pair.active&&pair.revokedAt===undefined&&pair.expiresAt!==undefined&&pair.expiresAt<=Date.now()))continue;const cloud=new CloudClient(origin,pair.pairId,pair.hostToken,config.allowLoopbackHttp,fetch,controller.signal);try{
 for(const envelope of await cloud.controls()){const state=await processControl({pair,journal,cloud},envelope);if(state==='revoked'){pair.active=false;pair.revokedAt??=journal.revocationTime(pair.pairId)??Date.now();await saveConfig(dir,config)}}
 await retransmitControls({pair,journal,cloud});
 clouds.set(pair.pairId,cloud);
 for(const record of journal.receipts(pair.pairId,Date.now())){try{await cloud.receipt(record.id,{state:record.state as 'accepted'|'resolved'|'rejected'|'unknown',revision:record.revision,envelope:record.receipt!});journal.receiptSent(pair.pairId,record.id,record.revision)}catch(error){failure=error}}
 try{await publishResolutions(journal,pair,cloud)}catch(error){failure=error}
 }catch(error){failure=error}}
 const cleanupAt=Date.now();if(pruneRetiredPairs(config,cleanupAt,journal))await saveConfig(dir,config);journal.cleanupRevocations(config.pairs.map(p=>p.pairId),cleanupAt);
 if(stopped)break;
 if(!official||!official.sdk.isConnected){detach?.();await official?.close().catch(()=>{});stage='connecting';official=new OfficialClient(config,journal);await official.connect();const serverId=official.info()!.serverId;if(!config.daemonServerId){config.daemonServerId=serverId;await saveConfig(dir,config)}detach=official.onAttention(event=>{if(attentionQueue.length<500)attentionQueue.push(event);else lastError='ATTENTION_QUEUE_LIMIT'});measuredAt=0;}
 if(snapshot===undefined||Date.now()-measuredAt>=30000){snapshot=await official.snapshot();measuredAt=snapshot.measuredAt;stateEnvelopes.clear()}
 stage=config.cloudEnabled?'cloud-enabled':'local-only';activePairs=config.pairs.filter(p=>p.active&&!journal.pairRevoked(p.pairId)).length;const events=attentionQueue.splice(0);
 // Persist every active phone's events before the first network send.
 if(config.cloudEnabled)for(const pair of config.pairs.filter(p=>p.active&&!journal.pairRevoked(p.pairId)))for(const event of events){const bound=await boundAttention(journal,pair,event,official);if(bound)await queueAttention(journal,pair,bound)}
 for(const pair of config.pairs){if(stopped)break;const cloud=clouds.get(pair.pairId);if(!cloud)continue;try{
 if(pair.daemonServerId&&pair.daemonServerId!==official.info()!.serverId){if(journal.pairRevoked(pair.pairId))continue;throw Error('PAIR_DAEMON_MISMATCH')}
 // Read-only reconciliation remains available after revoke and original message expiry.
 if(await reconcileJournal({pair,journal,official,cloud,clock:Date.now}))failure=Error('RECEIPT_RECONCILIATION_FAILED');
 if(journal.pairRevoked(pair.pairId))continue;
 const active=await activatePending(config,dir,pair,cloud,official.info()!.serverId,snapshot.hostName);if(!active)continue;
 await publishResolutions(journal,pair,cloud);
 let state=stateEnvelopes.get(pair.pairId);if(!state){const payload=await projectSnapshot(snapshot,pair,journal,official.generation);state=await sealEnvelope(decode(pair.rootKey,32),{version:1,pairId:pair.pairId,id:randomUUID(),channel:'state',issuedAt:snapshot.measuredAt,expiresAt:snapshot.measuredAt+LIMITS.snapshotMs},payload);stateEnvelopes.set(pair.pairId,state)}await cloud.state(state);
 for(const event of events){const bound=await boundAttention(journal,pair,event,official);if(bound)await queueAttention(journal,pair,bound)}
 await publishResolutions(journal,pair,cloud);
 for(const item of journal.attention(pair.pairId,Date.now())){await cloud.attention(item.body);journal.attentionSent(pair.pairId,item.id)}
 for(const envelope of await cloud.commands())if(!stopped){try{await executeOperation({pair,journal,official,cloud,clock:Date.now},envelope)}catch(error){failure=error}}
 }catch(error){failure=error}}
 if(failure)throw failure;lastError=null;backoff=LIMITS.pollMs;
 }catch(error){lastError=error instanceof CloudError?error.code:'COMPANION_CYCLE_FAILED';stage='degraded';backoff=Math.min(backoff*2,LIMITS.maxBackoffMs)}
 await sleep(backoff,undefined,{signal:controller.signal}).catch(()=>{});
 }}finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);detach?.();await official?.close().catch(()=>{});journal.close();await release()}
}
