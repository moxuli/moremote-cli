import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WebSocketServer} from 'ws';
import {AgentSnapshotPayloadSchema,SessionOutboundMessageSchema,wrapSessionMessage} from '@getpaseo/protocol/messages';
import {OfficialClient} from '../src/official-client.ts';
import {OperationJournal} from '../src/journal.ts';
import {projectSnapshot} from '../src/projection.ts';
import {CloudClient} from '../src/cloud-client.ts';
import {openEnvelope,sealEnvelope,type Envelope} from '../src/crypto.ts';

test('official provider and creation/user recency survive bounded encrypted state publication; assistant updates cannot replace them', {timeout:15000},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'moremote-task-projection-'));
 const server=new WebSocketServer({host:'127.0.0.1',port:0});
 let official:OfficialClient|undefined,journal:OperationJournal|undefined,failure:unknown;
 t.after(async()=>{
  for(const socket of server.clients)socket.terminate();
  const closed=once(server,'close');server.close();await closed;
  await official?.sdk.close();journal?.close();await rm(dir,{recursive:true,force:true});
 });
 const createdAt='2026-01-01T00:00:00.000Z',lastUserMessageAt='2026-01-02T00:00:00.000Z';
 const base={provider:'claude',cwd:'/synthetic/project',model:null,createdAt,updatedAt:'2026-01-03T00:00:00.000Z',lastUserMessageAt,status:'idle',
  capabilities:{supportsStreaming:true,supportsSessionPersistence:true,supportsDynamicModes:false,supportsMcpServers:false,supportsReasoningStream:false,supportsToolInvocations:true},
  currentModeId:null,availableModes:[],pendingPermissions:[],persistence:null,title:'Synthetic task'};
 let agents=[AgentSnapshotPayloadSchema.parse({...base,id:'synthetic-existing',provider:'codex'}),AgentSnapshotPayloadSchema.parse({...base,id:'synthetic-no-user',createdAt:'2026-01-02T12:00:00.000Z',lastUserMessageAt:null})];
 server.on('connection',socket=>{
  const reply=(message:unknown)=>socket.send(JSON.stringify(wrapSessionMessage(SessionOutboundMessageSchema.parse(message))));
  socket.on('message',data=>{
   try{
    const frame=JSON.parse(data.toString());
    if(frame.type==='hello')reply({type:'status',payload:{status:'server_info',serverId:'synthetic-projection-daemon',hostname:'Synthetic host',features:{explicitEventSubscriptions:true,ownedSubscriptions:true}}});
    else if(frame.type==='ping')socket.send(JSON.stringify({type:'pong'}));
    else if(frame.type==='session'){
     const message=frame.message;
     if(message.type==='session.events.set_subscription.request')reply({type:'session.events.set_subscription.response',payload:{requestId:message.requestId,subscriptionId:'synthetic-projection-subscription'}});
     else if(message.type==='subscription.release.request')reply({type:'subscription.release.response',payload:{requestId:message.requestId,subscriptionId:message.subscriptionId}});
     else if(message.type==='fetch_agents_request')reply({type:'fetch_agents_response',payload:{requestId:message.requestId,entries:agents.map(agent=>({agent,project:{projectKey:'synthetic-project',projectName:'Synthetic project',checkout:{cwd:agent.cwd,isGit:true,currentBranch:null,remoteUrl:null,isPaseoOwnedWorktree:false}}})),pageInfo:{nextCursor:null,prevCursor:null,hasMore:false}}});
     else throw Error('UNEXPECTED_OFFICIAL_REQUEST');
    }
   }catch(error){failure=error;socket.terminate()}
  });
 });
 await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');
 journal=new OperationJournal(join(dir,'journal.sqlite'));
 official=new OfficialClient({version:1,clientId:'moremote-cli-projection-test',target:'tcp://127.0.0.1:'+address.port+'?password=synthetic',paseoHome:dir,allowLoopbackHttp:false,cloudEnabled:true,pairs:[]},journal);
 await official.connect();
 const root=Buffer.alloc(32,7),pair={pairId:'11111111-1111-4111-8111-111111111111',rootKey:root.toString('base64url'),hostToken:Buffer.alloc(32,8).toString('base64url'),active:true};
 const publications:Envelope[]=[];
 const cloud=new CloudClient('https://synthetic-relay.example.test',pair.pairId,pair.hostToken,false,async(input,init)=>{
  assert.equal(String(input),'https://synthetic-relay.example.test/v1/pairs/'+pair.pairId+'/state');
  assert.equal(init?.method,'PUT');assert.equal((init?.headers as Record<string,string>).authorization,'Bearer '+pair.hostToken);
  const body=JSON.parse(String(init?.body));publications.push(body.envelope);
  assert.equal(JSON.stringify(body).includes('synthetic-existing'),false,'task metadata must stay inside endpoint-authenticated ciphertext');
  return Response.json({ok:true,envelope:body.envelope});
 });
 const observed:unknown[]=[];
 for(let revision=0;revision<2;revision++){
  const snapshot=await official.snapshot(),payload=await projectSnapshot(snapshot,pair,journal,official.generation);
  const envelope=await sealEnvelope(root,{version:1,pairId:pair.pairId,id:revision?'33333333-3333-4333-8333-333333333333':'22222222-2222-4222-8222-222222222222',channel:'state',issuedAt:snapshot.measuredAt,expiresAt:snapshot.measuredAt+600000},payload);
  await cloud.state(envelope);
  const decoded=await openEnvelope(root,publications.at(-1)!) as {tasks:{agentId:string;provider:string;createdAt:string;lastUserMessageAt:string|null;updatedAt:string}[]};
  observed.push(decoded.tasks.map(({agentId,provider,createdAt,lastUserMessageAt})=>({agentId,provider,createdAt,lastUserMessageAt})));
  assert.equal(decoded.tasks[0].updatedAt,agents[0].updatedAt);
  agents=agents.map(agent=>({...agent,updatedAt:'2026-01-04T00:00:00.000Z'}));
 }
 const expected=[{agentId:'synthetic-existing',provider:'codex',createdAt,lastUserMessageAt},{agentId:'synthetic-no-user',provider:'claude',createdAt:'2026-01-02T12:00:00.000Z',lastUserMessageAt:null}];
 assert.deepEqual(observed,[expected,expected]);assert.equal(failure,undefined);
});
