import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {OperationJournal} from '../src/journal.ts';import {queueAttention} from '../src/runtime.ts';import {openEnvelope} from '../src/crypto.ts';
import {occurrenceBinding} from '../src/bindings.ts';
import {validateCommand} from '../src/operations.ts';
test('stable attention survives reconnect/restart and preserves immutable ciphertext',async()=>{const dir=await mkdtemp(join(tmpdir(),'moremote-attention-'));const path=join(dir,'journal.sqlite');let j=new OperationJournal(path);const pair={pairId:'11111111-1111-4111-8111-111111111111',rootKey:Buffer.alloc(32,7).toString('base64url'),hostToken:'synthetic',active:true};try{await queueAttention(j,pair,{agentId:'a',requestId:'r',kind:'question',timestamp:1000},1001);const first=j.attention(pair.pairId,1001)[0];j.close();j=new OperationJournal(path);await queueAttention(j,pair,{agentId:'a',requestId:'r',kind:'question',timestamp:2000},2001);const next=j.attention(pair.pairId,2001);assert.equal(next.length,1);assert.deepEqual(next[0],first);const plain=await openEnvelope(Buffer.alloc(32,7),first.body.envelope,2001);assert.deepEqual(plain,{agentId:'a',requestId:'r',kind:'question',timestamp:1000});j.attentionSent(pair.pairId,first.id);assert.equal(j.attention(pair.pairId,2001).length,0);j.cleanup(601000);assert.equal(j.attention(pair.pairId,601000).length,0);}finally{j.close();await rm(dir,{recursive:true,force:true})}});

for(const kind of ['question','plan'] as const){
 test(`pending ${kind} attention survives a false attention flag until authoritative retirement`,async()=>{
  const dir=await mkdtemp(join(tmpdir(),'moremote-pending-attention-'));
  const journal=new OperationJournal(join(dir,'journal.sqlite'));
  const pair={pairId:'11111111-1111-4111-8111-111111111111',rootKey:Buffer.alloc(32,7).toString('base64url'),hostToken:'synthetic',active:true};
  const request={id:'r',kind,input:kind==='question'?{questions:[1,2,3].map(index=>({header:`Choice ${index}`,question:`Select option ${index}`,options:[{label:'First'},{label:'Second'}]}))}:{plan:'Review the proposed plan'},actions:[{id:'yes',behavior:'allow'}]};
  try{
   journal.syncRequests('d','a','g',[request]);
   const occurrence=journal.currentOccurrence('d','a','r')!;
   const requestBinding=await occurrenceBinding(pair,occurrence);
   await queueAttention(journal,pair,{agentId:'a',requestId:'r',requestBinding,sourceFingerprint:occurrence.fingerprint,occurrence,kind:kind==='question'?'question':'permission',timestamp:1000},1001);
   const pending=journal.attention(pair.pairId,1001)[0];
   await queueAttention(journal,pair,{agentId:'a',kind:kind==='question'?'finished':'error',timestamp:1000},1001);
   const terminal=journal.attention(pair.pairId,1001).find(item=>item.id!==pending.id)!;

   journal.syncRequests('d','a','g',[request]);
   journal.syncAttention('a',false,null);
   assert.deepEqual(journal.attention(pair.pairId,1002),[pending]);
   assert.deepEqual(journal.attentionResolutions(pair.pairId).map(item=>item.id),[terminal.id]);
   assert.equal(journal.isCurrent(occurrence),true);
   assert.equal(await occurrenceBinding(pair,journal.currentOccurrence('d','a','r')!),requestBinding);
   journal.attentionSent(pair.pairId,pending.id);
   journal.syncAttention('a',true,2000);
   journal.syncAttention('a',false,null);
   assert.deepEqual(journal.attentionRecords(pair.pairId).map(item=>item.id),[pending.id]);

   if(kind==='question')journal.syncRequests('d','a','g',[]);
   else journal.resolution('d','a','r','g',{behavior:'allow',selectedActionId:'yes'},2001);
   assert.equal(journal.currentOccurrence('d','a','r'),undefined);
   assert.equal(journal.attention(pair.pairId,2002).length,0);
   assert.equal(journal.attentionRecords(pair.pairId).length,0);
   assert.ok(journal.attentionResolutions(pair.pairId).some(item=>item.id===pending.id));
  }finally{journal.close();await rm(dir,{recursive:true,force:true})}
 });
}

