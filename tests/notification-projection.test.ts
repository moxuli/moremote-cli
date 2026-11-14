import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OperationJournal } from '../src/journal.ts';
import { projectSnapshot } from '../src/projection.ts';

test('notification state contains every current bound request and no conversation, host or quota metadata', async t => {
 const dir=await mkdtemp(join(tmpdir(),'moremote-notification-projection-'));
 const journal=new OperationJournal(join(dir,'journal.sqlite'));
 t.after(async()=>{journal.close();await rm(dir,{recursive:true,force:true})});
 const pair={pairId:'11111111-1111-4111-8111-111111111111',rootKey:Buffer.alloc(32,7).toString('base64url'),hostToken:'synthetic',active:true};
 const request=(id:string)=>({id,provider:'mock',name:'Plan',kind:'plan',input:{plan:'Synthetic plan'},actions:[{id:'yes',label:'Implement',behavior:'allow'}]});
 const requests=[request('first'),request('second')];
 for(const item of requests)journal.observe('daemon','agent','generation',item);
 const source={version:1,daemonServerId:'daemon',hostName:'Private host label',measuredAt:Date.now(),usage:{private:'quota'},tasks:[{
  agentId:'agent',title:'Private title',status:'running',cwd:'/private/project',pendingRequests:requests.map(request=>({requestId:request.id,request})),
 }] } as unknown as Parameters<typeof projectSnapshot>[0];
 const result=await projectSnapshot(source,pair,journal,'generation');
 assert.deepEqual(Object.keys(result).sort(),['daemonServerId','tasks','version']);
 assert.deepEqual(Object.keys(result.tasks[0]).sort(),['agentId','pendingRequests']);
 assert.deepEqual(result.tasks[0].pendingRequests.map(row=>row.requestId),['first','second']);
 const encoded=JSON.stringify(result);
 for(const privateValue of ['Private title','Private host label','/private/project','quota'])assert.equal(encoded.includes(privateValue),false);
 journal.retire('daemon','agent','first');
 const updated=await projectSnapshot(source,pair,journal,'generation');
 assert.deepEqual(updated.tasks[0].pendingRequests.map(row=>row.requestId),['second']);
});

test('notification projection reports capacity instead of silently dropping an actionable request',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'moremote-notification-capacity-'));
 const journal=new OperationJournal(join(dir,'journal.sqlite'));
 t.after(async()=>{journal.close();await rm(dir,{recursive:true,force:true})});
 const pair={pairId:'11111111-1111-4111-8111-111111111111',rootKey:Buffer.alloc(32,7).toString('base64url'),hostToken:'synthetic',active:true};
 const request={id:'large',provider:'mock',name:'Plan',kind:'plan',input:{plan:'x'.repeat(9_000)},actions:[]};
 journal.observe('daemon','agent','generation',request);
 const source={version:1,daemonServerId:'daemon',tasks:[{agentId:'agent',pendingRequests:[{requestId:'large',request}]}]} as unknown as Parameters<typeof projectSnapshot>[0];
 await assert.rejects(projectSnapshot(source,pair,journal,'generation'),/NOTIFICATION_REQUEST_LIMIT/);
});
