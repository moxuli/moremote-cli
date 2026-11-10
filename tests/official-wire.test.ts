import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {WebSocketServer} from 'ws';
import {AgentSnapshotPayloadSchema,AgentTimelineEntryPayloadSchema,SessionOutboundMessageSchema,wrapSessionMessage,type FetchAgentTimelineResponseMessage} from '@getpaseo/protocol/messages';
import {OfficialClient,type Attention} from '../src/official-client.ts';
import {OperationJournal} from '../src/journal.ts';
import {executeOperation,reconcileJournal} from '../src/operations.ts';
import {sealEnvelope,openEnvelope} from '../src/crypto.ts';
import {queueAttention} from '../src/runtime.ts';

const agent=AgentSnapshotPayloadSchema.parse({id:'synthetic-agent',provider:'claude',cwd:'/synthetic/project',model:null,createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z',lastUserMessageAt:null,status:'idle',capabilities:{supportsStreaming:true,supportsSessionPersistence:true,supportsDynamicModes:false,supportsMcpServers:false,supportsReasoningStream:false,supportsToolInvocations:true},currentModeId:null,availableModes:[],pendingPermissions:[],persistence:null,title:'Synthetic task'});

async function bounded<T>(promise:Promise<T>,milliseconds:number,code:string){
 const controller=new AbortController();
 try{return await Promise.race([promise,sleep(milliseconds,undefined,{signal:controller.signal}).then(()=>{throw Error(code)})]);}
 finally{controller.abort();}
}

for(const ownedSubscriptions of [false,true])test(`real SDK wire (${ownedSubscriptions?'owned':'legacy'} subscriptions): attention/identity, liveness only and no uncertain mutation redispatch`,{timeout:40000},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'moremote-wire-'));
 const server=new WebSocketServer({host:'127.0.0.1',port:0});
 const timers=new AbortController();
 const fixtureFailure=Promise.withResolvers<never>();
 void fixtureFailure.promise.catch(()=>{});
 const clients=new Set<OfficialClient>(),journals=new Set<OperationJournal>();
 let cleanupPromise:Promise<void>|undefined;
 const cleanup=()=>cleanupPromise??=(async()=>{
  timers.abort();
  // Tear down the wire before SDK disposal: no subscription-release RPC may
  // prevent fixture cleanup when the test or a synthetic response is invalid.
  for(const socket of server.clients)socket.terminate();
  const closingServer=new Promise<void>((resolve,reject)=>server.close(error=>{
   if(error&&error.message!=='The server is not running')reject(error);else resolve();
  }));
  const results=await Promise.allSettled([
   bounded(closingServer,3000,'WIRE_SERVER_CLOSE_TIMEOUT'),
   ...[...clients].map(client=>bounded(client.sdk.close(),3000,'WIRE_SDK_DISPOSE_TIMEOUT')),
  ]);
  const failures=results.flatMap(result=>result.status==='rejected'?[result.reason]:[]);
  for(const journal of journals){try{journal.close();}catch(error){failures.push(error);}}
  try{await rm(dir,{recursive:true,force:true});}catch(error){failures.push(error);}
  if(failures.length)throw new AggregateError(failures,'WIRE_FIXTURE_CLEANUP_FAILED');
 })();
 t.after(cleanup);
 t.signal.addEventListener('abort',()=>{void cleanup().catch(()=>{});},{once:true});
 server.on('error',error=>fixtureFailure.reject(error));
 const delay=(milliseconds:number)=>sleep(milliseconds,undefined,{signal:timers.signal});
 await once(server,'listening');
 const address=server.address();assert.ok(address&&typeof address!=='string');
 const wire:any[]=[];
 let connections=0,mutations=0,acknowledge=true,lastSend:any;
 let timelineEntries:FetchAgentTimelineResponseMessage['payload']['entries']=[];
 let currentAgent=agent;
 let holdAgentRead:((reply:()=>void)=>void)|undefined;
 let agentReads=0;
 server.on('connection',socket=>{
  connections++;
  const reply=(message:unknown)=>socket.send(JSON.stringify(wrapSessionMessage(SessionOutboundMessageSchema.parse(message))));
  socket.on('error',error=>fixtureFailure.reject(error));
  socket.on('message',data=>{
   try{
    const frame=JSON.parse(data.toString());wire.push(frame);
    if(frame.type==='hello')reply({type:'status',payload:{status:'server_info',serverId:'synthetic-daemon',hostname:'Synthetic host',version:'0.15.3',features:{explicitEventSubscriptions:true,ownedSubscriptions}}});
    else if(frame.type==='ping')socket.send(JSON.stringify({type:'pong'}));
    else if(frame.type==='session'){
     const m=frame.message;
     if(m.type==='session.events.set_subscription.request')reply({type:'session.events.set_subscription.response',payload:{requestId:m.requestId,subscriptionId:'synthetic-subscription'}});
     else if(m.type==='fetch_agent_request'){
      if(m.agentId===agent.id)agentReads++;
      const value=currentAgent,send=()=>reply({type:'fetch_agent_response',payload:{requestId:m.requestId,agent:value,project:null,error:null}});
      const hold=holdAgentRead;holdAgentRead=undefined;if(hold)hold(send);else send();
     }
     else if(m.type==='fetch_agents_request')reply({type:'fetch_agents_response',payload:{requestId:m.requestId,entries:[{agent:currentAgent,project:{projectKey:'synthetic-project',projectName:'Synthetic project',checkout:{cwd:agent.cwd,isGit:true,currentBranch:null,remoteUrl:null,isPaseoOwnedWorktree:false}}}],pageInfo:{nextCursor:null,prevCursor:null,hasMore:false}}});
     else if(m.type==='send_agent_message_request'){
      mutations++;lastSend=m;
      if(acknowledge)reply({type:'send_agent_message_response',payload:{requestId:m.requestId,agentId:m.agentId,accepted:true,error:null}});
      else socket.terminate();
     }
     else if(m.type==='fetch_agent_timeline_request')reply({type:'fetch_agent_timeline_response',payload:{requestId:m.requestId,agentId:agent.id,agent,direction:'tail',projection:'canonical',epoch:'synthetic-epoch',reset:false,staleCursor:false,gap:false,window:{minSeq:timelineEntries.length?1:0,maxSeq:timelineEntries.length,nextSeq:timelineEntries.length+1},startCursor:null,endCursor:null,hasOlder:false,hasNewer:false,entries:timelineEntries,error:null}});
     else if(m.type==='subscription.release.request')reply({type:'subscription.release.response',payload:{requestId:m.requestId,subscriptionId:m.subscriptionId}});
    }
   }catch(error){fixtureFailure.reject(error);socket.terminate();}
  });
 });
 const config={version:1 as const,clientId:'moremote-cli-wire-test',target:'tcp://127.0.0.1:'+address.port+'?password=synthetic-wire',paseoHome:dir,allowLoopbackHttp:true,cloudEnabled:false,pairs:[]};
 const makeClient=(journal:OperationJournal)=>{const client=new OfficialClient(config,journal);clients.add(client);return client;};
 const makeJournal=()=>{const journal=new OperationJournal(join(dir,'journal.sqlite'));journals.add(journal);return journal;};
 let journal=makeJournal(),official=makeClient(journal);
 const pair={pairId:'11111111-1111-4111-8111-111111111111',rootKey:Buffer.alloc(32,7).toString('base64url'),hostToken:'synthetic',active:true};
 const id='22222222-2222-4222-8222-222222222222';
 const cloud={dispatch:async()=>({dispatchAllowed:true}),receipt:async()=>({ok:true})};
 const scenario=async()=>{
  await official.connect();await delay(11000);
  assert.ok(wire.some(m=>m.type==='ping'),'SDK liveness interval must actually elapse');
  const hello=wire.find(m=>m.type==='hello');assert.equal(hello.clientId,config.clientId);assert.equal(hello.clientType,'cli');
  const subscription=wire.find(m=>m.message?.type==='session.events.set_subscription.request').message;
  const required=['agent_attention_required','agent_permission_request','agent_permission_resolved'];
  for(const event of required)assert.ok(subscription.events.includes(event),`missing authoritative stream ${event}`);
  assert.ok(subscription.events.every((event:string)=>[...required,'status.server_info'].includes(event)),'must not widen subscriptions');
  assert.equal(new Set(subscription.events).size,subscription.events.length);assert.equal(subscription.notifications,false);
  // Legacy negotiation filters the status interest, but hello still hydrates identity.
  assert.equal(official.info()?.serverId,'synthetic-daemon');assert.equal(official.info()?.hostname,'Synthetic host');assert.equal(official.requestContext().serverId,'synthetic-daemon');
  const observed:Attention[]=[],publications:Promise<void>[]=[];
  const noticeNow=Date.now(),base=noticeNow-10000;
  const stopAttention=official.onAttention(event=>{observed.push(event);publications.push(queueAttention(journal,pair,event,noticeNow));});
  const announce=(kind:'finished'|'error',timestamp:number)=>{
   for(const socket of server.clients)socket.send(JSON.stringify(wrapSessionMessage(SessionOutboundMessageSchema.parse({type:'agent_attention_required',payload:{subscriptionId:'synthetic-subscription',agentId:agent.id,reason:kind,timestamp:new Date(timestamp).toISOString(),shouldNotify:false}}))));
  };
  const terminal=(kind:'finished'|'error',timestamp:number)=>AgentSnapshotPayloadSchema.parse({...agent,status:kind==='finished'?'idle':'error',lastUserMessageAt:new Date(timestamp-1000).toISOString(),updatedAt:new Date(timestamp+2).toISOString(),requiresAttention:true,attentionReason:kind,attentionTimestamp:new Date(timestamp).toISOString(),activeTurn:null});
  const flushWire=async()=>{
   // Drain both directions without observing or changing the tested agent.
   for(let i=0;i<2;i++)await official.sdk.fetchAgent({agentId:'synthetic-barrier',timeout:2000});
  };
  for(const [index,kind] of (['finished','error'] as const).entries()){
   const timestamp=base+index*1000;
   currentAgent=terminal(kind,timestamp);
   const attention=Promise.withResolvers<Attention>();
   const off=official.onAttention(event=>{off();attention.resolve(event);});
   const readsBefore=agentReads,delayed=Promise.withResolvers<()=>void>();
   holdAgentRead=delayed.resolve;announce(kind,timestamp+4);
   const release=await bounded(delayed.promise,2000,'DUPLICATE_ATTENTION_READ_NOT_OBSERVED');
   for(let i=0;i<8;i++)announce(kind,timestamp+4);
   await flushWire();
   assert.equal(agentReads,readsBefore+1,'identical raw events must share their in-flight authoritative read');
   if(kind==='finished'){
    for(let i=5;i<8;i++)announce(kind,timestamp+i);
    await flushWire();
    assert.equal(agentReads,readsBefore+1,'newer delivery clocks must not create concurrent reads for one agent');
   }
   release();
   assert.deepEqual(await bounded(attention.promise,2000,'ATTENTION_NOT_OBSERVED'),{agentId:agent.id,kind,timestamp});
   assert.equal(agentReads,readsBefore+(kind==='finished'?2:1),'a burst may retain only one latest follow-up, not one read per raw event');
   await Promise.all(publications);
   const first=journal.attention(pair.pairId,noticeNow);
   assert.equal(first.length,1);
   assert.deepEqual(await openEnvelope(Buffer.alloc(32,7),first[0].body.envelope,noticeNow),{agentId:agent.id,kind,timestamp});
   await official.snapshot();await Promise.all(publications);
   assert.deepEqual(journal.attention(pair.pairId,noticeNow),first,'raw delivery and directory snapshot must retain one canonical ciphertext');
   assert.equal(journal.attentionResolutions(pair.pairId).length,index,'the snapshot must not create and resolve another logical notice');
   currentAgent={...currentAgent,requiresAttention:false,attentionReason:null,attentionTimestamp:null};
   await official.snapshot();
   assert.equal(journal.attention(pair.pairId,noticeNow).length,0);
  }
  for(const transition of ['clear','new-turn','new-attention'] as const){
   const timestamp=base+3000,delayed=Promise.withResolvers<()=>void>();
   currentAgent=terminal('finished',timestamp);
   holdAgentRead=delayed.resolve;announce('finished',timestamp+4);
   const release=await bounded(delayed.promise,2000,'ATTENTION_READ_NOT_OBSERVED');
   announce('finished',timestamp+5);announce('finished',timestamp+6);
   currentAgent=transition==='new-attention'?terminal('finished',timestamp+1000):{...currentAgent,status:transition==='new-turn'?'running':'idle',requiresAttention:false,attentionReason:null,attentionTimestamp:null,lastUserMessageAt:new Date(timestamp+500).toISOString(),activeTurn:transition==='new-turn'?{turnId:'synthetic-next-turn',startedAt:new Date(timestamp+500).toISOString()}:null};
   await official.snapshot();await Promise.all(publications);
   const before=journal.attention(pair.pairId,noticeNow),count=observed.length;
   release();await official.current(agent.id);await Promise.all(publications);
   assert.equal(observed.length,count,`a delayed ${transition} read must not emit the retired terminal attention`);
   assert.deepEqual(journal.attention(pair.pairId,noticeNow),before,`a delayed ${transition} read must not resurrect a phone notice`);
   // The same old event must not acquire a newer, unrelated attention identity.
   if(transition==='new-attention'){
    const read=Promise.withResolvers<()=>void>();holdAgentRead=read.resolve;
    announce('finished',timestamp+4);
    (await bounded(read.promise,2000,'STALE_EVENT_READ_NOT_OBSERVED'))();
    await official.current(agent.id);await Promise.all(publications);
    assert.equal(observed.length,count);
    assert.deepEqual(journal.attention(pair.pairId,noticeNow),before);
   }
   currentAgent={...currentAgent,status:'idle',activeTurn:null,requiresAttention:false,attentionReason:null,attentionTimestamp:null};
   await official.snapshot();
  }
  {
   const timestamp=base+5000,delayed=Promise.withResolvers<()=>void>(),readsBefore=agentReads;
   currentAgent=terminal('finished',timestamp);
   holdAgentRead=delayed.resolve;announce('finished',timestamp+4);
   const release=await bounded(delayed.promise,2000,'REPLACEMENT_ATTENTION_READ_NOT_OBSERVED');
   currentAgent={...currentAgent,status:'running',activeTurn:{turnId:'synthetic-coalesced-turn',startedAt:new Date(timestamp+500).toISOString()},lastUserMessageAt:new Date(timestamp+500).toISOString(),requiresAttention:false,attentionReason:null,attentionTimestamp:null};
   await official.snapshot();
   currentAgent=terminal('error',timestamp+1000);
   const attention=Promise.withResolvers<Attention>();
   const off=official.onAttention(event=>{off();attention.resolve(event);});
   announce('error',timestamp+1004);announce('error',timestamp+1004);
   await flushWire();
   assert.equal(agentReads,readsBefore+1,'a new turn waits behind the existing read instead of starting another');
   const count=observed.length;
   release();
   assert.deepEqual(await bounded(attention.promise,2000,'LATEST_ATTENTION_NOT_OBSERVED'),{agentId:agent.id,kind:'error',timestamp:timestamp+1000});
   await Promise.all(publications);
   assert.equal(agentReads,readsBefore+2);
   assert.equal(observed.length,count+1,'the retired response must not emit before the latest queued event');
   const notices=journal.attention(pair.pairId,noticeNow);
   assert.equal(notices.length,1);
   assert.deepEqual(await openEnvelope(Buffer.alloc(32,7),notices[0].body.envelope,noticeNow),{agentId:agent.id,kind:'error',timestamp:timestamp+1000});
   currentAgent={...currentAgent,requiresAttention:false,attentionReason:null,attentionTimestamp:null};
   await official.snapshot();
  }
  for(const observation of ['current','activity'] as const){
   const timestamp=base+6000+(observation==='activity'?100:0);
   currentAgent={...agent,status:'running',updatedAt:new Date(timestamp-100).toISOString(),lastUserMessageAt:new Date(timestamp-1000).toISOString(),activeTurn:{turnId:'synthetic-delayed-observation',startedAt:new Date(timestamp-1000).toISOString()}};
   const older=Promise.withResolvers<()=>void>();holdAgentRead=older.resolve;
   const observationResult=observation==='current'?official.current(agent.id):official.activityTask(agent.id);
   const releaseOlder=await bounded(older.promise,2000,'OLDER_OBSERVATION_NOT_CAPTURED');
   currentAgent=terminal('finished',timestamp);
   const terminalRead=Promise.withResolvers<()=>void>();holdAgentRead=terminalRead.resolve;
   announce('finished',timestamp+4);
   const releaseTerminal=await bounded(terminalRead.promise,2000,'NEW_TERMINAL_READ_NOT_CAPTURED');
   announce('finished',timestamp+5);await flushWire();
   releaseOlder();await observationResult;
   const attention=Promise.withResolvers<Attention>();
   const off=official.onAttention(event=>{off();attention.resolve(event);});
   releaseTerminal();
   assert.deepEqual(await bounded(attention.promise,2000,'OLDER_OBSERVATION_SUPPRESSED_TERMINAL'),{agentId:agent.id,kind:'finished',timestamp},`${observation} captured before terminal delivery must not fence the newer event or its queued successor`);
   await Promise.all(publications);
   currentAgent={...currentAgent,requiresAttention:false,attentionReason:null,attentionTimestamp:null};
   await official.snapshot();
  }
  stopAttention();
  const admittedId='55555555-5555-4555-8555-555555555555',admissionTime=Date.now();
  const admitted=await sealEnvelope(Buffer.alloc(32,7),{version:1,pairId:pair.pairId,id:admittedId,channel:'command',issuedAt:admissionTime,expiresAt:admissionTime+300000},{type:'send',agentId:agent.id,text:'Synthetic admission, not task completion',messageId:admittedId});
  await executeOperation({pair,journal,official,cloud,clock:Date.now},admitted);
  assert.equal(journal.get(pair.pairId,admittedId)?.state,'accepted');assert.equal(mutations,1);acknowledge=false;
  const now=Date.now();
  const envelope=await sealEnvelope(Buffer.alloc(32,7),{version:1,pairId:pair.pairId,id,channel:'command',issuedAt:now,expiresAt:now+300000},{type:'send',agentId:agent.id,text:'A real SDK mutation to an isolated wire only',messageId:id});
  await executeOperation({pair,journal,official,cloud,clock:Date.now},envelope);
  assert.equal(journal.get(pair.pairId,id)?.state,'unknown');assert.equal(mutations,2);
  await delay(2000);assert.equal(connections,1,'SDK automatic reconnect must stay disabled');
  const generation=official.requestContext().generation;
  await bounded(official.close(),3000,'OFFICIAL_CLOSE_TIMEOUT');
  journal.close();journals.delete(journal);journal=makeJournal();official=makeClient(journal);await official.connect();
  assert.equal(official.info()?.serverId,'synthetic-daemon');assert.notEqual(official.requestContext().generation,generation);
  assert.equal(wire.filter(m=>m.message?.type==='session.events.set_subscription.request'&&m.message.events.length>0).length,2,'explicit reconnect must restore observation');
  await executeOperation({pair,journal,official,cloud,clock:Date.now},envelope);
  assert.equal(mutations,2,'journal recovery must never resend an uncertain mutation');assert.equal(journal.get(pair.pairId,id)?.state,'unknown');
  const timelineItem=(text:string)=>AgentTimelineEntryPayloadSchema.parse({provider:'claude',item:{type:'user_message',clientMessageId:id,text},timestamp:new Date().toISOString(),seqStart:1,seqEnd:1,sourceSeqRanges:[{startSeq:1,endSeq:1}],collapsed:[]});
  timelineEntries=[timelineItem('wrong content')];await reconcileJournal({pair,journal,official,cloud},Date.now());
  assert.equal(journal.get(pair.pairId,id)?.state,'unknown');
  timelineEntries=[timelineItem(lastSend.text)];journal.cleanup(envelope.expiresAt);
  await reconcileJournal({pair,journal,official,cloud},envelope.expiresAt+1);
  assert.equal(journal.get(pair.pairId,id)?.state,'accepted');assert.equal(journal.get(pair.pairId,id)?.revision,2);
  assert.equal(mutations,2,'positive post-expiry reconciliation must not resend');
  const forbidden=['client_heartbeat','clear_agent_attention','workspace.clear_attention.request','register_push_token'];
  assert.ok(!wire.some(m=>forbidden.includes(m.message?.type)));
 };
 try{await Promise.race([scenario(),fixtureFailure.promise]);}finally{await cleanup();}
});
