import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {OperationJournal} from '../src/journal.ts';
import {executeOperation,reconcileJournal} from '../src/operations.ts';
import {sealEnvelope} from '../src/crypto.ts';

const pair={pairId:'11111111-1111-4111-8111-111111111111',rootKey:Buffer.alloc(32,7).toString('base64url'),hostToken:'synthetic',active:true};
const id='22222222-2222-4222-8222-222222222222';
test('acknowledged unknown revisions stay silent across restart; lost acknowledgements retry exact bytes and later positive recovery never replays',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mrc-receipt-'));let journal=new OperationJournal(join(dir,'j.sqlite'));let writes=0,positive=false,loseAck=true;const uploads:string[]=[];
 const official={current:async()=>({id:'a',pendingPermissions:[]}),send:async()=>{writes++;throw Error('uncertain send')},permission:async()=>{throw Error('unexpected permission')},reconcile:async()=>null,reconcileEvidence:async()=>positive?'accepted' as const:null};
 const cloud={dispatch:async()=>({dispatchAllowed:true}),receipt:async(_id:string,body:unknown)=>{uploads.push(JSON.stringify(body));if(loseAck)throw Error('lost acknowledgement')}};
 try{
  const envelope=await sealEnvelope(Buffer.alloc(32,7),{version:1,pairId:pair.pairId,id,channel:'command',issuedAt:1000,expiresAt:301000},{type:'send',agentId:'a',text:'synthetic',messageId:id});
  await assert.rejects(executeOperation({pair,journal,official,cloud},envelope,1001));assert.equal(uploads.length,1);
  journal.close();journal=new OperationJournal(join(dir,'j.sqlite'));loseAck=false;
  assert.equal(await reconcileJournal({pair,journal,official,cloud},1002),false);assert.equal(uploads.length,2);assert.equal(uploads[1],uploads[0]);assert.equal(journal.receipts(pair.pairId,1002).length,0);
  await reconcileJournal({pair,journal,official,cloud},1003);await executeOperation({pair,journal,official,cloud},envelope,1004);assert.equal(uploads.length,2,'acked unknown must not be posted again');
  journal.cleanup(400000);positive=true;await reconcileJournal({pair,journal,official,cloud},400001);assert.equal(uploads.length,3);assert.equal(journal.get(pair.pairId,id)?.revision,2);assert.equal(journal.get(pair.pairId,id)?.state,'accepted');
  await reconcileJournal({pair,journal,official,cloud},400002);assert.equal(uploads.length,3);assert.equal(writes,1);
 }finally{journal.close();await rm(dir,{recursive:true,force:true})}
});

test('duplicate accepted command acknowledges the durable revision once, without transport amplification',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mrc-accepted-'));const journal=new OperationJournal(join(dir,'j.sqlite'));let uploads=0,writes=0;
 const official={current:async()=>({id:'a'}),send:async()=>{writes++},permission:async()=>{},reconcile:async()=>null};const cloud={dispatch:async()=>({dispatchAllowed:true}),receipt:async()=>{uploads++;if(uploads===1)throw Error('lost acknowledgement')}};
 try{const envelope=await sealEnvelope(Buffer.alloc(32,7),{version:1,pairId:pair.pairId,id,channel:'command',issuedAt:1000,expiresAt:301000},{type:'send',agentId:'a',text:'synthetic',messageId:id});await assert.rejects(executeOperation({pair,journal,official,cloud},envelope,1001));await executeOperation({pair,journal,official,cloud},envelope,1002);await executeOperation({pair,journal,official,cloud},envelope,1003);assert.equal(uploads,2);assert.equal(writes,1);assert.equal(journal.receipts(pair.pairId,1003).length,0)}finally{journal.close();await rm(dir,{recursive:true,force:true})}
});

test('persisted relay retirement fences execution even if an obsolete active flag remains, without an authenticated revoke fact',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mrc-relay-fence-'));const journal=new OperationJournal(join(dir,'j.sqlite'));let mutations=0;const retired={...pair,relayRetiredAt:1001};
 const official={current:async()=>{mutations++;return {id:'a'}},send:async()=>{mutations++},permission:async()=>{mutations++},reconcile:async()=>null};const cloud={dispatch:async()=>{mutations++;return {dispatchAllowed:true}},receipt:async()=>{mutations++}};
 try{const envelope=await sealEnvelope(Buffer.alloc(32,7),{version:1,pairId:pair.pairId,id,channel:'command',issuedAt:1000,expiresAt:301000},{type:'send',agentId:'a',text:'synthetic',messageId:id});await assert.rejects(executeOperation({pair:retired,journal,official,cloud},envelope,1002),/PAIR_NOT_ACTIVE/);assert.equal(mutations,0);assert.equal(journal.revocationTime(pair.pairId),undefined);assert.equal(journal.controlReceipts(pair.pairId,1002).length,0)}finally{journal.close();await rm(dir,{recursive:true,force:true})}
});
