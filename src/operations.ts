import type {AgentPermissionResponse} from '@getpaseo/protocol/agent-types';
import {exact,object,text,LIMITS} from './limits.js';
import {decode,openEnvelope,sealEnvelope,validateEnvelope,type Envelope} from './crypto.js';
import {OperationJournal,type ReceiptState,type Occurrence} from './journal.js';
import {occurrenceBinding} from './bindings.js';
import {validatePermissionInput} from './permission.js';
import type {Pair} from './config.js';
import {evidenceForCommand,type Evidence} from './evidence.js';
export type Command={type:'send';agentId:string;text:string;messageId:string}|{type:'permission';agentId:string;requestId:string;requestBinding:string;response:AgentPermissionResponse};
export interface PendingRequest{id:string;kind?:string;requestBinding?:string;occurrence?:Occurrence;actions?:{id:string;behavior:string}[];input?:unknown;suggestions?:unknown[]}
export interface CurrentAgent{id:string;pendingPermissions?:PendingRequest[]}
export interface OfficialOperations{current(id:string):Promise<CurrentAgent|null>;send(c:Extract<Command,{type:'send'}>):Promise<void>;permission(c:Extract<Command,{type:'permission'}>):Promise<void>;reconcile(c:Command,pair?:Pick<Pair,'pairId'|'rootKey'>):Promise<ReceiptState|null>;reconcileEvidence?(evidence:Evidence,pair:Pick<Pair,'pairId'|'rootKey'>):Promise<ReceiptState|null>;requestContext?():{serverId:string;generation:string}}
export interface OperationCloud{dispatch(id:string):Promise<{dispatchAllowed:boolean}>;receipt(id:string,body:{state:ReceiptState;revision:number;envelope:Envelope}):Promise<unknown>}
export interface OperationContext{pair:Pick<Pair,'pairId'|'rootKey'|'hostToken'|'active'>;journal:OperationJournal;official:OfficialOperations;cloud:OperationCloud;clock?:()=>number}
export function parseCommand(value:unknown,id:string):Command{
 const c=object(value);text(c.agentId);if(c.type==='send'){exact(c,['type','agentId','text','messageId']);text(c.text,60000);if(c.messageId!==id)throw Error('MESSAGE_ID_MISMATCH')}
 else if(c.type==='permission'){exact(c,['type','agentId','requestId','requestBinding','response']);text(c.requestId);decode(c.requestBinding,32);const r=object(c.response);
 if(r.behavior==='allow'){exact(r,['behavior','selectedActionId','updatedInput','updatedPermissions']);if(r.updatedInput!==undefined)object(r.updatedInput);if(r.updatedPermissions!==undefined&&(!Array.isArray(r.updatedPermissions)||r.updatedPermissions.length>20||r.updatedPermissions.some(v=>!v||typeof v!=='object'||Array.isArray(v))))throw Error('INVALID_PERMISSIONS')}
 else if(r.behavior==='deny'){exact(r,['behavior','selectedActionId','message','interrupt']);if(r.message!==undefined)text(r.message,8192);if(r.interrupt!==undefined&&typeof r.interrupt!=='boolean')throw Error('INVALID_RESPONSE')}
 else throw Error('INVALID_RESPONSE');if(r.selectedActionId!==undefined)text(r.selectedActionId);
 }else throw Error('UNSUPPORTED_COMMAND');if(Buffer.byteLength(JSON.stringify(c))>LIMITS.plainBytes)throw Error('COMMAND_LIMIT');return c as Command;
}
export function validateCommand(value:unknown,id:string,current:CurrentAgent|null):Command{
 const c=parseCommand(value,id);if(!current||current.id!==c.agentId)throw Error('AGENT_NOT_CURRENT');if(c.type==='permission'){
 const request=current.pendingPermissions?.find(r=>r.id===c.requestId);if(!request||request.requestBinding!==c.requestBinding)throw Error('STALE_REQUEST_INSTANCE');
 const action=c.response.selectedActionId;if(!request.actions?.length||!action||!request.actions.some(a=>a.id===action&&a.behavior===c.response.behavior))throw Error('STALE_ACTION');
 validatePermissionInput(request,c.response);
 }return c;
}
export async function boundCurrent(ctx:Pick<OperationContext,'pair'|'journal'|'official'>,agentId:string):Promise<CurrentAgent|null>{const current=await ctx.official.current(agentId);if(!current)return null;const source=ctx.official.requestContext?.();if(!source)return current;const requests=current.pendingPermissions||[];ctx.journal.syncRequests(source.serverId,agentId,source.generation,requests);return {...current,pendingPermissions:await Promise.all(requests.map(async r=>{const occurrence=ctx.journal.currentOccurrence(source.serverId,agentId,r.id);if(!occurrence)return {...r,requestBinding:undefined};return {...r,occurrence,requestBinding:await occurrenceBinding(ctx.pair,occurrence)}}))};}
async function outcome(ctx:OperationContext,e:Pick<Envelope,'pairId'|'id'|'expiresAt'>,state:ReceiptState,now:number,code?:string){
 const old=ctx.journal.get(e.pairId,e.id)!;if(old.state==='accepted'&&state==='unknown')state='accepted';if(old.state==='resolved'||old.state==='rejected')state=old.state;
 if(old.receipt&&old.state===state){await ctx.cloud.receipt(e.id,{state,revision:old.revision,envelope:old.receipt});ctx.journal.receiptSent(e.pairId,e.id,old.revision);return}
 if(now>=e.expiresAt+LIMITS.retentionMs)return;const revision=old.revision+1;
 const envelope=await sealEnvelope(decode(ctx.pair.rootKey,32),{version:1,pairId:e.pairId,id:e.id,channel:'receipt',issuedAt:now,expiresAt:now+LIMITS.snapshotMs},{operationId:e.id,state,revision,...(code?{code}:{})});ctx.journal.outcome(e.pairId,e.id,state,envelope,code,revision);await ctx.cloud.receipt(e.id,{state,revision,envelope});ctx.journal.receiptSent(e.pairId,e.id,revision);
}
/** Read-only recovery, including after command payload expiry or pairing revoke. */
export async function reconcileJournal(ctx:OperationContext,now=Date.now()){
 let failed=false;for(const record of ctx.journal.pending(ctx.pair.pairId)){if(record.state==='prepared')continue;try{const state=record.evidence&&ctx.official.reconcileEvidence?await ctx.official.reconcileEvidence(record.evidence,ctx.pair):null;await outcome(ctx,record,state||'unknown',now,state?undefined:'UNCONFIRMED')}catch{failed=true}finally{ctx.journal.reconciled(record.pairId,record.id,now)}}return failed;
}
export async function executeOperation(ctx:OperationContext,input:unknown,now?:number){
 const clock=ctx.clock||(now===undefined?Date.now:()=>now!);now=now??clock();
 const e=validateEnvelope(input,now);if(e.channel!=='command'||e.pairId!==ctx.pair.pairId||!ctx.pair.active)throw Error('PAIR_NOT_ACTIVE');
 const value=await openEnvelope(decode(ctx.pair.rootKey,32),e,now);const command=parseCommand(value,e.id);const {record,fresh}=ctx.journal.prepare(e);
 if(fresh)ctx.journal.evidence(e.pairId,e.id,evidenceForCommand(command,ctx.official.requestContext?.().serverId||''));
 if(!fresh){if(record.state==='prepared')return;if(record.receipt&&(record.state==='accepted'||record.state==='resolved'||record.state==='rejected')){await ctx.cloud.receipt(e.id,{state:record.state,revision:record.revision,envelope:record.receipt});return}const reconciled=await ctx.official.reconcile(command,ctx.pair);await outcome(ctx,e,reconciled||'unknown',now,reconciled?undefined:'UNCONFIRMED');return;}
 if(ctx.journal.blocked(e.pairId,e.id))return;
 const current=await boundCurrent(ctx,command.agentId);let invalid=false;try{validateCommand(value,e.id,current)}catch{invalid=true}
 if(command.type==='permission'){const occurrence=current?.pendingPermissions?.find(r=>r.id===command.requestId)?.occurrence;if(occurrence)ctx.journal.evidenceOccurrence(e.pairId,e.id,occurrence.occurrenceId)}
 if(e.expiresAt<=clock()||ctx.journal.blocked(e.pairId,e.id))return;
 // Irrevocable local commit before cloud dispatch. Recovery cannot reacquire or replay it.
 ctx.journal.dispatched(e.pairId,e.id);let boundary;try{boundary=await ctx.cloud.dispatch(e.id)}catch{await outcome(ctx,e,'unknown',clock(),'DISPATCH_UNCONFIRMED');return}
 if(!boundary.dispatchAllowed){await outcome(ctx,e,'unknown',clock(),'DISPATCH_DENIED');return}
 if(e.expiresAt<=clock()||ctx.journal.blocked(e.pairId,e.id)){await outcome(ctx,e,'rejected',clock(),'EXPIRED_OR_LOCALLY_REVOKED');return}
 if(invalid){await outcome(ctx,e,'rejected',clock(),'STALE_OR_INVALID_REQUEST');return}
 let refreshed;try{refreshed=await boundCurrent(ctx,command.agentId)}catch{await outcome(ctx,e,'rejected',clock(),'OFFICIAL_UNAVAILABLE');return}
 try{validateCommand(value,e.id,refreshed)}catch{await outcome(ctx,e,'rejected',clock(),'STALE_OR_INVALID_REQUEST');return}
 if(command.type==='permission'&&ctx.official.requestContext){const occurrence=refreshed?.pendingPermissions?.find(r=>r.id===command.requestId)?.occurrence;if(!occurrence||!ctx.journal.isCurrent(occurrence)){await outcome(ctx,e,'rejected',clock(),'STALE_REQUEST_INSTANCE');return}}
 if(e.expiresAt<=clock()||ctx.journal.blocked(e.pairId,e.id)){await outcome(ctx,e,'rejected',clock(),'EXPIRED_OR_LOCALLY_REVOKED');return}
 let state:ReceiptState;let code:string|undefined;
 try{if(command.type==='send'){await ctx.official.send(command);state='accepted'}else{await ctx.official.permission(command);state='resolved'}}catch{state=await ctx.official.reconcile(command,ctx.pair).catch(()=>null)||'unknown';if(state==='unknown')code='OFFICIAL_UNCONFIRMED'}
 // Receipt transport failure cannot erase a separately persisted positive admission fact.
 await outcome(ctx,e,state,clock(),code);
}
