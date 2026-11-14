import {buildAgentAttentionNotificationPayload,findLatestAssistantMessageFromTimeline,type NotificationPermissionRequest} from '@getpaseo/protocol/agent-attention-notification';
import type {AgentSnapshotPayload} from '@getpaseo/protocol/messages';
import {sealEnvelope,decode,type Envelope} from './crypto.js';
import type {Pair} from './config.js';

export interface NotificationPreview {title:string;hostName:string;body:string}
type Kind='finished'|'question'|'permission'|'error';
type Entry={timestamp:string;item:{type:string;text?:string;message?:string}};
const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});

/** Bound UTF-8, retaining whole graphemes and removing invisible directional controls. */
export function notificationText(value:string,bytes:number):string {
 const clean=value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,'').replace(/\s+/g,' ').trim();
 if(Buffer.byteLength(clean)<=bytes)return clean;
 let result='',size=0;
 for(const {segment} of segmenter.segment(clean)){const n=Buffer.byteLength(segment);if(size+n>bytes-3)break;result+=segment;size+=n}
 return result.trimEnd()+'…';
}
function plain(value:string):string {
 // Generated documents are not readable notification prose and may contain executable-looking source.
 const prose=value.replace(/```(?:paseo-openui|paseo-html|html)\b[^\n]*\n[\s\S]*?(?:```|$)/gi,'');
 if(!prose.trim())return '';
 return buildAgentAttentionNotificationPayload({reason:'finished',serverId:'',workspaceId:'',agentId:'',assistantMessage:prose}).body;
}
function question(request:NotificationPermissionRequest):string {
 const rows=request.input?.questions;
 if(!Array.isArray(rows))return request.description||request.title||'';
 return rows.slice(0,3).map(row=>{
  if(!row||typeof row!=='object')return '';
  const text=typeof row.question==='string'?row.question:'';
  const options=Array.isArray(row.options)?row.options.slice(0,4).flatMap((o:unknown)=>o&&typeof o==='object'&&'label' in o&&typeof o.label==='string'?[o.label]:[]):[];
  return text+(options.length?' '+options.join(' / '):'');
 }).filter(Boolean).join(' ');
}

/** Only current-turn assistant prose or the exact pending request; never reasoning/tool output. */
export function buildNotificationPreview(agent:AgentSnapshotPayload,hostName:string,kind:Kind,request?:NotificationPermissionRequest,entries:readonly Entry[]=[]):NotificationPreview {
 let body='';
 if(kind==='finished'){
  const start=agent.lastUserMessageAt?Date.parse(agent.lastUserMessageAt):NaN;
  const lastUser=entries.findLastIndex(e=>e.item.type==='user_message');
  const current=entries.slice(lastUser+1).filter(e=>!Number.isFinite(start)||Date.parse(e.timestamp)>=start).map(e=>e.item);
  body=plain(findLatestAssistantMessageFromTimeline(current)||'');
 }else if(kind==='error')body=plain(agent.lastError||'');
 else if(request){
  body=plain(kind==='question'?question(request):[request.title,request.description,typeof request.input?.plan==='string'?request.input.plan:undefined].filter(Boolean).join(' — ')||request.name);
 }
 return {title:notificationText(agent.title||'',256),hostName:notificationText(hostName,128),body:notificationText(body,960)};
}

/** Separate ciphertext keeps legacy navigation plaintext byte-for-byte compatible. */
export async function encryptNotificationPreview(pair:Pair,route:Envelope,identity:{agentId:string;kind:Kind;timestamp:number},preview:NotificationPreview):Promise<Envelope|undefined> {
 let body=notificationText(preview.body,960),title=notificationText(preview.title,256),hostName=notificationText(preview.hostName,128);
 for(let attempt=0;attempt<4;attempt++){
  const payload={type:'notificationPreview',version:1,...identity,title,hostName,body};
  // Size before encryption; GCM overhead and unpadded base64 lengths are deterministic.
  const length=Math.ceil((Buffer.byteLength(JSON.stringify(payload))+16)*4/3);
  const candidate={...route,nonce:'A'.repeat(16),ciphertext:'A'.repeat(length)};
  const push={aps:{alert:{title:'MoRemote',body:'一项任务需要你的回复。'},sound:'default',category:'moremote.enhancement.permission','mutable-content':1},pairId:route.pairId,eventId:route.id,kind:identity.kind,route,preview:candidate};
  if(Buffer.byteLength(JSON.stringify(push))<=4096){
   return sealEnvelope(decode(pair.rootKey,32),{version:1,pairId:route.pairId,id:route.id,channel:'attention',issuedAt:route.issuedAt,expiresAt:route.expiresAt},payload);
  }
  if(body)body=attempt===0?notificationText(body,240):'';else{title=notificationText(title,64);hostName=notificationText(hostName,32)}
 }
 // Preserve the original valid notification when unusually large identifiers consume the budget.
 return undefined;
}
