import test from 'node:test';import assert from 'node:assert/strict';import {webcrypto} from 'node:crypto';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {OperationJournal} from '../src/journal.ts';import {occurrenceBinding} from '../src/bindings.ts';import {queueAttention} from '../src/runtime.ts';
test('retirement during attention encryption cannot queue a stale unresolved notification after resolution',async()=>{const dir=await mkdtemp(join(tmpdir(),'moremote-attention-race-'));const journal=new OperationJournal(join(dir,'j.sqlite'));const pair={pairId:'11111111-1111-4111-8111-111111111111',rootKey:Buffer.alloc(32,7).toString('base64url'),hostToken:Buffer.alloc(32,8).toString('base64url'),active:true};const encrypt=webcrypto.subtle.encrypt;let retired=false;try{const occurrence=journal.observe('d','a','g',{id:'r',kind:'tool',actions:[{id:'yes',behavior:'allow'}]},1000);const requestBinding=await occurrenceBinding(pair,occurrence);Object.defineProperty(webcrypto.subtle,'encrypt',{configurable:true,writable:true,value:async function(...args:Parameters<typeof encrypt>){const result=await encrypt.apply(webcrypto.subtle,args);journal.resolution('d','a','r','g',{behavior:'allow',selectedActionId:'yes'},1001);retired=true;return result}});await queueAttention(journal,pair,{agentId:'a',requestId:'r',requestBinding,sourceFingerprint:occurrence.fingerprint,occurrence,kind:'permission',timestamp:1000},1001);assert.equal(retired,true);assert.equal(journal.currentOccurrence('d','a','r'),undefined);assert.equal(journal.attention(pair.pairId,1002).length,0);assert.equal(journal.attentionRecords(pair.pairId).length,0);}finally{Object.defineProperty(webcrypto.subtle,'encrypt',{configurable:true,writable:true,value:encrypt});journal.close();await rm(dir,{recursive:true,force:true})}});

test('generation replacement during encryption cannot strand the new notice behind the retired ciphertext',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'moremote-attention-replacement-race-'));
 const journal=new OperationJournal(join(dir,'j.sqlite'));
 const pair={pairId:'11111111-1111-4111-8111-111111111111',rootKey:Buffer.alloc(32,7).toString('base64url'),hostToken:Buffer.alloc(32,8).toString('base64url'),active:true};
 const encrypt=webcrypto.subtle.encrypt;
 let replaced=false;
 try{
  const request={id:'r',kind:'tool',actions:[{id:'yes',behavior:'allow'}]};
  const occurrence=journal.observe('d','a','g',request,1000);
  const requestBinding=await occurrenceBinding(pair,occurrence);
  const event={agentId:'a',requestId:'r',requestBinding,sourceFingerprint:occurrence.fingerprint,occurrence,kind:'permission' as const,timestamp:1000};
  await queueAttention(journal,pair,event,1001);
  const first=journal.attention(pair.pairId,1001)[0];
  journal.attentionSent(pair.pairId,first.id);
  Object.defineProperty(webcrypto.subtle,'encrypt',{configurable:true,writable:true,value:async function(...args:Parameters<typeof encrypt>){
   const result=await encrypt.apply(webcrypto.subtle,args);
   if(!replaced){journal.syncRequests('d','a','g2',[request]);replaced=true}
   return result;
  }});
  await queueAttention(journal,pair,event,1002);
  assert.equal(replaced,true);
  assert.equal(journal.attentionRecords(pair.pairId).length,0);
  const current=journal.currentOccurrence('d','a','r')!;
  assert.equal(journal.isCurrent(occurrence),false);
  assert.equal(current.fingerprint,occurrence.fingerprint);
  const binding=await occurrenceBinding(pair,current);
  assert.notEqual(binding,requestBinding);
  await queueAttention(journal,pair,{...event,occurrence:current,requestBinding:binding},1003);
  const next=journal.attention(pair.pairId,1003);
  assert.equal(next.length,1);
  assert.notEqual(next[0].id,first.id);
  assert.deepEqual(journal.attentionResolutions(pair.pairId).map(item=>item.id),[first.id]);
  await queueAttention(journal,pair,event,1004);
  assert.deepEqual(journal.attention(pair.pairId,1004),next);
 }finally{
  Object.defineProperty(webcrypto.subtle,'encrypt',{configurable:true,writable:true,value:encrypt});
  journal.close();await rm(dir,{recursive:true,force:true});
 }
});
