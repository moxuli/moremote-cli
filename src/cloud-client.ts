import { validateOrigin } from './config.js';
import { LIMITS, object } from './limits.js';
import type { Envelope } from './crypto.js';
import type { ReceiptState } from './journal.js';
export class CloudError extends Error{readonly code:string;constructor(code:string,readonly status:number,readonly retryAt?:number){const safe=/^[A-Z0-9_]{1,64}$/.test(code)?code:'CLOUD_HTTP_ERROR';super(safe);this.code=safe}}
export interface CloudRetryState{error?:CloudError}
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
export class CloudClient{
 readonly origin:string;
 constructor(origin:string,readonly pairId:string,private token:string,allowLoopback=false,private fetcher:typeof fetch=fetch,private signal?:AbortSignal,private retryState:CloudRetryState={},private cycleFence?:CloudRetryState){this.origin=validateOrigin(origin,allowLoopback)}
 async request(method:string,path:string,body?:unknown):Promise<Record<string,unknown>>{
 // A runtime cycle that observed a pause must reacquire controls in a new
 // cycle, even if an intervening SDK call outlasted the wall-clock deadline.
 if(this.cycleFence?.error)throw this.cycleFence.error;
 const paused=this.retryState.error;if(paused?.retryAt!==undefined&&paused.retryAt>Date.now()){if(this.cycleFence)this.cycleFence.error=paused;throw paused}this.retryState.error=undefined;
 const json=body===undefined?undefined:JSON.stringify(body);if(json&&Buffer.byteLength(json)>LIMITS.envelopeBytes)throw Error('REQUEST_LIMIT');
 const response=await this.fetcher(this.origin+'/v1'+path,{method,headers:{authorization:'Bearer '+this.token,...(json?{'content-type':'application/json'}:{})},body:json,signal:AbortSignal.any([AbortSignal.timeout(20000),...(this.signal?[this.signal]:[])]),redirect:'error'});
 const retryAt=retryDeadline(response.headers.get('Retry-After'),response.status,Date.now());if(retryAt!==undefined){const failure=new CloudError('CLOUD_HTTP_ERROR',response.status,retryAt);this.retryState.error=failure;if(this.cycleFence)this.cycleFence.error=failure}
 const reader=response.body?.getReader();let size=0;const chunks:Uint8Array[]=[];
 if(reader){try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>LIMITS.responseBytes)throw Error('RESPONSE_LIMIT');chunks.push(r.value)}}finally{await reader.cancel()}}
 let result:Record<string,unknown>;try{result=object(JSON.parse(Buffer.concat(chunks).toString('utf8')))}catch{throw Error('INVALID_CLOUD_RESPONSE')}
 if(!response.ok||result.ok!==true){const error=result.error&&typeof result.error==='object'?result.error as {code?:unknown}:{};const failure=new CloudError(typeof error.code==='string'?error.code:'CLOUD_HTTP_ERROR',response.status,retryAt);if(retryAt!==undefined){this.retryState.error=failure;if(this.cycleFence)this.cycleFence.error=failure}throw failure}return result;
 }
 private path(suffix=''){return '/pairs/'+this.pairId+suffix}
 create(body:unknown){return this.request('POST','/pairs',body)}
 pair(){return this.request('GET',this.path())}
 activate(body:unknown){return this.request('POST',this.path('/activate'),body)}
 revoke(){return this.request('DELETE',this.path())}
 async commands():Promise<Envelope[]>{const result=await this.request('GET',this.path('/commands'));if(!Array.isArray(result.commands)||result.commands.length>100)throw Error('INVALID_COMMAND_PAGE');return result.commands.map(row=>object(row).envelope as Envelope).filter(Boolean)}
 async dispatch(id:string){const r=await this.request('POST',this.path('/commands/'+id+'/dispatch'),{});if(typeof r.dispatchAllowed!=='boolean')throw Error('INVALID_DISPATCH_RESPONSE');return {dispatchAllowed:r.dispatchAllowed}}
 receipt(id:string,body:{state:ReceiptState;revision:number;envelope:Envelope}){return this.request('POST',this.path('/commands/'+id+'/receipt'),body)}
 state(envelope:Envelope){return this.request('PUT',this.path('/state'),{envelope})}
 attention(body:unknown){return this.request('POST',this.path('/attention'),body)}
 async controls():Promise<Envelope[]>{const result=await this.request('GET',this.path('/controls'));if(!Array.isArray(result.controls)||result.controls.length>100)throw Error('INVALID_CONTROL_PAGE');return result.controls.map(row=>object(row).envelope as Envelope).filter(Boolean)}
 controlReceipt(id:string,body:{envelope:Envelope}){return this.request('POST',this.path('/controls/'+id+'/receipt'),body)}
 resolveAttention(id:string,resolvedAt:number){return this.request('POST',this.path('/attention/'+id+'/resolve'),{resolvedAt})}
}