for(const transition of ['generation','replacement','retirement'] as const){
 test(`a ${transition} occurrence gets a current notice without reviving the old approval binding`,async()=>{
  const dir=await mkdtemp(join(tmpdir(),'moremote-occurrence-attention-'));
  const path=join(dir,'journal.sqlite');
  let journal=new OperationJournal(path);
  const pair={pairId:'11111111-1111-4111-8111-111111111111',rootKey:Buffer.alloc(32,7).toString('base64url'),hostToken:'synthetic',active:true};
  const request={id:'r',kind:'tool',input:{value:'first'},actions:[{id:'yes',behavior:'allow'}]};
  try{
   const firstOccurrence=journal.observe('d','a','g',request,1000);
   const firstBinding=await occurrenceBinding(pair,firstOccurrence);
   const firstEvent={agentId:'a',requestId:'r',requestBinding:firstBinding,sourceFingerprint:firstOccurrence.fingerprint,occurrence:firstOccurrence,kind:'permission' as const,timestamp:1000};
   await queueAttention(journal,pair,firstEvent,1001);
   const first=journal.attention(pair.pairId,1001)[0];
   journal.attentionSent(pair.pairId,first.id);

   const generation=transition==='generation'?'g2':'g';
   const currentRequest=transition==='replacement'?{...request,input:{value:'replacement'}}:request;
   if(transition==='generation')journal.retireGeneration('d',generation);
   if(transition==='retirement')journal.syncRequests('d','a','g',[]);
   journal.syncRequests('d','a',generation,[currentRequest]);
   const occurrence=journal.currentOccurrence('d','a','r')!;
   const requestBinding=await occurrenceBinding(pair,occurrence);
   assert.notEqual(occurrence.occurrenceId,firstOccurrence.occurrenceId);
   assert.notEqual(requestBinding,firstBinding);
   assert.equal(journal.isCurrent(firstOccurrence),false);
   if(transition!=='replacement')assert.equal(occurrence.fingerprint,firstOccurrence.fingerprint);
   assert.ok(journal.attentionResolutions(pair.pairId).some(item=>item.id===first.id));
   journal.attentionResolutionSent(pair.pairId,first.id);
   const event={...firstEvent,occurrence,sourceFingerprint:occurrence.fingerprint,requestBinding};
   await queueAttention(journal,pair,event,1002);
   const current=journal.attention(pair.pairId,1002);
   assert.equal(current.length,1);
   assert.notEqual(current[0].id,first.id);
   assert.equal((await openEnvelope(Buffer.alloc(32,7),current[0].body.envelope,1002) as {requestBinding:string}).requestBinding,requestBinding);
   const command={type:'permission',agentId:'a',requestId:'r',requestBinding:firstBinding,response:{behavior:'allow',selectedActionId:'yes'}};
   const agent={id:'a',pendingPermissions:[{...currentRequest,requestBinding}]};
   assert.throws(()=>validateCommand(command,'22222222-2222-4222-8222-222222222222',agent),/STALE_REQUEST_INSTANCE/);
   assert.doesNotThrow(()=>validateCommand({...command,requestBinding},'22222222-2222-4222-8222-222222222222',agent));

   journal.close();journal=new OperationJournal(path);
   const unchanged=journal.observe('d','a',generation,currentRequest,2000);
   assert.equal(unchanged.occurrenceId,occurrence.occurrenceId);
   await queueAttention(journal,pair,{...event,occurrence:unchanged,timestamp:2000},2001);
   await queueAttention(journal,pair,firstEvent,2001);
   assert.deepEqual(journal.attention(pair.pairId,2001),current);
   assert.equal(journal.attentionRecords(pair.pairId).length,1);
   assert.equal(journal.attentionResolutions(pair.pairId).length,0);
  }finally{journal.close();await rm(dir,{recursive:true,force:true})}
 });
}
