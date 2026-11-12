import test from 'node:test';
import assert from 'node:assert/strict';
import {ActivityPublisher,ActivityWorkLane,openActivityInterest,taskActivityState,widgetFingerprint,type ActivitySnapshot,type ActivityTask} from '../src/activity.ts';
import {openEnvelope,openHistoricalSnapshot,presenceTopic,sealEnvelope,validateEnvelope,type Envelope} from '../src/crypto.ts';
import {CloudClient} from '../src/cloud-client.ts';
import {object} from '../src/limits.ts';
type ActivityBody=Parameters<CloudClient['activityState']>[1];
import {AgentSnapshotPayloadSchema,ProviderUsageSchema} from '@getpaseo/protocol/messages';
import {projectTask,projectUsage} from '../src/official-client.ts';
const now=1_000_000_000,root=Buffer.alloc(32,19);
const pair={pairId:'11111111-1111-4111-8111-111111111111',rootKey:root.toString('base64url'),hostToken:Buffer.alloc(32,20).toString('base64url'),active:true};
const id='22222222-2222-4222-8222-222222222222',registrationId='33333333-3333-4333-8333-333333333333';
const otherId='44444444-4444-4444-8444-444444444444',otherRegistration='55555555-5555-4555-8555-555555555555';
const task:ActivityTask={agentId:'exact/agent',title:'Private task',status:'running',updatedAt:new Date(now).toISOString(),lastUserMessageAt:new Date(now-100000).toISOString(),activeTurnStartedAt:new Date(now-90000).toISOString(),requiresAttention:false,attentionReason:null,pendingRequests:[]};
function snapshot(tasks:ActivityTask[]=[task],measuredAt=now):ActivitySnapshot{return {daemonServerId:'daemon-exact',hostName:'Private host',measuredAt,tasks,usage:null}}
async function interest(agentId=task.agentId,subscriptionId=id,registration=registrationId){return {id:subscriptionId,registrationId:registration,topic:await presenceTopic(root,pair.pairId,agentId),expiresAt:now+8*3600000,interest:await sealEnvelope(root,{version:1,pairId:pair.pairId,id:subscriptionId,channel:'activityInterest',issuedAt:now,expiresAt:now+8*3600000},{version:1,subscriptionId,daemonServerId:'daemon-exact',agentId})}}
test('activity interest is pair/task/subscription/channel authenticated read-only data with eight-hour maximum',async()=>{
 const row=await interest();assert.equal((await openActivityInterest(pair,row,'daemon-exact',now)).agentId,task.agentId);
 await assert.rejects(openActivityInterest({...pair,rootKey:Buffer.alloc(32,22).toString('base64url')},row,'daemon-exact',now));
 await assert.rejects(openActivityInterest(pair,row,'different-daemon',now));
 await assert.rejects(openActivityInterest(pair,{...row,id:otherId},'daemon-exact',now));
 await assert.rejects(openActivityInterest(pair,{...row,topic:await presenceTopic(root,pair.pairId,'different-agent')},'daemon-exact',now));
 await assert.rejects(openActivityInterest(pair,{...row,extra:true},'daemon-exact',now));
 await assert.rejects(openActivityInterest(pair,row,'daemon-exact',row.expiresAt));
 assert.throws(()=>validateEnvelope({...row.interest,expiresAt:row.expiresAt+1},now));
 await assert.rejects(openHistoricalSnapshot(root,row.interest,now));
});
test('genuine task phases and timer anchors never fabricate a start or percentage',()=>{
 const running=taskActivityState(snapshot(),task,id,now+600000);assert.equal(running.phase,'running');assert.equal(running.startedAt,now-90000);assert.equal(running.isTerminal,false);
 assert.equal(taskActivityState(snapshot(),{...task,activeTurnStartedAt:null},id,now+1).startedAt,now-100000);
 assert.equal(taskActivityState(snapshot(),{...task,activeTurnStartedAt:null,lastUserMessageAt:null},id,now+1).startedAt,null);
 assert.equal(taskActivityState(snapshot(),{...task,activeTurnStartedAt:new Date(now+1).toISOString()},id,now+1).startedAt,null);
 for(const reason of ['finished','error']){const state=taskActivityState(snapshot(),{...task,status:'idle',requiresAttention:true,attentionReason:reason},id,now+1);assert.equal(state.phase,reason);assert.equal(state.isTerminal,true)}
 const waiting=taskActivityState(snapshot(),{...task,requiresAttention:true,attentionReason:'permission'},id,now+1);assert.equal(waiting.phase,'waiting');assert.equal(waiting.isTerminal,false);
 assert.equal(taskActivityState(snapshot(),{...task,requiresAttention:true,attentionReason:'finished'},id,now+1).phase,'running');
 assert.equal(taskActivityState(snapshot(),{...task,status:'closed'},id,now+1).phase,'finished');
 assert.equal(Object.hasOwn(running,'percentage'),false);
});
test('two conversations emit separate sealed update/end independent of alert and presence',async()=>{
 const subscriptions=[await interest(),await interest('other-agent',otherId,otherRegistration)];let lists=0;const writes:{id:string;body:ActivityBody}[]=[];
 const cloud={activities:async()=>{lists++;return subscriptions},activityState:async(id:string,body:ActivityBody)=>{writes.push({id,body});return {ok:true}}};
 const publisher=new ActivityPublisher();await publisher.publish(pair,cloud,snapshot([task,{...task,agentId:'other-agent',status:'idle',requiresAttention:true,attentionReason:'finished'}]),now);
 assert.equal(lists,1);assert.equal(writes.length,2);assert.deepEqual(writes.map(w=>w.body.event),['update','end']);
 assert.equal(writes[0].id,id);assert.equal(writes[1].id,otherId);
 const plaintext=object(await openEnvelope(root,writes[0].body.envelope,now));
 assert.equal(plaintext.agentId,task.agentId);assert.equal(plaintext.startedAt,now-90000);assert.equal(plaintext.measuredAt,now);
 assert.equal(plaintext.expiresAt,writes[0].body.envelope.expiresAt);assert.ok(!JSON.stringify(writes).includes('Private task'));
 await assert.rejects(openEnvelope(Buffer.alloc(32,99),writes[0].body.envelope,now));
 await publisher.publish(pair,cloud,snapshot(),now+29999);assert.equal(lists,1);
 await publisher.publish(pair,cloud,snapshot([task,{...task,agentId:'other-agent',status:'idle',requiresAttention:true,attentionReason:'finished'}],now+30000),now+30000);
 assert.equal(writes.length,2,'measurement-only changes do not trigger provider work');
});
test('lost acknowledgement retries immutable update; terminal transition supersedes it without alert admission',async()=>{
 const row=await interest(),writes:ActivityBody[]=[];let lose=true;
 const cloud={activities:async()=>[row],activityState:async(_id:string,body:ActivityBody)=>{writes.push(body);if(lose)throw Error('lost ack');return {ok:true}}};
 const publisher=new ActivityPublisher();await assert.rejects(publisher.publish(pair,cloud,snapshot(),now));
 await assert.rejects(publisher.publish(pair,cloud,snapshot([task],now+30000),now+30000));assert.deepEqual(writes[1],writes[0]);
 lose=false;await publisher.publish(pair,cloud,snapshot([{...task,status:'idle',requiresAttention:true,attentionReason:'finished'}],now+60000),now+60000);
 assert.equal(writes[2].event,'end');assert.notEqual(writes[2].envelope.id,writes[0].envelope.id);
});
test('rotation sends current registration, expired/deleted interests cannot emit, absent task never implies completion',async()=>{
 let rows=[await interest()];const writes:ActivityBody[]=[];let fallback=0;
 const cloud={activities:async()=>rows,activityState:async(_id:string,body:ActivityBody)=>{writes.push(body);return {ok:true}}};
 const publisher=new ActivityPublisher();await publisher.publish(pair,cloud,snapshot(),now);
 rows=[{...rows[0],registrationId:otherRegistration}];await publisher.publish(pair,cloud,snapshot([task],now+30000),now+30000);
 assert.equal(writes[1].registrationId,otherRegistration);
 await publisher.publish(pair,cloud,snapshot([],now+60000),now+60000,async()=>{fallback++;return null});assert.equal(writes.length,2);assert.equal(fallback,1);
 rows=[];await publisher.publish(pair,cloud,snapshot([task],now+90000),now+90000);assert.equal(writes.length,2);
 rows=[await interest()];await publisher.publish(pair,cloud,snapshot([task],now+8*3600000),now+8*3600000);assert.equal(writes.length,2);
 publisher.retain([]);
});
test('only exact authenticated interests cause bounded read-only fallback, malformed rows never cause official calls',async()=>{
 const row=await interest();const rows=[{...row,topic:'bad'},row];let reads=0;const writes:ActivityBody[]=[];
 const publisher=new ActivityPublisher();await publisher.publish(pair,{activities:async()=>rows,activityState:async(_id,body)=>{writes.push(body);return {ok:true}}},snapshot([]),now,async(agentId)=>{reads++;assert.equal(agentId,task.agentId);return task});
 assert.equal(reads,1);assert.equal(writes.length,1);
 await assert.rejects(new ActivityPublisher().publish(pair,{activities:async()=>Array(9).fill(row),activityState:async()=>({ok:true})},snapshot(),now),/LIMIT/);
});
test('widget fingerprint hides content and ignores clock/fetchedAt/order but changes on real task/usage changes',async()=>{
 const a=snapshot([task,{...task,agentId:'second'}]);a.usage={fetchedAt:'old',providers:[{providerId:'p',fetchedAt:'old',windows:[{remainingPct:50}]}]};
 const b={...a,measuredAt:now+30000,tasks:[...a.tasks].reverse(),usage:{fetchedAt:'new',providers:[{providerId:'p',fetchedAt:'new',windows:[{remainingPct:50}]}]}};
 const first=await widgetFingerprint(pair,a);assert.match(first,/^[A-Za-z0-9_-]{43}$/);assert.equal(first,await widgetFingerprint(pair,b));
 assert.notEqual(first,await widgetFingerprint(pair,{...a,tasks:[{...task,requiresAttention:true}]}));
 assert.notEqual(first,await widgetFingerprint(pair,{...a,usage:{providers:[{windows:[{remainingPct:49}]}]}}));
 assert.notEqual(first,await widgetFingerprint({...pair,rootKey:Buffer.alloc(32,2).toString('base64url')},a));
});
test('cloud client emits exact state fingerprint and separate normal/recovery activity requests',async()=>{
 const requests:{url:string;method:string;body:unknown}[]=[];
 const fetcher:typeof fetch=async(input,init)=>{requests.push({url:String(input),method:init?.method??'GET',body:typeof init?.body==='string'?JSON.parse(init.body):undefined});return Response.json({ok:true,subscriptions:[]})};
 const cloud=new CloudClient('http://localhost:18787',pair.pairId,pair.hostToken,true,fetcher);
 const envelope=(await interest()).interest as Envelope;
 await cloud.state(envelope,'A'.repeat(43));await cloud.activities();
 await cloud.activityState(id,{registrationId,topic:'A'.repeat(43),event:'update',envelope});await cloud.activityState(id,{registrationId,topic:'A'.repeat(43),event:'end',envelope});
 assert.deepEqual(requests[0].body,{envelope,widgetFingerprint:'A'.repeat(43)});assert.equal(requests[1].method,'GET');
 assert.ok(requests[2].url.endsWith('/activities/'+id+'/state'));assert.ok(requests[3].url.endsWith('/activities/'+id+'/end'));
});
test('official schema task projects real turn anchors and finish/question/error state into sealed activity updates',async()=>{
 const source=AgentSnapshotPayloadSchema.parse({id:task.agentId,provider:'claude',cwd:'/synthetic/project',model:null,
  createdAt:new Date(now-200000).toISOString(),updatedAt:new Date(now).toISOString(),lastUserMessageAt:task.lastUserMessageAt,
  activeTurn:{turnId:'turn-exact',startedAt:task.activeTurnStartedAt},status:'running',
  capabilities:{supportsStreaming:true,supportsSessionPersistence:true,supportsDynamicModes:false,supportsMcpServers:false,supportsReasoningStream:false,supportsToolInvocations:true},
  currentModeId:null,availableModes:[],pendingPermissions:[],persistence:null,title:'Synthetic task'});
 const row=await interest(),writes:ActivityBody[]=[];
 const cloud={activities:async()=>[row],activityState:async(_id:string,body:ActivityBody)=>{writes.push(body);return {ok:true}}};
 const publisher=new ActivityPublisher();
 await publisher.publish(pair,cloud,snapshot([projectTask(source)]),now);
 assert.equal(object(await openEnvelope(root,writes[0].envelope,now)).startedAt,now-90000);
 await publisher.publish(pair,cloud,snapshot([projectTask({...source,requiresAttention:true,attentionReason:'permission'})],now+30000),now+30000);
 assert.equal(object(await openEnvelope(root,writes[1].envelope,now+30000)).phase,'waiting');
 await publisher.publish(pair,cloud,snapshot([projectTask({...source,status:'idle',requiresAttention:true,attentionReason:'finished'})],now+60000),now+60000);
 assert.equal(writes[2].event,'end');assert.equal(object(await openEnvelope(root,writes[2].envelope,now+60000)).phase,'finished');
 assert.equal(projectTask(source).cwd,'/synthetic/project');
});
test('new activity channels remain key-separated and cannot authorize historical reads or commands',async()=>{
 const row=await interest();await assert.rejects(openEnvelope(root,{...row.interest,channel:'command'},now));
 const state=await sealEnvelope(root,{version:1,pairId:pair.pairId,id:otherId,channel:'activityState',issuedAt:now,expiresAt:now+600000},taskActivityState(snapshot(),task,id,now+600000));
 await assert.rejects(openEnvelope(root,{...state,channel:'state'},now));
 await assert.rejects(openEnvelope(root,{...state,pairId:otherId},now));
 await assert.rejects(openHistoricalSnapshot(root,state,now));
 assert.throws(()=>validateEnvelope({...state,expiresAt:now+600001},now));
});
test('official usage projection retains genuine bounded display labels and unavailable values',()=>{
 const provider=ProviderUsageSchema.parse({providerId:'opaque-id',displayName:'Official provider name',status:'available',planLabel:null,
  windows:[{id:'five_hour',label:'Official five-hour window',remainingPct:25,usedPct:75}],
  balances:[{id:'credit',label:'Official credit balance',remaining:12,unit:'usd'}]});
 const projected=projectUsage({fetchedAt:'source-time',providers:[provider]});
 assert.equal(projected.providers[0].displayName,'Official provider name');
 assert.equal(projected.providers[0].windows[0].label,'Official five-hour window');
 assert.equal(projected.providers[0].balances?.[0].label,'Official credit balance');
 assert.equal(projected.providers[0].windows[0].remainingPct,25);
 const unavailable=projectUsage({fetchedAt:'source-time',providers:[{...provider,displayName:'x'.repeat(200),status:'unavailable',windows:[{...provider.windows[0],label:'w'.repeat(200),remainingPct:null,usedPct:null}]}]});
 assert.equal(unavailable.providers[0].displayName.length,128);assert.equal(unavailable.providers[0].windows[0].label.length,128);
 assert.equal(unavailable.providers[0].windows[0].remainingPct,null);
});
test('acknowledged running state renews before expiry from a fresh measurement while unknown retries remain immutable',async()=>{
 const row=await interest(),writes:ActivityBody[]=[];let lose=false;
 const cloud={activities:async()=>[row],activityState:async(_id:string,body:ActivityBody)=>{writes.push(body);if(lose)throw Error('unknown');return {ok:true}}};
 const publisher=new ActivityPublisher();await publisher.publish(pair,cloud,snapshot(),now);
 await publisher.publish(pair,cloud,snapshot([task],now+450000),now+450000);assert.equal(writes.length,1);
 await publisher.publish(pair,cloud,snapshot([task],now+480000),now+480000);assert.equal(writes.length,2);
 assert.notEqual(writes[1].envelope.id,writes[0].envelope.id);
 assert.equal(writes[1].envelope.issuedAt,now+480000);assert.equal(writes[1].envelope.expiresAt,now+1080000);
 lose=true;await assert.rejects(publisher.publish(pair,cloud,snapshot([{...task,requiresAttention:true,attentionReason:'permission'}],now+510000),now+510000));
 await assert.rejects(publisher.publish(pair,cloud,snapshot([{...task,requiresAttention:true,attentionReason:'permission'}],now+990000),now+990000));
 assert.deepEqual(writes[3],writes[2]);
});
test('cached live authenticated interests permit terminal recovery without normal discovery or progress writes',async()=>{
 const row=await interest(),writes:ActivityBody[]=[];let lists=0;
 const cloud={activities:async()=>{lists++;if(lists>1)throw Error('normal quota');return [row]},activityState:async(_id:string,body:ActivityBody)=>{writes.push(body);return {ok:true}}};
 const publisher=new ActivityPublisher();await publisher.publish(pair,cloud,snapshot(),now);
 await publisher.publish(pair,cloud,snapshot([{...task,status:'idle',requiresAttention:true,attentionReason:'finished'}],now+30000),now+30000,undefined,{terminalOnly:true});
 assert.equal(lists,1);assert.equal(writes[1].event,'end');
 await publisher.publish(pair,cloud,snapshot([task],now+60000),now+60000,undefined,{terminalOnly:true});assert.equal(writes.length,2);
 publisher.retain([]);await publisher.publish(pair,cloud,snapshot([{...task,status:'closed'}],now+90000),now+90000,undefined,{terminalOnly:true});assert.equal(writes.length,2);
});
test('cancelled activity work never starts another fallback or upload after the active read settles',async()=>{
 const rows=[await interest(),await interest('second',otherId,otherRegistration)];const controller=new AbortController();let reads=0,writes=0;
 const publisher=new ActivityPublisher();const gate=Promise.withResolvers<ActivityTask|null>(),entered=Promise.withResolvers<void>();
 const pass=publisher.publish(pair,{activities:async()=>rows,activityState:async()=>{writes++;return {ok:true}}},snapshot([]),now,async()=>{reads++;controller.abort();entered.resolve();return gate.promise},{signal:controller.signal});
 await entered.promise;gate.resolve(task);await assert.rejects(pass);
 assert.equal(reads,1);assert.equal(writes,0);
});
test('optional activity lane is single-flight, cancels its owned request and joins on shutdown',async()=>{
 const lane=new ActivityWorkLane(),entered=Promise.withResolvers<void>(),settled=Promise.withResolvers<void>();let errors=0;
 assert.equal(lane.start(async signal=>{entered.resolve();signal.addEventListener('abort',()=>settled.resolve(),{once:true});await settled.promise},()=>{errors++}),true);
 await entered.promise;assert.equal(lane.start(async()=>{},()=>{}),false);
 await lane.close();await settled.promise;assert.equal(errors,0);
});
test('real cloud client terminal request survives explicit normal quota exhaustion using cached encrypted interest',async()=>{
 const row=await interest(),requests:string[]=[],reset=Date.now()+60000;
 const fetcher:typeof fetch=async(input)=>{
  const path=new URL(String(input)).pathname;requests.push(path);
  if(path.endsWith('/activities'))return Response.json({ok:true,subscriptions:[row]});
  if(path.endsWith('/state')&&!path.includes('/activities/'))return Response.json({ok:false,error:{code:'daily_work_limit'}},{status:429,headers:{'retry-after':'60','x-moremote-budget':'normal','x-moremote-reset':String(reset)}});
  return Response.json({ok:true});
 };
 const cloud=new CloudClient('http://localhost:18787',pair.pairId,pair.hostToken,true,fetcher,undefined,{},{}),publisher=new ActivityPublisher();
 await publisher.publish(pair,cloud,snapshot(),now);
 await assert.rejects(cloud.state(row.interest));
 await publisher.publish(pair,cloud,snapshot([{...task,status:'idle',requiresAttention:true,attentionReason:'finished'}],now+30000),now+30000,undefined,{terminalOnly:true});
 assert.equal(requests.filter(path=>path.endsWith('/activities')).length,1);
 assert.ok(requests.at(-1)?.endsWith('/activities/'+id+'/end'));
});
