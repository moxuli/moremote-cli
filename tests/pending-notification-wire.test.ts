import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {WebSocketServer} from 'ws';
import {AgentSnapshotPayloadSchema,wrapSessionMessage,type SessionOutboundMessage} from '@getpaseo/protocol/messages';
import {OfficialClient,type Attention} from '../src/official-client.ts';
import {OperationJournal} from '../src/journal.ts';
import {occurrenceBinding} from '../src/bindings.ts';
import {queueAttention} from '../src/runtime.ts';
import {boundCurrent} from '../src/operations.ts';
import {canonical,digest} from '../src/journal.ts';

for(const attention of [{requiresAttention:true,attentionReason:'finished'},{requiresAttention:false,attentionReason:null},{requiresAttention:true,attentionReason:'permission'}] as const){
 test(`current pending request notifies despite stale global attention: ${JSON.stringify(attention)}`,{timeout:10000},async t=>{
  const directory=await mkdtemp(join(tmpdir(),'moremote-request-clock-'));
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
  const address=server.address();assert.ok(address&&typeof address!=='string');
  const old=new Date(Date.now()-86400000).toISOString();let updatedAt=new Date().toISOString();
  let request={id:'current-plan',provider:'mock',name:'MockPlanApproval',kind:'plan',input:{plan:'Review the synthetic plan'},actions:[{id:'implement',label:'Implement',behavior:'allow'},{id:'dismiss',label:'Dismiss',behavior:'deny'}]};
  const agent=()=>AgentSnapshotPayloadSchema.parse({id:'synthetic-agent',provider:'mock',cwd:'/synthetic',model:null,createdAt:old,updatedAt,lastUserMessageAt:updatedAt,status:'running',capabilities:{supportsStreaming:true,supportsSessionPersistence:true,supportsDynamicModes:false,supportsMcpServers:false,supportsReasoningStream:false,supportsToolInvocations:true},currentModeId:null,availableModes:[],pendingPermissions:[request],persistence:null,title:'Synthetic current plan',...attention,attentionTimestamp:old});
  server.on('connection',socket=>{
   const reply=(message:unknown)=>socket.send(JSON.stringify(wrapSessionMessage(message as Parameters<typeof wrapSessionMessage>[0])));
   socket.on('message',data=>{const frame=JSON.parse(data.toString());if(frame.type==='hello')reply({type:'status',payload:{status:'server_info',serverId:'synthetic-daemon',features:{explicitEventSubscriptions:true}}});
    else if(frame.type==='ping')socket.send(JSON.stringify({type:'pong'}));
    else if(frame.type==='session'){const message=frame.message;
     if(message.type==='session.events.set_subscription.request')reply({type:'session.events.set_subscription.response',payload:{requestId:message.requestId,subscriptionId:'synthetic-subscription'}});
     else if(message.type==='subscription.release.request')reply({type:'subscription.release.response',payload:{requestId:message.requestId,subscriptionId:message.subscriptionId}});
     else if(message.type==='fetch_agent_request')reply({type:'fetch_agent_response',payload:{requestId:message.requestId,agent:agent(),project:null,error:null}});
     else if(message.type==='fetch_agents_request')reply({type:'fetch_agents_response',payload:{requestId:message.requestId,entries:[{agent:agent(),project:{projectKey:'synthetic-project',projectName:'Synthetic project',checkout:{cwd:'/synthetic',isGit:true,currentBranch:null,remoteUrl:null,isPaseoOwnedWorktree:false}}}],pageInfo:{nextCursor:null,prevCursor:null,hasMore:false}}});
    }
   });
  });
  const journal=new OperationJournal(join(directory,'journal.sqlite'));
  const official=new OfficialClient({version:1,clientId:'pending-request-clock',target:'tcp://127.0.0.1:'+address.port+'?password=synthetic',paseoHome:directory,cloudEnabled:false,pairs:[]},journal);
  const pair={pairId:'11111111-1111-4111-8111-111111111111',rootKey:Buffer.alloc(32,7).toString('base64url'),hostToken:'synthetic',active:true};
  const observed:Attention[]=[];official.onAttention(event=>observed.push(event));
  try{
   const startedAt=Date.now();await official.connect();await official.snapshot();
   const first=observed.find(event=>event.requestId===request.id);assert.ok(first,'authoritative current request must produce a notice independently of the global attention hint');
   const occurrence=journal.currentOccurrence('synthetic-daemon','synthetic-agent',request.id)!;
   assert.deepEqual(first.occurrence,occurrence,'the notice must capture its exact current occurrence at observation');
   assert.equal(first.timestamp,occurrence.createdAt);assert.ok(first.timestamp>=startedAt&&first.timestamp<=Date.now());
   const binding=await occurrenceBinding(pair,occurrence);
   await queueAttention(journal,pair,{...first,occurrence,requestBinding:binding,sourceFingerprint:occurrence.fingerprint});const original=journal.attention(pair.pairId,Date.now());assert.equal(original.length,1);
   updatedAt=new Date(Date.now()+1).toISOString();await official.snapshot();
   for(const event of observed.filter(event=>event.requestId===request.id))await queueAttention(journal,pair,{...event,occurrence,requestBinding:binding,sourceFingerprint:occurrence.fingerprint});
   assert.deepEqual(journal.attention(pair.pairId,Date.now()),original,'unchanged request observation must retain one immutable notification');
   assert.ok(observed.filter(event=>event.requestId===request.id).every(event=>event.timestamp===occurrence.createdAt));
   request={...request,input:{plan:'Replacement synthetic plan'}};
   const next=Promise.withResolvers<Attention>();const unlisten=official.onAttention(event=>{if(event.requestId===request.id)next.resolve(event)});
   const aborted=()=>next.reject(t.signal.reason);t.signal.addEventListener('abort',aborted,{once:true});
   for(const socket of server.clients)socket.send(JSON.stringify(wrapSessionMessage({type:'agent_permission_request',payload:{agentId:'synthetic-agent',request}} as Parameters<typeof wrapSessionMessage>[0])));
   const replacement=await next.promise.finally(()=>{t.signal.removeEventListener('abort',aborted);unlisten()});const changed=journal.currentOccurrence('synthetic-daemon','synthetic-agent',request.id)!;
   assert.deepEqual(replacement.occurrence,changed,'the replacement notice must carry its new source identity');
   assert.notEqual(changed.occurrenceId,occurrence.occurrenceId);assert.equal(replacement.timestamp,changed.createdAt);assert.equal(journal.isCurrent(occurrence),false);
   assert.notEqual(await occurrenceBinding(pair,changed),binding);
  }finally{
   await official.close();journal.close();for(const socket of server.clients)socket.terminate();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});
  }
 });
}

