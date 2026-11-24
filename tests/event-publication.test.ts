import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OperationJournal} from '../src/journal.ts';
import {CloudClient} from '../src/cloud-client.ts';
import {LiveActivityPublisher} from '../src/live-activity.ts';
import {publishEvents} from '../src/event-publication.ts';
import {sealEnvelope,decode,presenceTopic} from '../src/crypto.ts';
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

test('an unrelated missing workspace title cannot block a completed activity or lose its independent retry',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'moremote-title-notice-')),journal=new OperationJournal(join(dir,'journal.sqlite'));
 try{
  const now=Date.now(),pair={pairId:'11111111-1111-4111-8111-111111111111',rootKey:Buffer.alloc(32,7).toString('base64url'),hostToken:'synthetic',active:true};
  const subscriptionId='22222222-2222-4222-8222-222222222222';
  const interest=await sealEnvelope(decode(pair.rootKey,32),{version:1,pairId:pair.pairId,id:subscriptionId,channel:'activityInterest',issuedAt:now,expiresAt:now+28800000},
   {version:2,subscriptionId,generation:'33333333-3333-4333-8333-333333333333',hostID:'host',hostLifetime:'55555555-5555-4555-8555-555555555555',daemonServerId:'daemon',displayKey:Buffer.alloc(32,9).toString('base64url'),createdAt:now,deadline:now+28800000,
    titleHints:[{agentId:'other',workspaceId:'workspace',source:'workspace'}]});
  const requests:any[]=[];
  const cloud=new CloudClient('https://example.test',pair.pairId,pair.hostToken,false,(async(_url,init)=>{
   const body=JSON.parse(String(init?.body));requests.push(body);
   return new Response(JSON.stringify({
    ok:true,attention:body.attention.map((item:any)=>({id:item.id,accepted:true})),
    activity:{accepted:requests.length!==2},
   }),{headers:{'content-type':'application/json','x-moremote-live-activity':'2'}});
  }) as typeof fetch);
  cloud.liveActivityV2=true;cloud.liveActivityInterest={registrationId:'44444444-4444-4444-8444-444444444444',interest};
  const publisher=new LiveActivityPublisher(journal);
  const running={id:'agent',title:'Answer',status:'running',createdAt:new Date(now-100).toISOString(),
   lastUserMessageAt:new Date(now-10).toISOString(),activeTurn:{turnId:'turn-one',startedAt:new Date(now-10).toISOString()},pendingPermissions:[]};
  const snapshot={daemonServerId:'daemon',hostName:'host',agents:[running]};
  await publishEvents(pair,cloud,journal,publisher,snapshot,true);
  const previous=requests[0].activity.candidates[0];
  assert.equal(previous.phase,'running');

  const other={...running,id:'other',workspaceId:'workspace',title:'Unverified prompt'};
  const finished={...running,status:'idle',activeTurn:null,requiresAttention:true,attentionReason:'finished',attentionTimestamp:new Date(now).toISOString()};
  const partial={...snapshot,agents:[finished,other],requestWorkspace:()=>{throw Error('Synthetic workspace read failure')}};
  await queueAttention(journal,pair,{agentId:'agent',kind:'finished',timestamp:now});
  let publicationError:unknown;
  try{await publishEvents(pair,cloud,journal,publisher,partial,true)}catch(error){publicationError=error}
  assert.equal(requests.length,2);
  assert.equal(requests[1].attention.length,1);
  const contribution=requests[1].activity;
  assert.ok(contribution,'completion must be published even if another title is missing');
  assert.match(String(publicationError),/LIVE_ACTIVITY_NOT_ACCEPTED/);
  assert.equal(contribution.candidates.length,2);
  const target=contribution.candidates.find((row:any)=>row.topic===previous.topic);
  assert.equal(target.phase,'finished');
  assert.equal(target.cycle,previous.cycle);
  const otherTopic=await presenceTopic(decode(pair.rootKey,32),pair.pairId,other.id);
  assert.equal(contribution.candidates.find((row:any)=>row.topic===otherTopic).phase,'running');
  assert.equal(journal.attention(pair.pairId,Date.now()).length,0);

  const recovered={...partial,workspaces:[{id:'workspace',title:'Verified workspace'}]};
  await publishEvents(pair,cloud,journal,publisher,recovered,true);
  assert.deepEqual(requests[2].activity,contribution);
  assert.equal(requests[2].attention.length,0);
  await publishEvents(pair,cloud,journal,publisher,recovered,true);
  assert.equal(requests.length,4);
  assert.equal(requests[3].activity.candidates.find((row:any)=>row.topic===previous.topic).eventId,target.eventId);
  await publishEvents(pair,cloud,journal,publisher,recovered,true);
  assert.equal(requests.length,4);
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
