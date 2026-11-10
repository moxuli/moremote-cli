import {openEnvelope,sealEnvelope,decode,validateEnvelope,type Envelope} from './crypto.js';
import {object,exact,UUID,LIMITS} from './limits.js';
import type {Pair} from './config.js';import type {OperationJournal} from './journal.js';
interface Context{pair:Pick<Pair,'pairId'|'rootKey'>;journal:OperationJournal;cloud:{controlReceipt(id:string,body:{envelope:Envelope}):Promise<unknown>}}
export async function processControl(ctx:Context,input:unknown,now?:number){
 const clock=now===undefined?Date.now:()=>now!;now=now??clock();
 const e=validateEnvelope(input,now);if(e.pairId!==ctx.pair.pairId||e.channel!=='control')throw Error('CONTROL_CONTEXT');const payload=object(await openEnvelope(decode(ctx.pair.rootKey,32),e,now));
 if(payload.type==='revoke')exact(payload,['type']);else if(payload.type==='cancel'){exact(payload,['type','operationId']);if(typeof payload.operationId!=='string'||!UUID.test(payload.operationId))throw Error('INVALID_OPERATION_ID')}else throw Error('INVALID_CONTROL');
 if(e.expiresAt<=clock())throw Error('EXPIRED_CONTROL');
 ctx.journal.applyControl(e,payload.type,payload.operationId as string|undefined,clock());
 return finishControl(ctx,e.id,clock());
}
async function finishControl(ctx:Context,id:string,now:number){
 const record=ctx.journal.control(ctx.pair.pairId,id)!;let receipt=record.receipt;
 if(!receipt){receipt=await sealEnvelope(decode(ctx.pair.rootKey,32),{version:1,pairId:ctx.pair.pairId,id,channel:'controlReceipt',issuedAt:now,expiresAt:now+LIMITS.snapshotMs},{controlId:id,type:record.type,...(record.type==='cancel'?{operationId:record.operationId}:{}),state:record.state,revision:1});ctx.journal.controlReceipt(ctx.pair.pairId,id,receipt)}
 await ctx.cloud.controlReceipt(id,{envelope:receipt});ctx.journal.controlReceiptSent(ctx.pair.pairId,id);return record.state;
}
export async function retransmitControls(ctx:Context,now=Date.now()){for(const record of ctx.journal.controlReceipts(ctx.pair.pairId,now))await finishControl(ctx,record.id,now)}
