import {randomUUID} from 'node:crypto';
import {decode,openEnvelope,presenceTopic,sealEnvelope,validateEnvelope,type Envelope} from './crypto.js';
import {exact,LIMITS,object,text,UUID} from './limits.js';
import type {Pair} from './config.js';
import {CloudError,type CloudClient} from './cloud-client.js';

export interface ActivityTask {
 agentId:string;title:string|null;status:string;updatedAt:string;
 requiresAttention:boolean;attentionReason:string|null;
 provider?:string;createdAt?:string|null;
 lastUserMessageAt?:string|null;activeTurnStartedAt?:string|null;cwd?:string|null;
 pendingRequests?:readonly {requestId:string}[];
}
export interface ActivitySnapshot {daemonServerId:string;hostName:string;measuredAt:number;tasks:readonly ActivityTask[];usage:unknown}
export interface ActivitySubscription {id:string;registrationId:string;topic:string;interest:Envelope;expiresAt:number}
export interface ActivityState {
 version:1;subscriptionId:string;daemonServerId:string;agentId:string;title:string;hostName:string;
 phase:'running'|'waiting'|'finished'|'error'|'idle';startedAt:number|null;
 measuredAt:number;expiresAt:number;requiresAttention:boolean;isTerminal:boolean;
}
type ActivityCloud=Pick<CloudClient,'activities'|'activityState'>;
type Publication={fingerprint:string;body:{registrationId:string;topic:string;event:'update'|'end';envelope:Envelope};acknowledged:boolean};
type AuthenticatedInterest=ActivitySubscription&{agentId:string};
type PairState={lastPoll:number;lastTerminalMeasurement:number;context:string;cursor:number;subscriptions:AuthenticatedInterest[];publications:Map<string,Publication>};
export interface ActivityPassOptions {signal?:AbortSignal;terminalOnly?:boolean}

/** Do not make absence from a bounded recent-task list a terminal event. */
export function taskActivityState(snapshot:ActivitySnapshot,task:ActivityTask,subscriptionId:string,expiresAt:number):ActivityState {
 let phase:ActivityState['phase']='idle';
 // A running turn supersedes an old attention flag retained by the daemon.
 if(task.status==='error')phase='error';
 else if(task.status==='closed')phase='finished';
 else if(task.requiresAttention&&task.attentionReason==='permission')phase='waiting';
 else if(task.status==='running'||task.status==='initializing')phase='running';
 else if(task.requiresAttention&&task.attentionReason==='error')phase='error';
 else if(task.requiresAttention&&task.attentionReason==='finished')phase='finished';
 const candidate=Date.parse(task.activeTurnStartedAt||task.lastUserMessageAt||'');
 const startedAt=Number.isSafeInteger(candidate)&&candidate>=0&&candidate<=snapshot.measuredAt?candidate:null;
 return {version:1,subscriptionId,daemonServerId:snapshot.daemonServerId,agentId:task.agentId,
  title:(task.title||'').slice(0,160),hostName:snapshot.hostName.slice(0,80),phase,startedAt,
  measuredAt:snapshot.measuredAt,expiresAt,requiresAttention:task.requiresAttention,isTerminal:phase==='finished'||phase==='error'};
}
function semanticState(state:ActivityState){const {measuredAt,expiresAt,...semantic}=state;return JSON.stringify(semantic)}
function usageValues(value:unknown):unknown {
 if(Array.isArray(value))return value.map(usageValues);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='fetchedAt').map(([key,item])=>[key,usageValues(item)]));
 return value;
}
/** Keyed opaque equality token; no raw task, usage, or title enters cloud metadata. */
export async function widgetFingerprint(pair:Pick<Pair,'pairId'|'rootKey'>,snapshot:ActivitySnapshot){
 const tasks=snapshot.tasks.map(task=>({agentId:task.agentId,provider:task.provider??null,createdAt:task.createdAt??null,title:task.title,status:task.status,
  requiresAttention:task.requiresAttention,attentionReason:task.attentionReason,
  lastUserMessageAt:task.lastUserMessageAt??null,activeTurnStartedAt:task.activeTurnStartedAt??null,
  cwd:task.cwd??null,pendingRequestIds:task.pendingRequests?.map(p=>p.requestId).sort()??[]})).sort((a,b)=>a.agentId.localeCompare(b.agentId));
 return presenceTopic(decode(pair.rootKey,32),pair.pairId,JSON.stringify(['widgetSnapshot',{daemonServerId:snapshot.daemonServerId,hostName:snapshot.hostName,tasks,usage:usageValues(snapshot.usage)}]));
}
export async function openActivityInterest(pair:Pick<Pair,'pairId'|'rootKey'>,value:unknown,daemonServerId:string,now:number):Promise<ActivitySubscription&{agentId:string}> {
 const row=object(value);exact(row,['id','registrationId','topic','interest','expiresAt']);
 if(Object.keys(row).length!==5||typeof row.id!=='string'||!UUID.test(row.id)||typeof row.registrationId!=='string'||!UUID.test(row.registrationId)||typeof row.topic!=='string'||!Number.isSafeInteger(row.expiresAt))throw Error('INVALID_ACTIVITY_SUBSCRIPTION');
 decode(row.topic,32);
 const interest=validateEnvelope(row.interest,now);
 if(interest.pairId!==pair.pairId||interest.id!==row.id||interest.channel!=='activityInterest'||row.expiresAt!==interest.expiresAt)throw Error('ACTIVITY_INTEREST_CONTEXT');
 const plain=object(await openEnvelope(decode(pair.rootKey,32),interest,now));exact(plain,['version','subscriptionId','daemonServerId','agentId']);
 if(Object.keys(plain).length!==4||plain.version!==1||plain.subscriptionId!==row.id||plain.daemonServerId!==daemonServerId)throw Error('ACTIVITY_INTEREST_CONTEXT');
 const agentId=text(plain.agentId,256);
 if(await presenceTopic(decode(pair.rootKey,32),pair.pairId,agentId)!==row.topic)throw Error('ACTIVITY_TOPIC_MISMATCH');
 return {id:row.id,registrationId:row.registrationId,topic:row.topic,interest,expiresAt:interest.expiresAt,agentId};
}

