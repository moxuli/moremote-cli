import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OperationJournal} from '../src/journal.ts';
import {CloudClient} from '../src/cloud-client.ts';
import {LiveActivityPublisher} from '../src/live-activity.ts';
import {publishEvents} from '../src/event-publication.ts';
import {sealEnvelope,decode} from '../src/crypto.ts';
import {queueAttention} from '../src/runtime.ts';

test('one shared POST accepts notification independently; exact activity retries survive until their own ACK',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'moremote-batch-')),journal=new OperationJournal(join(dir,'journal.sqlite'));
 try {
 const now=Date.now(),pair={pairId:'11111111-1111-4111-8111-111111111111',rootKey:Buffer.alloc(32,7).toString('base64url'),hostToken:'synthetic',active:true};
 const subscriptionId='22222222-2222-4222-8222-222222222222',generation='33333333-3333-4333-8333-333333333333';
 const interest=await sealEnvelope(decode(pair.rootKey,32),{version:1,pairId:pair.pairId,id:subscriptionId,channel:'activityInterest',issuedAt:now,expiresAt:now+28800000},
 {version:2,subscriptionId,generation,hostID:'saved-host',hostLifetime:'55555555-5555-4555-8555-555555555555',daemonServerId:'daemon',displayKey:Buffer.alloc(32,9).toString('base64url'),createdAt:now,deadline:now+28800000});
 const requests:any[]=[];let rejectedCode:string|undefined;
 const cloud=new CloudClient('https://example.test',pair.pairId,pair.hostToken,false,(async(_url,init)=>{
  const body=JSON.parse(String(init?.body));requests.push(body);
  return new Response(JSON.stringify({ok:true,attention:body.attention.map((item:any)=>({id:item.id,accepted:true})),activity:{accepted:requests.length>1&&!rejectedCode,...(rejectedCode?{code:rejectedCode}:{})}}),
   {headers:{'content-type':'application/json','x-moremote-live-activity':'2'}});
 }) as typeof fetch);
 cloud.liveActivityV2=true;cloud.liveActivityInterest={registrationId:'44444444-4444-4444-8444-444444444444',interest};
 const publisher=new LiveActivityPublisher(journal),snapshot={daemonServerId:'daemon',hostName:'computer',agents:[{id:'agent',title:'answer',status:'running',createdAt:new Date(now-1).toISOString(),lastUserMessageAt:null,pendingPermissions:[]}]};
 await queueAttention(journal,pair,{agentId:'agent',kind:'finished',timestamp:now});
 await assert.rejects(publishEvents(pair,cloud,journal,publisher,snapshot,true));
 assert.equal(requests.length,1);assert.equal(requests[0].attention.length,1);assert.ok(requests[0].activity);
 assert.equal(journal.attention(pair.pairId,Date.now()).length,0);
 await publishEvents(pair,cloud,journal,publisher,snapshot,true);
 assert.equal(requests.length,2);assert.deepEqual(requests[1].activity,requests[0].activity);assert.equal(requests[1].attention.length,0);
 await publishEvents(pair,cloud,journal,publisher,snapshot,true);assert.equal(requests.length,2,'unchanged state causes zero extra Worker requests');
 const large={...snapshot,hostName:'机'.repeat(80),agents:Array.from({length:100},(_,i)=>({...snapshot.agents[0],id:'agent-'+i,title:'题'.repeat(160)}))};
 await publishEvents(pair,cloud,journal,publisher,large,true);
 assert.equal(requests.length,3);assert.equal(requests[2].activity.candidates.length,100);
 assert.ok(Buffer.byteLength(JSON.stringify(requests[2]))>131072);
 assert.ok(Buffer.byteLength(JSON.stringify(requests[2]))<=524288);
 rejectedCode='live_activity_not_registered';
 const ended={...snapshot,agents:[{...snapshot.agents[0],status:'idle'}]};
 await publishEvents(pair,cloud,journal,publisher,ended,true);assert.equal(requests.length,4);
 await publishEvents(pair,cloud,journal,publisher,ended,true);assert.equal(requests.length,4,'a closed generation never retries every three seconds');
 }finally{journal.close();await rm(dir,{recursive:true,force:true})}
});