async function delayedRequests(t:test.TestContext){
 const directory=await mkdtemp(join(tmpdir(),'moremote-pending-race-'));
 const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
 const address=server.address();assert.ok(address&&typeof address!=='string');
 const request={id:'synthetic-request',provider:'mock',name:'MockPlanApproval',kind:'plan',input:{plan:'Original synthetic plan'},actions:[{id:'allow',label:'Allow',behavior:'allow'},{id:'deny',label:'Deny',behavior:'deny'}]};
 const old=new Date(Date.now()-86400000).toISOString();let current:typeof request|undefined=request;
 const agent=()=>AgentSnapshotPayloadSchema.parse({id:'synthetic-agent',provider:'mock',cwd:'/synthetic',model:null,createdAt:old,updatedAt:old,lastUserMessageAt:old,status:'running',capabilities:{supportsStreaming:true,supportsSessionPersistence:true,supportsDynamicModes:false,supportsMcpServers:false,supportsReasoningStream:false,supportsToolInvocations:true},currentModeId:null,availableModes:[],pendingPermissions:current?[current]:[],persistence:null,title:'Synthetic pending request',requiresAttention:false,attentionReason:null,attentionTimestamp:old});
 let hold:'fetch_agent_request'|'fetch_agents_request'|undefined,captured=Promise.withResolvers<()=>void>();
 const wire:string[]=[];
 server.on('connection',socket=>{
  const reply=(message:SessionOutboundMessage)=>socket.send(JSON.stringify(wrapSessionMessage(message)));
  socket.on('message',data=>{
   const frame=JSON.parse(data.toString());
   if(frame.type==='hello')reply({type:'status',payload:{status:'server_info',serverId:'synthetic-daemon',features:{explicitEventSubscriptions:true}}});
   else if(frame.type==='ping')socket.send(JSON.stringify({type:'pong'}));
   else if(frame.type==='session'){
    const message=frame.message;wire.push(message.type);
    if(message.type==='session.events.set_subscription.request')reply({type:'session.events.set_subscription.response',payload:{requestId:message.requestId,subscriptionId:'synthetic-subscription'}});
    else if(message.type==='subscription.release.request')reply({type:'subscription.release.response',payload:{requestId:message.requestId,subscriptionId:message.subscriptionId}});
    else if(message.type==='fetch_agent_request'||message.type==='fetch_agents_request'){
     const value=agent(),response:SessionOutboundMessage=message.type==='fetch_agent_request'?{type:'fetch_agent_response',payload:{requestId:message.requestId,agent:message.agentId==='synthetic-barrier'?null:value,project:null,error:null}}:{type:'fetch_agents_response',payload:{requestId:message.requestId,entries:[{agent:value,project:{projectKey:'synthetic-project',projectName:'Synthetic project',checkout:{cwd:'/synthetic',isGit:true,currentBranch:null,remoteUrl:null,isPaseoOwnedWorktree:false}}}],pageInfo:{nextCursor:null,prevCursor:null,hasMore:false}}};
     if(hold===message.type){hold=undefined;captured.resolve(()=>reply(response))}else reply(response);
    }
   }
  });
 });
 const journal=new OperationJournal(join(directory,'journal.sqlite'));
 const official=new OfficialClient({version:1,clientId:'moremote-cli-pending-race',target:'tcp://127.0.0.1:'+address.port+'?password=synthetic',paseoHome:directory,allowLoopbackHttp:false,cloudEnabled:false,pairs:[]},journal);
 t.after(async()=>{for(const socket of server.clients)socket.terminate();await official.close();journal.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true})});
 const pair={pairId:'11111111-1111-4111-8111-111111111111',rootKey:Buffer.alloc(32,7).toString('base64url'),hostToken:'synthetic',active:true};
 const observed:Attention[]=[];official.onAttention(event=>observed.push(event));
 const wait=<T>(promise:Promise<T>)=>new Promise<T>((resolve,reject)=>{
  const aborted=()=>reject(t.signal.reason);t.signal.addEventListener('abort',aborted,{once:true});
  promise.then(resolve,reject).finally(()=>t.signal.removeEventListener('abort',aborted));
 });
 const publish=async(event:Attention)=>{const occurrence=journal.currentOccurrence('synthetic-daemon','synthetic-agent',request.id);assert.ok(occurrence);await queueAttention(journal,pair,{...event,occurrence,requestBinding:await occurrenceBinding(pair,occurrence),sourceFingerprint:occurrence.fingerprint})};
 await official.connect();await official.snapshot();await publish(observed[0]);
 return {official,journal,pair,observed,request,wire,publish,wait,
  capture(kind:'current'|'snapshot'|'bound'){
   captured=Promise.withResolvers<()=>void>();hold=kind==='snapshot'?'fetch_agents_request':'fetch_agent_request';
   const result=kind==='snapshot'?official.snapshot():kind==='current'?official.current('synthetic-agent'):boundCurrent({pair,journal,official},'synthetic-agent');void result.catch(()=>{});
   return {result,release:wait(captured.promise)};
  },
  stage(newer:'resolution'|'replacement'){current=newer==='resolution'?undefined:{...request,input:{plan:'Replacement synthetic plan'}}},
  async resolve(){
   const seen=Promise.withResolvers<void>(),off=official.sdk.subscribeRawMessages(message=>{if(message.type==='agent_permission_resolved')seen.resolve()});
   try{for(const socket of server.clients)socket.send(JSON.stringify(wrapSessionMessage({type:'agent_permission_resolved',payload:{agentId:'synthetic-agent',requestId:request.id,resolution:{behavior:'deny',selectedActionId:'deny'}}})));await wait(seen.promise)}finally{off()}
  },
  async replace(queryOnly=false){
   current={...request,input:{plan:'Replacement synthetic plan'}};
   if(queryOnly){await official.snapshot();await publish(observed.at(-1)!);return}
   const seen=Promise.withResolvers<Attention>(),off=official.onAttention(event=>{if(event.requestId===request.id)seen.resolve(event)});
   try{for(const socket of server.clients)socket.send(JSON.stringify(wrapSessionMessage({type:'agent_permission_request',payload:{agentId:'synthetic-agent',request:current}} as SessionOutboundMessage)));const event=await wait(seen.promise);await publish(event)}finally{off()}
  },
  async flush(){for(let turn=0;turn<2;turn++)await official.sdk.fetchAgent({agentId:'synthetic-barrier',timeout:2000})}
 };
}

