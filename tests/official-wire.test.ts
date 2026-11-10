import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {WebSocketServer} from 'ws';
import {AgentSnapshotPayloadSchema,AgentTimelineEntryPayloadSchema,SessionOutboundMessageSchema,wrapSessionMessage,type FetchAgentTimelineResponseMessage} from '@getpaseo/protocol/messages';
import {OfficialClient} from '../src/official-client.ts';
import {OperationJournal} from '../src/journal.ts';
import {executeOperation,reconcileJournal} from '../src/operations.ts';
import {sealEnvelope} from '../src/crypto.ts';

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
     else if(m.type==='fetch_agent_request')reply({type:'fetch_agent_response',payload:{requestId:m.requestId,agent,project:null,error:null}});
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
 const config={version:1 as const,clientId:'moremote-companion-wire-test',target:'tcp://127.0.0.1:'+address.port+'?password=synthetic-wire',paseoHome:dir,allowLoopbackHttp:true,cloudEnabled:false,pairs:[]};
 const makeClient=()=>{const client=new OfficialClient(config);clients.add(client);return client;};
 const makeJournal=()=>{const journal=new OperationJournal(join(dir,'journal.sqlite'));journals.add(journal);return journal;};
 let official=makeClient(),journal=makeJournal();
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
  const attention=new Promise(resolve=>{const off=official.onAttention(event=>{off();resolve(event);});});
  const eventTime=new Date().toISOString();
  for(const socket of server.clients)socket.send(JSON.stringify(wrapSessionMessage(SessionOutboundMessageSchema.parse({type:'agent_attention_required',payload:{subscriptionId:'synthetic-subscription',agentId:agent.id,reason:'finished',timestamp:eventTime,shouldNotify:false}}))));
  assert.deepEqual(await bounded(attention,2000,'ATTENTION_NOT_OBSERVED'),{agentId:agent.id,kind:'finished',timestamp:Date.parse(eventTime)});
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
  journal.close();journals.delete(journal);journal=makeJournal();official=makeClient();await official.connect();
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