test('unknown title metadata leaves the independent notification outbox live',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'moremote-title-notice-')),journal=new OperationJournal(join(dir,'journal.sqlite'));
 try{
  const now=Date.now(),pair={pairId:'11111111-1111-4111-8111-111111111111',rootKey:Buffer.alloc(32,7).toString('base64url'),hostToken:'synthetic',active:true};
  const subscriptionId='22222222-2222-4222-8222-222222222222';
  const interest=await sealEnvelope(decode(pair.rootKey,32),{version:1,pairId:pair.pairId,id:subscriptionId,channel:'activityInterest',issuedAt:now,expiresAt:now+28800000},
   {version:2,subscriptionId,generation:'33333333-3333-4333-8333-333333333333',hostID:'host',hostLifetime:'55555555-5555-4555-8555-555555555555',daemonServerId:'daemon',displayKey:Buffer.alloc(32,9).toString('base64url'),createdAt:now,deadline:now+28800000,
    titleHints:[{agentId:'agent',workspaceId:'workspace',source:'workspace'}]});
  const requests:any[]=[];
  const cloud=new CloudClient('https://example.test',pair.pairId,pair.hostToken,false,(async(_url,init)=>{
   const body=JSON.parse(String(init?.body));requests.push(body);
   return new Response(JSON.stringify({ok:true,attention:body.attention.map((item:any)=>({id:item.id,accepted:true}))}),{headers:{'content-type':'application/json'}});
  }) as typeof fetch);
  cloud.liveActivityV2=true;cloud.liveActivityInterest={registrationId:'44444444-4444-4444-8444-444444444444',interest};
  await queueAttention(journal,pair,{agentId:'agent',kind:'finished',timestamp:now});
  let requested=0;
  await publishEvents(pair,cloud,journal,new LiveActivityPublisher(journal),{daemonServerId:'daemon',hostName:'host',agents:[{id:'agent',workspaceId:'workspace',title:'Raw prompt',status:'running',createdAt:new Date(now-1).toISOString(),lastUserMessageAt:null,pendingPermissions:[]}],
   requestWorkspace:()=>{requested++}},true);
  assert.equal(requested,1);assert.equal(requests.length,1);assert.equal(requests[0].attention.length,1);assert.equal(requests[0].activity,undefined);
  assert.equal(journal.attention(pair.pairId,Date.now()).length,0);
 }finally{journal.close();await rm(dir,{recursive:true,force:true})}
});

test('question notifications are not starved when state exceeds capacity or fails transiently',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'moremote-question-ungated-')),journal=new OperationJournal(join(dir,'journal.sqlite'));
 try{
  const now=Date.now(),pair={pairId:'11111111-1111-4111-8111-111111111111',rootKey:Buffer.alloc(32,7).toString('base64url'),hostToken:'synthetic',active:true};
  const requests:any[]=[];
  const cloud=new CloudClient('https://example.test',pair.pairId,pair.hostToken,false,(async(_url,init)=>{
   const body=JSON.parse(String(init?.body));requests.push(body);
   return new Response(JSON.stringify({ok:true,attention:body.attention.map((item:any)=>({id:item.id,accepted:true}))}),{headers:{'content-type':'application/json','x-moremote-live-activity':'2'}});
  }) as typeof fetch);
  cloud.liveActivityV2=true;
  await queueAttention(journal,pair,{agentId:'agent',requestId:'req-fresh',kind:'question',timestamp:now});
  await publishEvents(pair,cloud,journal,new LiveActivityPublisher(journal),null,false,false);
  assert.equal(requests.length,0,'fresh question waits briefly when state may recover');
  await publishEvents(pair,cloud,journal,new LiveActivityPublisher(journal),null,false,true);
  assert.equal(requests.length,1,'ungated question publishes immediately when state hit capacity');
  assert.equal(requests[0].attention[0].kind,'question');
  await queueAttention(journal,pair,{agentId:'agent',requestId:'req-aged',kind:'question',timestamp:now-20000});
  await publishEvents(pair,cloud,journal,new LiveActivityPublisher(journal),null,false,false);
  assert.equal(requests.length,2,'question older than 15s publishes instead of starving on transient state errors');
  assert.equal(requests[1].attention[0].kind,'question');
 }finally{journal.close();await rm(dir,{recursive:true,force:true})}
});
