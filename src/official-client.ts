// MoRemote adaptation: bounded read-only local credential selection and independent identity.
// Upstream portions: Copyright (c) 2025-present Mohamed Boudra, Apache-2.0.
// Changed for this companion; retained release license/provenance: licenses/Paseo-0.15.3.txt and NOTICE.
import { readFileSync,statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import { createHostClient, parseHostTarget } from '@getpaseo/client/node';
import type { DaemonClient } from '@getpaseo/client/internal/daemon-client';
import { normalizeLoopbackToLocalhost, parseConnectionUri } from '@getpaseo/protocol/daemon-endpoints';
import type { ServerInfoStatusPayload,AgentSnapshotPayload,ProviderUsage } from '@getpaseo/protocol/messages';
import type { Config,Pair } from './config.js';
import type { Command, OfficialOperations } from './operations.js';
import { canonical,type ReceiptState,type OperationJournal,type Occurrence } from './journal.js';
import { occurrenceBinding } from './bindings.js';
import { LIMITS } from './limits.js';
import {evidenceForCommand,contentDigest,type Evidence} from './evidence.js';
export interface Attention{agentId:string;requestId?:string;requestBinding?:string;occurrence?:Occurrence;kind:'finished'|'question'|'permission'|'error';timestamp:number}
type TerminalAttention={agentId:string;kind:'finished'|'error';timestamp:number;observedOrder:number};
type TerminalRead={event:TerminalAttention;valid:boolean;next:TerminalAttention|null};
type RequestRead={agentId?:string;observedOrder:number;stale:Set<string>};
function boundedFile(path:string,max:number){if(statSync(path).size>max)throw Error('OFFICIAL_FILE_LIMIT');const raw=readFileSync(path,'utf8');if(Buffer.byteLength(raw)>max)throw Error('OFFICIAL_FILE_LIMIT');return raw}
function normalizeTarget(target:string):string|null{try{const t=target.trim();if(t.startsWith('tcp://')){const p=parseConnectionUri(t);return normalizeLoopbackToLocalhost(p.isIpv6?'['+p.host+']:'+p.port:p.host+':'+p.port)}if(t.startsWith('unix://')||t.startsWith('pipe://'))return t;if(t.startsWith('/'))return 'unix://'+t;if(t.startsWith('\\\\.\\pipe\\'))return 'pipe://'+t;if(/^\d+$/.test(t))return 'localhost:'+t;return normalizeLoopbackToLocalhost(t)}catch{return null}}
export function localListen(home:string){const lock=JSON.parse(boundedFile(join(home,'paseo.pid'),65536));if(typeof lock.listen!=='string'||lock.listen.length>4096)throw Error('INVALID_OFFICIAL_PID');return lock.listen as string}
export function readLocalCredentialForTarget(home:string,target:string){try{const a=normalizeTarget(target),b=normalizeTarget(localListen(home));if(!a||!b||a!==b)return undefined;const token=boundedFile(join(home,'local-credential'),256).trim();return /^[A-Za-z0-9_-]{43}$/.test(token)?token:undefined}catch{return undefined}}
export function projectTask(a:AgentSnapshotPayload){return {agentId:a.id,provider:a.provider,title:a.title?.slice(0,160)||null,status:a.status,createdAt:a.createdAt,updatedAt:a.updatedAt,lastUserMessageAt:a.lastUserMessageAt,activeTurnStartedAt:a.activeTurn?.startedAt??null,cwd:a.cwd?.slice(0,1024)||null,requiresAttention:a.requiresAttention||false,attentionReason:a.attentionReason||null,pendingRequests:a.pendingPermissions.slice(0,10).map(request=>({requestId:request.id,request}))}}
export interface OfficialUsage {fetchedAt:string;providers:ProviderUsage[]}
export function projectUsage(u:OfficialUsage){return {fetchedAt:u.fetchedAt,providers:u.providers.slice(0,16).map(p=>({providerId:p.providerId.slice(0,128),displayName:p.displayName.slice(0,128),status:p.status,fetchedAt:p.fetchedAt||u.fetchedAt,windows:p.windows.slice(0,8).map(w=>({id:w.id.slice(0,128),label:w.label.slice(0,128),usedPct:w.usedPct??null,remainingPct:w.remainingPct??null,resetsAt:w.resetsAt??null})),balances:p.balances?.slice(0,8).map(b=>({id:b.id.slice(0,128),label:b.label.slice(0,128),used:b.used??null,remaining:b.remaining??null,limit:b.limit??null,unit:b.unit,resetsAt:b.resetsAt??null}))}))}}
export class OfficialClient implements OfficialOperations{
 readonly sdk:DaemonClient;
 private subscription:ReturnType<DaemonClient['observeEvents']>|undefined;
 readonly generation=randomUUID();
 private serverId='';
 private callbacks=new Set<(event:Attention)=>void>();
 private unlisten:(()=>void)|undefined;
 private terminalReads=new Map<string,TerminalRead>();
 private requestReads=new Set<RequestRead>();
 private observationOrder=0;
 constructor(readonly config:Config,private journal?:OperationJournal){const target=config.target||localListen(config.paseoHome);const password=parseHostTarget(target).password||process.env.PASEO_PASSWORD;
 this.sdk=createHostClient(target,{clientId:config.clientId,clientType:'cli',appVersion:'moremote-cli/0.1.0',...(password?{password}:{localCredential:()=>readLocalCredentialForTarget(config.paseoHome,target)}),reconnect:{enabled:false},connectTimeoutMs:15000,logger:{debug(){},info(){},warn(){},error(){}}});}
 async connect(){await this.sdk.connect();const info=this.info();if(!info||info.features?.explicitEventSubscriptions!==true){await this.sdk.close();throw Error('EXPLICIT_SUBSCRIPTIONS_REQUIRED')}if(this.config.daemonServerId&&info.serverId!==this.config.daemonServerId){await this.sdk.close();throw Error('DAEMON_IDENTITY_CHANGED')}
 this.serverId=info.serverId;this.journal?.retireGeneration(info.serverId,this.generation);
 this.unlisten=this.sdk.subscribeRawMessages(message=>{
 if(message.type==='agent_attention_required'){const p=message.payload;if(p.reason!=='permission'){
 const event:TerminalAttention={agentId:p.agentId,kind:p.reason,timestamp:Date.parse(p.timestamp),observedOrder:++this.observationOrder};
 if(!Number.isSafeInteger(event.timestamp)||event.timestamp<0)return;
 const pending=this.terminalReads.get(p.agentId);
 if(pending){
 const latest=pending.next||pending.event;
 if(event.timestamp<latest.timestamp||event.timestamp===latest.timestamp&&event.kind===latest.kind)return;
 pending.next=event;
 }else this.readTerminal(event);
 }}
 if(message.type==='agent_permission_request'){const p=message.payload;this.fenceRequestReads(p.agentId,++this.observationOrder);void this.readCurrent(p.agentId,agent=>{const r=agent?.pendingPermissions?.find(r=>r.id===p.request.id);if(r)this.emitRequest(p.agentId,r)}).catch(()=>{})}
 if(message.type==='agent_permission_resolved'){const p=message.payload;this.fenceRequestReads(p.agentId,++this.observationOrder);this.journal?.resolution(this.serverId,p.agentId,p.requestId,this.generation,p.resolution)}
 });
 this.subscription=this.sdk.observeEvents(['agent_attention_required','agent_permission_request','agent_permission_resolved','status.server_info'],{notifications:false});await this.subscription.ready;}
 info():ServerInfoStatusPayload|null{return this.sdk.getLastServerInfoMessage()}
 private emit(event:Attention){if(Number.isSafeInteger(event.timestamp)&&event.timestamp>=0)for(const cb of this.callbacks)cb(event)}
 private emitRequest(agentId:string,request:AgentSnapshotPayload['pendingPermissions'][number]){
  const occurrence=this.journal?.currentOccurrence(this.serverId,agentId,request.id);
  if(this.journal&&!occurrence)return;
  // Pending requests have independent lifetimes. The global attention clock can
  // still describe an older finished turn; never use it to expire a new request.
  // Runtime journals retain one observation clock per exact current occurrence.
  this.emit({agentId,requestId:request.id,occurrence,kind:request.kind==='question'?'question':'permission',timestamp:occurrence?.createdAt??Date.now()});
 }
 private readTerminal(event:TerminalAttention){
 const read:TerminalRead={event,valid:true,next:null};this.terminalReads.set(event.agentId,read);
 const complete=(agent:AgentSnapshotPayload|null)=>{
 if(this.terminalReads.get(event.agentId)!==read)return;
 this.terminalReads.delete(event.agentId);
 if(read.next){this.readTerminal(read.next);return}
 if(!read.valid)return;
 const timestamp=this.terminalTimestamp(agent,event);if(timestamp!==null)this.emit({agentId:event.agentId,kind:event.kind,timestamp});
 };
 // At most one read and one latest event per agent; no retry without a new event.
 // Terminal hydration is read-only; stale replies must not resync requests.
 void this.sdk.fetchAgent({agentId:event.agentId,timeout:15000}).then(value=>complete(value?.agent||null)).catch(()=>complete(null));
 }
 private terminalTimestamp(agent:AgentSnapshotPayload|null,event:TerminalAttention){
 if(!agent||agent.id!==event.agentId||!agent.requiresAttention||agent.attentionReason!==event.kind||agent.activeTurn)return null;
 if(event.kind==='finished'?agent.status!=='idle'&&agent.status!=='closed':agent.status!=='error')return null;
 const timestamp=Date.parse(agent.attentionTimestamp||'');
 // Paseo sets attention before broadcasting; the raw clock is delivery time,
 // not identity. A later attention or user turn cannot belong to this event.
 if(!Number.isSafeInteger(timestamp)||timestamp<0||timestamp>event.timestamp||agent.lastUserMessageAt&&Date.parse(agent.lastUserMessageAt)>event.timestamp)return null;
 return timestamp;
 }
 private fenceTerminalRead(agentId:string,agent:AgentSnapshotPayload|null,observationOrder:number){
 const pending=this.terminalReads.get(agentId);if(!pending)return;
 // A request begun before an event cannot retire that newer event, even if
 // its older server snapshot arrives later. Keep the slot until it settles.
 if(observationOrder>=pending.event.observedOrder&&this.terminalTimestamp(agent,pending.event)===null)pending.valid=false;
 if(pending.next&&observationOrder>=pending.next.observedOrder&&this.terminalTimestamp(agent,pending.next)===null)pending.next=null;
 }
 onAttention(callback:(event:Attention)=>void){this.callbacks.add(callback);return ()=>{this.callbacks.delete(callback)}}
 requestContext(){return {serverId:this.serverId,generation:this.generation,journal:this.journal}}
 private beginRequestRead(agentId?:string):RequestRead{const read={agentId,observedOrder:++this.observationOrder,stale:new Set<string>()};this.requestReads.add(read);return read}
 private fenceRequestReads(agentId:string,observedOrder:number){
  // Track only in-flight reads, not an unbounded history of observed agents.
  for(const read of this.requestReads)if(read.observedOrder<observedOrder&&(read.agentId===undefined||read.agentId===agentId))read.stale.add(agentId);
 }
 private acceptRequestRead(read:RequestRead,agentId:string){
  if(!this.requestReads.has(read)||read.stale.has(agentId))return false;
  this.fenceRequestReads(agentId,read.observedOrder);return true;
 }
 private async readCurrent(agentId:string,observe?:(agent:AgentSnapshotPayload|null)=>void){
  const read=this.beginRequestRead(agentId);
  try{
   const value=await this.sdk.fetchAgent({agentId,timeout:15000});
   if(!this.acceptRequestRead(read,agentId))return null;
   const agent=value?.agent||null;this.fenceTerminalRead(agentId,agent,read.observedOrder);this.journal?.syncRequests(this.serverId,agentId,this.generation,agent?.pendingPermissions||[]);
   // Observation, journal synchronization and notification share one fence.
   observe?.(agent);return agent;
  }finally{this.requestReads.delete(read)}
 }
 async current(agentId:string){return this.readCurrent(agentId)}
 async activityTask(agentId:string,signal?:AbortSignal){signal?.throwIfAborted();const observationOrder=++this.observationOrder;const value=await this.sdk.fetchAgent({agentId,timeout:250});signal?.throwIfAborted();this.fenceTerminalRead(agentId,value?.agent||null,observationOrder);return value?.agent?projectTask(value.agent):null}
 async send(command:Extract<Command,{type:'send'}>){if(!this.sdk.isConnected)throw Error('OFFICIAL_DISCONNECTED');await this.sdk.sendAgentMessage(command.agentId,command.text,{messageId:command.messageId})}
 async permission(command:Extract<Command,{type:'permission'}>){if(!this.sdk.isConnected)throw Error('OFFICIAL_DISCONNECTED');const result=await this.sdk.respondToPermissionAndWait(command.agentId,command.requestId,command.response,15000);if(!isDeepStrictEqual(result.resolution,command.response))throw Error('RESOLUTION_MISMATCH')}
 async reconcile(command:Command,pair?:Pick<Pair,'pairId'|'rootKey'>):Promise<ReceiptState|null>{return this.reconcileEvidence(evidenceForCommand(command,this.serverId),pair)}
 async reconcileEvidence(evidence:Evidence,pair?:Pick<Pair,'pairId'|'rootKey'>):Promise<ReceiptState|null>{if(evidence.serverId!==this.serverId)return null;if(evidence.type==='permission'){if(!pair||!this.journal)return null;for(const fact of this.journal.resolutionFacts(this.serverId,evidence.agentId,evidence.requestId))if(await occurrenceBinding(pair,fact)===evidence.requestBinding&&fact.response===evidence.responseDigest)return 'resolved';return null}if(!this.sdk.isConnected)return null;
 const timeline=await this.sdk.fetchAgentTimeline(evidence.agentId,{direction:'tail',projection:'canonical',limit:100,timeout:15000});if(timeline.agentId!==evidence.agentId)return null;
 return timeline.entries.some(e=>e.item.type==='user_message'&&e.item.clientMessageId===evidence.messageId&&contentDigest(e.item.text)===evidence.textDigest)?'accepted':null;}
 async snapshot(){const info=this.info();if(!info)throw Error('OFFICIAL_IDENTITY_UNAVAILABLE');const read=this.beginRequestRead();try{const result=await this.sdk.fetchAgents({page:{limit:LIMITS.tasks},filter:{includeArchived:false,includeInternal:false},sort:[{key:'updated_at',direction:'desc'}],timeout:15000});
 const agents=result.entries.slice(0,LIMITS.tasks).map(entry=>entry.agent).filter(agent=>this.acceptRequestRead(read,agent.id));
 for(const a of agents){this.fenceTerminalRead(a.id,a,read.observedOrder);this.journal?.syncRequests(this.serverId,a.id,this.generation,a.pendingPermissions);this.journal?.syncAttention(a.id,a.requiresAttention===true,a.attentionTimestamp?Date.parse(a.attentionTimestamp):null)}
 for(const a of agents){
  for(const request of a.pendingPermissions)this.emitRequest(a.id,request);
  if(a.requiresAttention&&a.attentionReason&&a.attentionReason!=='permission'&&a.attentionTimestamp)this.emit({agentId:a.id,kind:a.attentionReason,timestamp:Date.parse(a.attentionTimestamp)});
 }
 let usage:unknown=null;if(info.features?.providerUsageList){try{usage=projectUsage(await this.sdk.listProviderUsage())}catch{usage=null}}
 return {version:1,daemonServerId:info.serverId,hostName:(info.hostname||hostname()).slice(0,256),measuredAt:Date.now(),tasks:agents.map(projectTask),usage};}finally{this.requestReads.delete(read)}}
 async close(){this.terminalReads.clear();this.requestReads.clear();this.unlisten?.();await this.subscription?.release().catch(()=>{});await this.sdk.close()}
}
