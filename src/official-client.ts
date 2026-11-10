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
import { canonical,type ReceiptState,type OperationJournal } from './journal.js';
import { occurrenceBinding } from './bindings.js';
import { LIMITS } from './limits.js';
import {evidenceForCommand,contentDigest,type Evidence} from './evidence.js';
export interface Attention{agentId:string;requestId?:string;requestBinding?:string;kind:'finished'|'question'|'permission'|'error';timestamp:number}
function boundedFile(path:string,max:number){if(statSync(path).size>max)throw Error('OFFICIAL_FILE_LIMIT');const raw=readFileSync(path,'utf8');if(Buffer.byteLength(raw)>max)throw Error('OFFICIAL_FILE_LIMIT');return raw}
function normalizeTarget(target:string):string|null{try{const t=target.trim();if(t.startsWith('tcp://')){const p=parseConnectionUri(t);return normalizeLoopbackToLocalhost(p.isIpv6?'['+p.host+']:'+p.port:p.host+':'+p.port)}if(t.startsWith('unix://')||t.startsWith('pipe://'))return t;if(t.startsWith('/'))return 'unix://'+t;if(t.startsWith('\\\\.\\pipe\\'))return 'pipe://'+t;if(/^\d+$/.test(t))return 'localhost:'+t;return normalizeLoopbackToLocalhost(t)}catch{return null}}
export function localListen(home:string){const lock=JSON.parse(boundedFile(join(home,'paseo.pid'),65536));if(typeof lock.listen!=='string'||lock.listen.length>4096)throw Error('INVALID_OFFICIAL_PID');return lock.listen as string}
export function readLocalCredentialForTarget(home:string,target:string){try{const a=normalizeTarget(target),b=normalizeTarget(localListen(home));if(!a||!b||a!==b)return undefined;const token=boundedFile(join(home,'local-credential'),256).trim();return /^[A-Za-z0-9_-]{43}$/.test(token)?token:undefined}catch{return undefined}}
export function projectTask(a:AgentSnapshotPayload){return {agentId:a.id,title:a.title?.slice(0,160)||null,status:a.status,updatedAt:a.updatedAt,lastUserMessageAt:a.lastUserMessageAt,activeTurnStartedAt:a.activeTurn?.startedAt??null,cwd:a.cwd?.slice(0,1024)||null,requiresAttention:a.requiresAttention||false,attentionReason:a.attentionReason||null,pendingRequests:a.pendingPermissions.slice(0,10).map(request=>({requestId:request.id,request}))}}
export interface OfficialUsage {fetchedAt:string;providers:ProviderUsage[]}
export function projectUsage(u:OfficialUsage){return {fetchedAt:u.fetchedAt,providers:u.providers.slice(0,16).map(p=>({providerId:p.providerId.slice(0,128),displayName:p.displayName.slice(0,128),status:p.status,fetchedAt:p.fetchedAt||u.fetchedAt,windows:p.windows.slice(0,8).map(w=>({id:w.id.slice(0,128),label:w.label.slice(0,128),usedPct:w.usedPct??null,remainingPct:w.remainingPct??null,resetsAt:w.resetsAt??null})),balances:p.balances?.slice(0,8).map(b=>({id:b.id.slice(0,128),label:b.label.slice(0,128),used:b.used??null,remaining:b.remaining??null,limit:b.limit??null,unit:b.unit,resetsAt:b.resetsAt??null}))}))}}
export class OfficialClient implements OfficialOperations{
 readonly sdk:DaemonClient;
 private subscription:ReturnType<DaemonClient['observeEvents']>|undefined;
 readonly generation=randomUUID();
 private serverId='';
 private callbacks=new Set<(event:Attention)=>void>();
 private unlisten:(()=>void)|undefined;
 constructor(readonly config:Config,private journal?:OperationJournal){const target=config.target||localListen(config.paseoHome);const password=parseHostTarget(target).password||process.env.PASEO_PASSWORD;
 this.sdk=createHostClient(target,{clientId:config.clientId,clientType:'cli',appVersion:'moremote-cli/0.1.0',...(password?{password}:{localCredential:()=>readLocalCredentialForTarget(config.paseoHome,target)}),reconnect:{enabled:false},connectTimeoutMs:15000,logger:{debug(){},info(){},warn(){},error(){}}});}
 async connect(){await this.sdk.connect();const info=this.info();if(!info||info.features?.explicitEventSubscriptions!==true){await this.sdk.close();throw Error('EXPLICIT_SUBSCRIPTIONS_REQUIRED')}if(this.config.daemonServerId&&info.serverId!==this.config.daemonServerId){await this.sdk.close();throw Error('DAEMON_IDENTITY_CHANGED')}
 this.serverId=info.serverId;this.journal?.retireGeneration(info.serverId,this.generation);
 this.unlisten=this.sdk.subscribeRawMessages(message=>{
 if(message.type==='agent_attention_required'){const p=message.payload;if(p.reason!=='permission')this.emit({agentId:p.agentId,kind:p.reason,timestamp:Date.parse(p.timestamp)})}
 if(message.type==='agent_permission_request'){const p=message.payload;void this.current(p.agentId).then(agent=>{const r=agent?.pendingPermissions?.find(r=>r.id===p.request.id);if(!r)return;const ts=Date.parse(agent?.attentionTimestamp||agent?.updatedAt||'');if(Number.isFinite(ts))this.emit({agentId:p.agentId,requestId:r.id,kind:r.kind==='question'?'question':'permission',timestamp:ts})}).catch(()=>{})}
 if(message.type==='agent_permission_resolved'){const p=message.payload;this.journal?.resolution(this.serverId,p.agentId,p.requestId,this.generation,p.resolution)}
 });
 this.subscription=this.sdk.observeEvents(['agent_attention_required','agent_permission_request','agent_permission_resolved','status.server_info'],{notifications:false});await this.subscription.ready;}
 info():ServerInfoStatusPayload|null{return this.sdk.getLastServerInfoMessage()}
 private emit(event:Attention){if(Number.isSafeInteger(event.timestamp)&&event.timestamp>=0)for(const cb of this.callbacks)cb(event)}
 onAttention(callback:(event:Attention)=>void){this.callbacks.add(callback);return ()=>{this.callbacks.delete(callback)}}
 requestContext(){return {serverId:this.serverId,generation:this.generation}}
 async current(agentId:string){const value=await this.sdk.fetchAgent({agentId,timeout:15000});this.journal?.syncRequests(this.serverId,agentId,this.generation,value?.agent.pendingPermissions||[]);return value?.agent||null}
 async activityTask(agentId:string,signal?:AbortSignal){signal?.throwIfAborted();const value=await this.sdk.fetchAgent({agentId,timeout:250});signal?.throwIfAborted();return value?.agent?projectTask(value.agent):null}
 async send(command:Extract<Command,{type:'send'}>){if(!this.sdk.isConnected)throw Error('OFFICIAL_DISCONNECTED');await this.sdk.sendAgentMessage(command.agentId,command.text,{messageId:command.messageId})}
 async permission(command:Extract<Command,{type:'permission'}>){if(!this.sdk.isConnected)throw Error('OFFICIAL_DISCONNECTED');const result=await this.sdk.respondToPermissionAndWait(command.agentId,command.requestId,command.response,15000);if(!isDeepStrictEqual(result.resolution,command.response))throw Error('RESOLUTION_MISMATCH')}
 async reconcile(command:Command,pair?:Pick<Pair,'pairId'|'rootKey'>):Promise<ReceiptState|null>{return this.reconcileEvidence(evidenceForCommand(command,this.serverId),pair)}
 async reconcileEvidence(evidence:Evidence,pair?:Pick<Pair,'pairId'|'rootKey'>):Promise<ReceiptState|null>{if(evidence.serverId!==this.serverId)return null;if(evidence.type==='permission'){if(!pair||!this.journal)return null;for(const fact of this.journal.resolutionFacts(this.serverId,evidence.agentId,evidence.requestId))if(await occurrenceBinding(pair,fact)===evidence.requestBinding&&fact.response===evidence.responseDigest)return 'resolved';return null}if(!this.sdk.isConnected)return null;
 const timeline=await this.sdk.fetchAgentTimeline(evidence.agentId,{direction:'tail',projection:'canonical',limit:100,timeout:15000});if(timeline.agentId!==evidence.agentId)return null;
 return timeline.entries.some(e=>e.item.type==='user_message'&&e.item.clientMessageId===evidence.messageId&&contentDigest(e.item.text)===evidence.textDigest)?'accepted':null;}
 async snapshot(){const info=this.info();if(!info)throw Error('OFFICIAL_IDENTITY_UNAVAILABLE');const result=await this.sdk.fetchAgents({page:{limit:LIMITS.tasks},filter:{includeArchived:false,includeInternal:false},sort:[{key:'updated_at',direction:'desc'}],timeout:15000});
 const agents=result.entries.slice(0,LIMITS.tasks).map(entry=>entry.agent);
 for(const a of agents){this.journal?.syncRequests(this.serverId,a.id,this.generation,a.pendingPermissions);this.journal?.syncAttention(a.id,a.requiresAttention===true,a.attentionTimestamp?Date.parse(a.attentionTimestamp):null)}
 for(const a of agents){if(a.requiresAttention&&a.attentionReason&&a.attentionTimestamp){const timestamp=Date.parse(a.attentionTimestamp);if(a.attentionReason==='permission'){for(const r of a.pendingPermissions)this.emit({agentId:a.id,requestId:r.id,kind:r.kind==='question'?'question':'permission',timestamp})}else this.emit({agentId:a.id,kind:a.attentionReason,timestamp})}}
 let usage:unknown=null;if(info.features?.providerUsageList){try{usage=projectUsage(await this.sdk.listProviderUsage())}catch{usage=null}}
 return {version:1,daemonServerId:info.serverId,hostName:(info.hostname||hostname()).slice(0,256),measuredAt:Date.now(),tasks:agents.map(projectTask),usage};}
 async close(){this.unlisten?.();await this.subscription?.release().catch(()=>{});await this.sdk.close()}
}
