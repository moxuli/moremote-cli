import { validateOrigin } from './config.js';
import { LIMITS, object } from './limits.js';
import type { Envelope } from './crypto.js';
import type { ReceiptState } from './journal.js';
export class CloudError extends Error{readonly code:string;constructor(code:string,readonly status:number,readonly retryAt?:number,readonly pauseScope:'origin'|'normal'='origin'){const safe=/^[A-Z0-9_]{1,64}$/.test(code)?code:'CLOUD_HTTP_ERROR';super(safe);this.code=safe}}
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
 return suffix[0]==='attention'&&suffix.length===3&&suffix[2]==='resolve'&&method==='POST'
  ||suffix[0]==='activities'&&(suffix.length===2&&method==='DELETE'||suffix.length===3&&suffix[2]==='end'&&method==='PUT')
  ||suffix[0]==='widget-device'&&suffix.length===2&&method==='DELETE';
}
export class CloudClient{
 readonly origin:string;
 constructor(origin:string,readonly pairId:string,private token:string,allowLoopback=false,private fetcher:typeof fetch=fetch,private signal?:AbortSignal,private retryState:CloudRetryState={},private cycleFence?:CloudRetryState){this.origin=validateOrigin(origin,allowLoopback)}
 async request(method:string,path:string,body?:unknown,signal?:AbortSignal):Promise<Record<string,unknown>>{
 // A runtime cycle that observed a pause must reacquire controls in a new
 // cycle, even if an intervening SDK call outlasted the wall-clock deadline.
 signal?.throwIfAborted();
 if(this.cycleFence?.error)throw this.cycleFence.error;
 const paused=this.retryState.error;if(paused?.retryAt!==undefined&&paused.retryAt>Date.now()){if(this.cycleFence)this.cycleFence.error=paused;throw paused}this.retryState.error=undefined;
 if(!recoveryRequest(method,path)){
  if(this.cycleFence?.normalError)throw this.cycleFence.normalError;
  const normal=this.retryState.normalError;if(normal?.retryAt!==undefined&&normal.retryAt>Date.now()){if(this.cycleFence)this.cycleFence.normalError=normal;throw normal}this.retryState.normalError=undefined;
 }
 const json=body===undefined?undefined:JSON.stringify(body);if(json&&Buffer.byteLength(json)>LIMITS.envelopeBytes)throw Error('REQUEST_LIMIT');
 const response=await this.fetcher(this.origin+'/v1'+path,{method,headers:{authorization:'Bearer '+this.token,...(json?{'content-type':'application/json'}:{})},body:json,signal:AbortSignal.any([AbortSignal.timeout(20000),...(this.signal?[this.signal]:[]),...(signal?[signal]:[])]),redirect:'error'});
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
  const normalOnly=response.status===429&&error.code==='daily_work_limit'&&response.headers.get('x-moremote-budget')==='normal'
   &&retryAt!==undefined&&resetHeader!==null&&/^\d{1,16}$/.test(resetHeader)&&Number.isSafeInteger(reset)&&reset>Date.now()&&Math.abs(reset-retryAt)<=1000;
  const failure=new CloudError(typeof error.code==='string'?error.code:'CLOUD_HTTP_ERROR',response.status,retryAt,normalOnly?'normal':'origin');
  if(retryAt!==undefined){const field=normalOnly?'normalError':'error';this.retryState[field]=failure;if(this.cycleFence)this.cycleFence[field]=failure}
  throw failure;
 }return result;
 }
 private path(suffix=''){return '/pairs/'+this.pairId+suffix}
 create(body:unknown){return this.request('POST','/pairs',body)}
 pair(){return this.request('GET',this.path())}
 activate(body:unknown){return this.request('POST',this.path('/activate'),body)}
 revoke(){return this.request('DELETE',this.path())}
 async commands():Promise<Envelope[]>{const result=await this.request('GET',this.path('/commands'));if(!Array.isArray(result.commands)||result.commands.length>100)throw Error('INVALID_COMMAND_PAGE');return result.commands.map(row=>object(row).envelope as Envelope).filter(Boolean)}
 async dispatch(id:string){const r=await this.request('POST',this.path('/commands/'+id+'/dispatch'),{});if(typeof r.dispatchAllowed!=='boolean')throw Error('INVALID_DISPATCH_RESPONSE');return {dispatchAllowed:r.dispatchAllowed}}
 receipt(id:string,body:{state:ReceiptState;revision:number;envelope:Envelope}){return this.request('POST',this.path('/commands/'+id+'/receipt'),body)}
 state(envelope:Envelope,widgetFingerprint?:string){return this.request('PUT',this.path('/state'),{envelope,...(widgetFingerprint?{widgetFingerprint}:{})})}
 attention(body:unknown){return this.request('POST',this.path('/attention'),body)}
 async controls():Promise<Envelope[]>{const result=await this.request('GET',this.path('/controls'));if(!Array.isArray(result.controls)||result.controls.length>100)throw Error('INVALID_CONTROL_PAGE');return result.controls.map(row=>object(row).envelope as Envelope).filter(Boolean)}
 controlReceipt(id:string,body:{envelope:Envelope}){return this.request('POST',this.path('/controls/'+id+'/receipt'),body)}
 resolveAttention(id:string,resolvedAt:number){return this.request('POST',this.path('/attention/'+id+'/resolve'),{resolvedAt})}
 async activities(signal?:AbortSignal):Promise<unknown[]>{const result=await this.request('GET',this.path('/activities'),undefined,signal);if(!Array.isArray(result.subscriptions)||result.subscriptions.length>8)throw Error('INVALID_ACTIVITY_PAGE');return result.subscriptions}
 activityState(id:string,body:{registrationId:string;topic:string;event:'update'|'end';envelope:Envelope},signal?:AbortSignal){return this.request('PUT',this.path('/activities/'+id+(body.event==='end'?'/end':'/state')),body,signal)}
}
