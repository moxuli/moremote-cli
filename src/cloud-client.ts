import { validateOrigin } from './config.js';
import { LIMITS, object } from './limits.js';
import { validateEnvelope, type Envelope } from './crypto.js';
import type {LiveContribution,LiveInterest} from './live-activity.js';
import {UUID} from './limits.js';
import type { ReceiptState } from './journal.js';
export class CloudError extends Error{readonly code:string;constructor(readonly relayCode:string,readonly status:number,readonly retryAt?:number,readonly pauseScope:'origin'|'normal'='origin'){const safe=/^[A-Z0-9_]{1,64}$/.test(relayCode)?relayCode:'CLOUD_HTTP_ERROR';super(safe);this.code=safe}}
export interface CloudRetryState{error?:CloudError;normalError?:CloudError}
function retryDeadline(value:string|null,status:number,now:number){
 if(value===null||![429,503].includes(status))return;
 const maxDelay=86400000;
 if(/^\d+$/.test(value)){const seconds=Number(value);if(!Number.isFinite(seconds))return;return now+Math.min(seconds,maxDelay/1000)*1000}
 // Date.parse alone also accepts numeric/ISO dates and normalizes impossible
 // calendar dates. Accept only a valid canonical HTTP-date, never a new TTL.
 if(!/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value))return;
 const date=Date.parse(value);if(!Number.isFinite(date)||new Date(date).toUTCString()!==value||date<=now)return;
 return Math.min(date,now+maxDelay);
}
function recoveryRequest(method:string,path:string){
 const parts=path.split('/').filter(Boolean),suffix=parts.slice(2);
 if(parts[0]!=='pairs')return false;
 if(method==='DELETE'&&!suffix.length)return true;
 if(suffix[0]==='controls')return suffix.length===1&&['GET','POST'].includes(method)||suffix.length===2&&method==='GET'||suffix.length===3&&suffix[2]==='receipt'&&method==='POST';
 if(suffix[0]==='commands')return suffix.length===2&&method==='GET'||suffix.length===3&&suffix[2]==='receipt'&&method==='POST';
 return suffix[0]==='attention'&&suffix.length===3&&suffix[2]==='resolve'&&method==='POST';
}
export class CloudClient{
 readonly origin:string;
 notificationPreviews=false;
 liveActivityV2=false;
 liveActivityInterest?:LiveInterest;
 constructor(origin:string,readonly pairId:string,private token:string,allowLoopback=false,private fetcher:typeof fetch=fetch,private signal?:AbortSignal,private retryState:CloudRetryState={},private cycleFence?:CloudRetryState,private pairRetry:CloudRetryState={}){this.origin=validateOrigin(origin,allowLoopback)}
 async request(method:string,path:string,body?:unknown,signal?:AbortSignal):Promise<Record<string,unknown>>{
 // A runtime cycle that observed a pause must reacquire controls in a new
 // cycle, even if an intervening SDK call outlasted the wall-clock deadline.
 signal?.throwIfAborted();
 if(this.cycleFence?.error)throw this.cycleFence.error;
 const paused=this.retryState.error;if(paused?.retryAt!==undefined&&paused.retryAt>Date.now()){if(this.cycleFence)this.cycleFence.error=paused;throw paused}this.retryState.error=undefined;
 const recovery=recoveryRequest(method,path),now=Date.now();
 const pairPause=recovery?this.pairRetry.error:this.pairRetry.normalError;
 if(pairPause?.retryAt!==undefined&&pairPause.retryAt>now)throw pairPause;
 if(!recovery){
  if(this.cycleFence?.normalError)throw this.cycleFence.normalError;
  const normal=this.retryState.normalError;if(normal?.retryAt!==undefined&&normal.retryAt>now){if(this.cycleFence)this.cycleFence.normalError=normal;throw normal}this.retryState.normalError=undefined;
 }
 const json=body===undefined?undefined:JSON.stringify(body);if(json&&Buffer.byteLength(json)>(method==='POST'&&path===this.path('/events')?LIMITS.liveEventBytes:LIMITS.envelopeBytes))throw Error('REQUEST_LIMIT');
 const response=await this.fetcher(this.origin+'/v1'+path,{method,headers:{authorization:'Bearer '+this.token,...(json?{'content-type':'application/json'}:{})},body:json,signal:AbortSignal.any([AbortSignal.timeout(20000),...(this.signal?[this.signal]:[]),...(signal?[signal]:[])]),redirect:'error'});
 if(response.ok){this.notificationPreviews=response.headers.get('x-moremote-notification-preview')==='1';this.liveActivityV2=response.headers.get('x-moremote-live-activity')==='2'}
 const retryAt=retryDeadline(response.headers.get('Retry-After'),response.status,Date.now());
 const reader=response.body?.getReader();let size=0;const chunks:Uint8Array[]=[];
 if(reader){try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>LIMITS.responseBytes)throw Error('RESPONSE_LIMIT');chunks.push(r.value)}}catch(error){
  if(retryAt!==undefined){const failure=new CloudError('CLOUD_HTTP_ERROR',response.status,retryAt);this.retryState.error=failure;if(this.cycleFence)this.cycleFence.error=failure}
  throw error;
 }finally{await reader.cancel()}}
 let result:Record<string,unknown>;try{result=object(JSON.parse(Buffer.concat(chunks).toString('utf8')))}catch{
  if(retryAt!==undefined){const failure=new CloudError('CLOUD_HTTP_ERROR',response.status,retryAt);this.retryState.error=failure;if(this.cycleFence)this.cycleFence.error=failure}
  throw Error('INVALID_CLOUD_RESPONSE');
 }
 if(!response.ok||result.ok!==true){
  const error=result.error&&typeof result.error==='object'?result.error as {code?:unknown}:{},resetHeader=response.headers.get('x-moremote-reset'),reset=Number(resetHeader);
  // Only an explicit, internally consistent daily normal-quota rejection can
  // leave recovery open. Missing/malformed hints and outages remain origin-wide.
  const exactReset=retryAt!==undefined&&resetHeader!==null&&/^\d{1,16}$/.test(resetHeader)
    &&Number.isSafeInteger(reset)&&reset>Date.now()&&Math.abs(reset-retryAt)<=1000;
  const pairBudget=response.headers.get('x-moremote-pair-budget');
  if(response.status===429&&exactReset&&error.code==='pair_daily_work_limit'
    &&response.headers.get('x-moremote-limit-scope')==='pair'&&['normal','recovery','enrollment'].includes(pairBudget??'')){
   const failure=new CloudError('PAIR_DAILY_WORK_LIMIT',429,reset,pairBudget==='normal'?'normal':'origin');
   if(pairBudget!=='recovery')this.pairRetry.normalError=failure;
   if(pairBudget!=='normal')this.pairRetry.error=failure;
   throw failure;
  }
  const normalOnly=response.status===429&&exactReset&&error.code==='daily_work_limit'&&response.headers.get('x-moremote-budget')==='normal';
  const failure=new CloudError(typeof error.code==='string'?error.code:'CLOUD_HTTP_ERROR',response.status,retryAt,normalOnly?'normal':'origin');
  if(retryAt!==undefined){const field=normalOnly?'normalError':'error';this.retryState[field]=failure;if(this.cycleFence)this.cycleFence[field]=failure}
  throw failure;
 }return result;
 }
 private path(suffix=''){return '/pairs/'+this.pairId+suffix}
 create(body:unknown,signal?:AbortSignal){return this.request('POST','/pairs',body,signal)}
 pair(){return this.request('GET',this.path())}
 activate(body:unknown){return this.request('POST',this.path('/activate'),body)}
 revoke(signal?:AbortSignal){return this.request('DELETE',this.path(),undefined,signal)}
 async commands():Promise<Envelope[]>{const result=await this.request('GET',this.path('/commands'));if(!Array.isArray(result.commands)||result.commands.length>100)throw Error('INVALID_COMMAND_PAGE');return result.commands.map(row=>object(row).envelope as Envelope).filter(Boolean)}
 async dispatch(id:string){const r=await this.request('POST',this.path('/commands/'+id+'/dispatch'),{});if(typeof r.dispatchAllowed!=='boolean')throw Error('INVALID_DISPATCH_RESPONSE');return {dispatchAllowed:r.dispatchAllowed}}
 receipt(id:string,body:{state:ReceiptState;revision:number;envelope:Envelope}){return this.request('POST',this.path('/commands/'+id+'/receipt'),body)}
 state(envelope:Envelope){return this.request('PUT',this.path('/state'),{envelope})}
 attention(body:unknown){return this.request('POST',this.path('/attention'),body)}
 private applyLiveInterest(raw:unknown){
  this.liveActivityInterest=undefined;
  if(!this.liveActivityV2||raw===null||raw===undefined)return;
  const value=object(raw);
  if(typeof value.registrationId!=='string'||!UUID.test(value.registrationId))throw Error('INVALID_LIVE_ACTIVITY_REGISTRATION');
  const interest=validateEnvelope(value.interest,Date.now());
  if(interest.pairId!==this.pairId||interest.channel!=='activityInterest')throw Error('INVALID_LIVE_ACTIVITY_INTEREST');
  this.liveActivityInterest={registrationId:value.registrationId,interest};
 }
 async discoverLiveActivity(){
  const result=await this.request('GET',this.path('/live-activity'));
  this.applyLiveInterest(result.liveActivity);
 }
 async controls():Promise<Envelope[]>{const result=await this.request('GET',this.path('/controls'));if(!Array.isArray(result.controls)||result.controls.length>100)throw Error('INVALID_CONTROL_PAGE');
 this.applyLiveInterest(result.liveActivity);
 return result.controls.map(row=>object(row).envelope as Envelope).filter(Boolean)}
 async events(attention:unknown[],activity?:LiveContribution){
 const value=await this.request('POST',this.path('/events'),{attention,...(activity?{activity}:{})});
 if(!Array.isArray(value.attention)||value.attention.length!==attention.length)throw Error('INVALID_EVENT_RESPONSE');
 const accepted=new Set<string>();for(const item of value.attention){const row=object(item);if(typeof row.id!=='string'||typeof row.accepted!=='boolean')throw Error('INVALID_EVENT_RESPONSE');if(row.accepted)accepted.add(row.id)}
 const live=value.activity===undefined?undefined:object(value.activity);
 if(activity&&typeof live?.accepted!=='boolean')throw Error('INVALID_ACTIVITY_RESPONSE');
 return {attention:accepted,activity:live?.accepted===true,activityCode:typeof live?.code==='string'?live.code:undefined};
 }
 controlReceipt(id:string,body:{envelope:Envelope}){return this.request('POST',this.path('/controls/'+id+'/receipt'),body)}
 resolveAttention(id:string,resolvedAt:number){return this.request('POST',this.path('/attention/'+id+'/resolve'),{resolvedAt})}
}
