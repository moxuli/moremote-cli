import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OperationJournal } from '../src/journal.ts';
import { executeOperation, validateCommand } from '../src/operations.ts';
import { sealEnvelope } from '../src/crypto.ts';
const pairId='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',root=Buffer.alloc(32,7);
async function fixture(){const dir=await mkdtemp(join(tmpdir(),'moremote-test-'));const journal=new OperationJournal(join(dir,'journal.sqlite'));let writes=0;let allowed=true;
const official={current:async()=>({id:'agent',pendingPermissions:[]}),send:async()=>{writes++},permission:async()=>{writes++},reconcile:async()=>null};
const cloud={dispatch:async()=>({dispatchAllowed:allowed}),receipt:async()=>({ok:true})};
const pair={pairId,rootKey:root.toString('base64url'),hostToken:'test',active:true};
const envelope=await sealEnvelope(root,{version:1,pairId,id,channel:'command',issuedAt:1000,expiresAt:301000},{type:'send',agentId:'agent',text:'hello',messageId:id});
return {journal,official,cloud,pair,envelope,count:()=>writes,revoke:()=>{allowed=false},clean:async()=>{journal.close();await rm(dir,{recursive:true,force:true})}};}
test('durable same-ID dedupe and conflicting immutable bytes',async()=>{const f=await fixture();try{
 await executeOperation(f,f.envelope,1001); await executeOperation(f,f.envelope,1002);assert.equal(f.count(),1);assert.equal(f.journal.get(pairId,id)?.state,'accepted');
 await assert.rejects(executeOperation(f,{...f.envelope,ciphertext:'abcd'},1003));
}finally{await f.clean()}});
test('expiry and revoked dispatch never mutate',async()=>{const f=await fixture();try{await assert.rejects(executeOperation(f,f.envelope,301000));f.revoke();await executeOperation(f,f.envelope,1001);assert.equal(f.count(),0)}finally{await f.clean()}});
test('crash boundary and unknown outcome never resend after restart',async()=>{const f=await fixture();try{f.official.send=async()=>{throw Error('lost receipt')};await executeOperation(f,f.envelope,1001);assert.equal(f.journal.get(pairId,id)?.state,'unknown');await executeOperation(f,f.envelope,1002);assert.equal(f.count(),0);assert.equal(f.journal.get(pairId,id)?.state,'unknown')}finally{await f.clean()}});
test('current request and action identity cannot transfer to replacement',()=>{
 const requestBinding=Buffer.alloc(32,9).toString('base64url');
 const command={type:'permission',agentId:'agent',requestId:'old',requestBinding,response:{behavior:'allow',selectedActionId:'yes'}};
 assert.throws(()=>validateCommand(command,id,{id:'agent',pendingPermissions:[{id:'new',requestBinding,actions:[{id:'yes',behavior:'allow'}]}]}));
 assert.throws(()=>validateCommand(command,id,{id:'agent',pendingPermissions:[{id:'old',requestBinding,actions:[{id:'yes',behavior:'deny'}]}]}));
 assert.doesNotThrow(()=>validateCommand(command,id,{id:'agent',pendingPermissions:[{id:'old',requestBinding,kind:'tool',actions:[{id:'yes',behavior:'allow'}]}]}));
 assert.throws(()=>validateCommand({...command,shell:'bad'},id,{id:'agent'}));
});