/** One bounded pass on the existing snapshot cadence. Never sends official mutations.
 * Lost acknowledgements retry the same ciphertext; no alert/presence precondition.
 */
export class ActivityPublisher {
 private pairs=new Map<string,PairState>();
 retain(pairIds:readonly string[]){const retained=new Set(pairIds);for(const id of this.pairs.keys())if(!retained.has(id))this.pairs.delete(id)}
 async publish(pair:Pair,cloud:ActivityCloud,snapshot:ActivitySnapshot,now=Date.now(),readTask?:(agentId:string,signal?:AbortSignal)=>Promise<ActivityTask|null>,options:ActivityPassOptions={}):Promise<void>{
  const context=JSON.stringify([snapshot.daemonServerId,pair.rootKey]);let state=this.pairs.get(pair.pairId);
  if(!state||state.context!==context){state={lastPoll:-Infinity,lastTerminalMeasurement:-Infinity,context,cursor:0,subscriptions:[],publications:new Map()};this.pairs.set(pair.pairId,state)}
  const current=()=>{options.signal?.throwIfAborted();if(this.pairs.get(pair.pairId)!==state)throw Error('ACTIVITY_PAIR_RETIRED')};
  current();
  if(options.terminalOnly){if(state.lastTerminalMeasurement>=snapshot.measuredAt)return;state.lastTerminalMeasurement=snapshot.measuredAt}
  if(!options.terminalOnly){
   if(now-state.lastPoll<30000)return;
   state.lastPoll=now;
   const rows=await cloud.activities(options.signal);current();if(rows.length>8)throw Error('ACTIVITY_SUBSCRIPTION_LIMIT');
   const subscriptions:AuthenticatedInterest[]=[];
   for(const row of rows){try{subscriptions.push(await openActivityInterest(pair,row,snapshot.daemonServerId,now))}catch{/* Unauthenticated read-only interests never become authority. */}current()}
   state.subscriptions=subscriptions;
  }
  const subscriptions=state.subscriptions.filter(row=>row.expiresAt>now);
  const ids=new Set(subscriptions.map(row=>row.id));for(const id of state.publications.keys())if(!ids.has(id))state.publications.delete(id);
  let failure:unknown;
  const ordered=[...subscriptions.slice(state.cursor),...subscriptions.slice(0,state.cursor)];
  for(const subscription of ordered){
   try{
    current();
    state.cursor=(subscriptions.indexOf(subscription)+1)%Math.max(1,subscriptions.length);
    let publication=state.publications.get(subscription.id);
    if(publication&&(publication.body.registrationId!==subscription.registrationId||!publication.acknowledged&&publication.body.envelope.expiresAt<=now))publication=undefined;
    let task=snapshot.tasks.find(task=>task.agentId===subscription.agentId);
    // Terminal recovery uses only cached authenticated interests and fresh source
    // facts. Normal discovery/fallback work cannot consume its reserved path.
    if(!task&&readTask&&!options.terminalOnly)task=await readTask(subscription.agentId,options.signal)??undefined;
    current();if(!task||task.agentId!==subscription.agentId)continue;
    const expiresAt=Math.min(snapshot.measuredAt+LIMITS.snapshotMs,subscription.expiresAt);
    if(expiresAt<=now)continue;
    const payload=taskActivityState(snapshot,task,subscription.id,expiresAt),fingerprint=semanticState(payload);
    if(options.terminalOnly&&!payload.isTerminal)continue;
    const renew=publication?.acknowledged&&!payload.isTerminal&&publication.body.envelope.expiresAt-now<=120000&&snapshot.measuredAt>publication.body.envelope.issuedAt;
    if(publication?.fingerprint===fingerprint&&publication.acknowledged&&!renew)continue;
    // Unknown admissions preserve immutable bytes. Fresh acknowledged running
    // state renews at most once per eight minutes, before the ten-minute expiry.
    if(!publication||publication.fingerprint!==fingerprint||renew){
     const envelope=await sealEnvelope(decode(pair.rootKey,32),{version:1,pairId:pair.pairId,id:randomUUID(),channel:'activityState',issuedAt:snapshot.measuredAt,expiresAt},payload);
     current();if(Buffer.byteLength(JSON.stringify(envelope))>3000)throw Error('ACTIVITY_PAYLOAD_LIMIT');
     publication={fingerprint,body:{registrationId:subscription.registrationId,topic:subscription.topic,event:payload.isTerminal?'end':'update',envelope},acknowledged:false};
     state.publications.set(subscription.id,publication);
    }
    current();if(!publication.acknowledged){await cloud.activityState(subscription.id,publication.body,options.signal);current();publication.acknowledged=true}
   }catch(error){
    if(options.signal?.aborted)throw error;
    // An authenticated rejection invalidates this cached target, not a new
    // registration. Do not repeatedly consume recovery on a retired interest.
    if(error instanceof CloudError&&[404,409].includes(error.status)){state.subscriptions=state.subscriptions.filter(row=>row.id!==subscription.id);state.publications.delete(subscription.id)}
    failure??=error;
   }
  }
  if(failure)throw failure;
 }
}

/** One owned optional lane, independent of the critical command/control loop.
 * Network requests receive cancellation; SDK fallback reads have a 250ms timeout.
 * close joins the real work rather than abandoning a raced promise.
 */
export class ActivityWorkLane {
 private running:Promise<void>|undefined;
 private controller:AbortController|undefined;
 private closed=false;
 start(work:(signal:AbortSignal)=>Promise<void>,onError:(error:unknown)=>void,parentSignal?:AbortSignal):boolean {
  if(this.closed||this.running||parentSignal?.aborted)return false;
  const controller=new AbortController();this.controller=controller;
  const signal=AbortSignal.any([controller.signal,...(parentSignal?[parentSignal]:[])]);
  const timer=setTimeout(()=>controller.abort(Error('ACTIVITY_PASS_DEADLINE')),2000);timer.unref();
  this.running=Promise.resolve().then(()=>work(signal)).catch(error=>{if(!signal.aborted)onError(error)}).finally(()=>{
   clearTimeout(timer);if(this.controller===controller){this.running=undefined;this.controller=undefined}
  });
  return true;
 }
 async close(){this.closed=true;this.controller?.abort(Error('ACTIVITY_LANE_CLOSED'));await this.running}
}