for(const query of ['current','snapshot'] as const)for(const newer of ['resolution','replacement','query'] as const)test('delayed '+query+' cannot revive a request after a newer '+newer,{timeout:10000},async t=>{
 const f=await delayedRequests(t),original=f.journal.currentOccurrence('synthetic-daemon','synthetic-agent',f.request.id)!;
 const originalBinding=await occurrenceBinding(f.pair,original),delayed=f.capture(query),release=await delayed.release;
 if(newer==='resolution')await f.resolve();else await f.replace(newer==='query');
 const expected=f.journal.currentOccurrence('synthetic-daemon','synthetic-agent',f.request.id);
 assert.equal(f.journal.isCurrent(original),false);
 const binding=expected?await occurrenceBinding(f.pair,expected):undefined,notices=f.journal.attention(f.pair.pairId,Date.now()),observations=f.observed.length;
 if(newer==='resolution')assert.equal(expected,undefined);else{assert.ok(expected);assert.notEqual(binding,originalBinding)}
 release();await delayed.result;await f.flush();
 assert.deepEqual(f.journal.currentOccurrence('synthetic-daemon','synthetic-agent',f.request.id),expected,'a delayed read must not create or replace an occurrence');
 assert.equal(f.observed.length,observations,'a delayed read must not emit a fresh pending notification');
 assert.deepEqual(f.journal.attention(f.pair.pairId,Date.now()),notices,'a delayed read must not resurrect retired encrypted notices');
 if(expected)assert.equal(await occurrenceBinding(f.pair,expected),binding);
 assert.ok(!f.wire.some(type=>['send_agent_message_request','agent_permission_response','client_heartbeat','clear_agent_attention','register_push_token'].includes(type)));
});

test('boundCurrent retains caller synchronization for adapters without a journal owner', {timeout:10000},async t=>{
 const f=await delayedRequests(t);let request=f.request;
 const official={current:async()=>({id:'synthetic-agent',pendingPermissions:[request]}),send:async()=>{},permission:async()=>{},reconcile:async()=>null,requestContext:()=>({serverId:'synthetic-stub',generation:'synthetic-generation'})};
 const context={pair:f.pair,journal:f.journal,official};
 const first=await boundCurrent(context,'synthetic-agent'),original=f.journal.currentOccurrence('synthetic-stub','synthetic-agent',request.id)!;
 assert.ok(original);assert.equal(first?.pendingPermissions?.[0]?.requestBinding,await occurrenceBinding(f.pair,original));
 request={...request,input:{plan:'Replacement stub source'}};
 const next=await boundCurrent(context,'synthetic-agent'),replacement=f.journal.currentOccurrence('synthetic-stub','synthetic-agent',request.id)!;
 assert.equal(f.journal.isCurrent(original),false);assert.equal(replacement.fingerprint,digest(canonical(request)));
 assert.notEqual(next?.pendingPermissions?.[0]?.requestBinding,first?.pendingPermissions?.[0]?.requestBinding);
});

for(const newer of ['resolution','replacement'] as const)test('boundCurrent continuation cannot restore an older source after same-batch '+newer,{timeout:10000},async t=>{
 const f=await delayedRequests(t),original=f.journal.currentOccurrence('synthetic-daemon','synthetic-agent',f.request.id)!;
 const delayed=f.capture('bound'),releaseOlder=await delayed.release;
 f.stage(newer);const fresh=f.capture('snapshot'),releaseNewer=await fresh.release;
 // Both real SDK replies are written in one server turn. The newer snapshot
 // can synchronize while the older current() promise is adopting its result.
 releaseOlder();releaseNewer();
 const [bound,snapshot]=await Promise.all([delayed.result,fresh.result]);assert.ok(snapshot&&'tasks' in snapshot);
 const expected=snapshot.tasks[0]?.pendingRequests[0]?.request;
 if(newer==='resolution')assert.deepEqual(snapshot.tasks,[],'resolved tasks do not become a general cloud directory');
 const occurrence=f.journal.currentOccurrence('synthetic-daemon','synthetic-agent',f.request.id);
 if(newer==='resolution')assert.equal(occurrence,undefined,'the consumer continuation must not revive a retired occurrence');
 else{assert.ok(occurrence);assert.equal(occurrence.fingerprint,digest(canonical(expected)),'the consumer continuation must retain the newer source')}
 assert.equal(f.journal.isCurrent(original),false);
 if(bound){assert.ok('pendingPermissions' in bound);assert.equal(bound.pendingPermissions?.[0]?.requestBinding,undefined,'an older source must not acquire the newer occurrence binding')}
});
