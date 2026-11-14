import {setTimeout as sleep} from 'node:timers/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {spawn,type ChildProcess} from 'node:child_process';
import {createServer,type IncomingMessage} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {WebSocketServer} from 'ws';
import {AgentSnapshotPayloadSchema,wrapSessionMessage} from '@getpaseo/protocol/messages';
import {saveConfig,loadConfig} from '../src/config.ts';
import {OperationJournal} from '../src/journal.ts';
import {sealEnvelope,openEnvelope,type Envelope} from '../src/crypto.ts';
import {requestControl,controlEndpoint} from '../src/control.ts';

const pairId='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',day=86400000;
// These subprocess consumers deliberately measure the platform's real 3s poll
// cadence and bounded teardown. IPC advances only Date for 30s/day deadlines;
// faking parent timers cannot drive the independent runtime process.
async function until(predicate:()=>boolean|Promise<boolean>,message:string,ms=12000){const end=performance.now()+ms;while(performance.now()<end){if(await predicate())return;await sleep(30)}throw Error(message)}
async function bounded<T>(promise:Promise<T>,ms:number,message:string){const deadline=Promise.withResolvers<never>();const timer=setTimeout(()=>deadline.reject(Error(message)),ms);timer.unref();try{return await Promise.race([promise,deadline.promise])}finally{clearTimeout(timer)}}
async function body(req:IncomingMessage){let value='';for await(const chunk of req)value+=chunk;return value?JSON.parse(value):null}
async function fixture(options:{pending?:boolean;receiptFailure?:boolean;stateLosses?:number;retired?:boolean;missing?:boolean;transient?:boolean;stallSnapshot?:boolean;snapshotDelayMs?:number;seedReceipt?:boolean;pause?:{path:'controls'|'state'|'receipt';status:429|503;seconds:number}}={}){
 // A short private fixture root avoids Darwin's sockaddr_un limit even when TMPDIR is long.
 // Production socket placement/ownership checks remain unchanged.
 const root=await mkdtemp(join(process.platform==='win32'?tmpdir():'/tmp','mrr-')),dir=join(root,'c');
 const daemon=new WebSocketServer({host:'127.0.0.1',port:0});await once(daemon,'listening');const daemonAddress=daemon.address();assert.ok(daemonAddress&&typeof daemonAddress!=='string');
 const counts={controls:0,commands:0,pair:0,receipts:0,attention:0,snapshots:0,mutations:0};const states:string[]=[];const controlsAt:number[]=[];const requests:{path:string;method:string;at:number;body:unknown}[]=[];let pauseAt=0;let child:ChildProcess|undefined;let exited:Promise<unknown>|undefined;
 const syntheticAgent=AgentSnapshotPayloadSchema.parse({id:'a',provider:'claude',cwd:'/private/project',model:null,createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z',lastUserMessageAt:null,status:'running',capabilities:{supportsStreaming:true,supportsSessionPersistence:true,supportsDynamicModes:false,supportsMcpServers:false,supportsReasoningStream:false,supportsToolInvocations:true},currentModeId:null,availableModes:[],pendingPermissions:options.pending===false?[]:[{id:'pending-plan',provider:'claude',name:'Plan',kind:'plan',actions:[{id:'yes',label:'Implement',behavior:'allow'}],input:{plan:'Synthetic plan'}}],persistence:null,title:'Private task'});
 const relay=createServer(async(req,res)=>{const path=req.url||'';const value=await body(req);requests.push({path,method:req.method||'',at:performance.now(),body:value});res.setHeader('Content-Type','application/json');const fail=(code:string,http=409)=>{res.writeHead(http);res.end(JSON.stringify({ok:false,error:{code,message:'Synthetic fixture failure'}}))};
  if(options.pause&&!pauseAt&&path.endsWith('/'+options.pause.path)){pauseAt=performance.now();res.setHeader('Retry-After',String(options.pause.seconds));return fail('cost_guard_closed',options.pause.status)}
  if(path.endsWith('/controls')){counts.controls++;controlsAt.push(performance.now());if(options.missing)return fail('pair_not_found',404);if(options.transient)return fail('temporarily_unavailable',503);return res.end(JSON.stringify({ok:true,controls:[]}))}
  if(path.endsWith('/receipt')){counts.receipts++;if(options.missing)return fail('pair_not_found',404);if(options.receiptFailure)return fail('receipt_revision_conflict');return res.end(JSON.stringify({ok:true}))}
  if(path.endsWith('/commands')){counts.commands++;if(options.retired)return fail('pair_not_active');return res.end(JSON.stringify({ok:true,commands:[],hasMore:false}))}
  if(path.endsWith('/state')){states.push(JSON.stringify(value.envelope));if(options.retired)return fail('pair_not_active');if(states.length<=(options.stateLosses||0)){res.destroy();return}return res.end(JSON.stringify({ok:true}))}
  if(path.endsWith('/attention')){counts.attention++;return res.end(JSON.stringify({ok:true}))}
  counts.pair++;if(options.missing)return fail('pair_not_found',404);res.end(JSON.stringify({ok:true,pair:{state:options.retired?'revoked':'active',pendingClaim:null,activationProof:null}}));
 });relay.listen(0,'127.0.0.1');await once(relay,'listening');const relayAddress=relay.address();assert.ok(relayAddress&&typeof relayAddress!=='string');
 daemon.on('connection',socket=>{const reply=(message:unknown)=>socket.send(JSON.stringify(wrapSessionMessage(message)));socket.on('message',data=>{const f=JSON.parse(data.toString());if(f.type==='hello')reply({type:'status',payload:{status:'server_info',serverId:'d',hostname:'Synthetic',features:{explicitEventSubscriptions:true,ownedSubscriptions:true}}});else if(f.type==='ping')socket.send(JSON.stringify({type:'pong'}));else if(f.type==='session'){const m=f.message;if(m.type==='session.events.set_subscription.request')reply({type:'session.events.set_subscription.response',payload:{requestId:m.requestId,subscriptionId:'s'}});else if(m.type==='fetch_agents_request'){counts.snapshots++;if(!options.stallSnapshot)void sleep(options.snapshotDelayMs||0,undefined,{ref:false}).then(()=>{if(socket.readyState===1)reply({type:'fetch_agents_response',payload:{requestId:m.requestId,entries:[{agent:syntheticAgent,project:{projectKey:'project',projectName:'Private project',checkout:{cwd:syntheticAgent.cwd,isGit:true,currentBranch:null,remoteUrl:null,isPaseoOwnedWorktree:false}}}],pageInfo:{nextCursor:null,prevCursor:null,hasMore:false}}})})}else if(m.type==='subscription.release.request')reply({type:'subscription.release.response',payload:{requestId:m.requestId}});else if(m.type==='send_agent_message_request'||m.type==='agent_permission_response')counts.mutations++}})});
 const pair={pairId,rootKey:Buffer.alloc(32,7).toString('base64url'),hostToken:Buffer.alloc(32,8).toString('base64url'),active:true,daemonServerId:'d'};
 await saveConfig(dir,{version:1,clientId:'moremote-cli-runtime-test',target:'tcp://127.0.0.1:'+daemonAddress.port+'?password=synthetic',paseoHome:join(root,'official'),daemonServerId:'d',apiOrigin:'http://127.0.0.1:'+relayAddress.port,allowLoopbackHttp:true,cloudEnabled:true,pairs:[pair]});
 const now=Date.now();const journal=new OperationJournal(join(dir,'journal.sqlite'));try{
  const command=await sealEnvelope(Buffer.alloc(32,7),{version:1,pairId,id,channel:'command',issuedAt:now,expiresAt:now+300000},{type:'send',agentId:'a',messageId:id,text:'synthetic'});journal.prepare(command);journal.dispatched(pairId,id);
  if(options.seedReceipt){const receipt=await sealEnvelope(Buffer.alloc(32,7),{version:1,pairId,id,channel:'receipt',issuedAt:now,expiresAt:now+600000},{operationId:id,state:'accepted',revision:1});journal.outcome(pairId,id,'accepted',receipt)}
  const attentionId='33333333-3333-4333-8333-333333333333';const envelope=await sealEnvelope(Buffer.alloc(32,7),{version:1,pairId,id:attentionId,channel:'attention',issuedAt:now,expiresAt:now+600000},{agentId:'finished-agent',kind:'finished',timestamp:now});journal.queueAttention(pairId,attentionId,envelope.expiresAt,{id:attentionId,kind:'finished',topic:'synthetic',envelope},{agentId:'finished-agent'});
 }finally{journal.close()}
 const stop=async()=>{
  if(child&&child.exitCode===null&&child.signalCode===null){await bounded(requestControl(dir,'stop'),2200,'STOP_REQUEST_TIMEOUT').catch(()=>{});try{await bounded(exited!,2200,'RUNTIME_STOP_TIMEOUT')}catch{child.kill('SIGKILL');await bounded(exited!,2200,'RUNTIME_KILL_TIMEOUT')}}
 };
 const close=async()=>{try{await stop()}finally{for(const socket of daemon.clients)socket.terminate();relay.closeAllConnections();const daemonClosed=Promise.withResolvers<void>(),relayClosed=Promise.withResolvers<void>();daemon.close(()=>daemonClosed.resolve());relay.close(()=>relayClosed.resolve());try{await bounded(Promise.all([daemonClosed.promise,relayClosed.promise]),2200,'FIXTURE_SERVER_CLOSE_TIMEOUT')}finally{await rm(root,{recursive:true,force:true})}}};
 const start=()=>{assert.ok(Buffer.byteLength(controlEndpoint(dir))<100||process.platform==='win32');child=spawn(process.execPath,['--import','tsx','--input-type=module','--eval',"import {runRuntime} from './src/runtime.ts';let offset=0;const now=Date.now;Date.now=()=>now()+offset;process.on('message',m=>{if(m.type==='advance')offset+=m.ms});await runRuntime(process.argv[1]);process.disconnect();",dir],{cwd:fileURLToPath(new URL('..',import.meta.url)),stdio:['ignore','ignore','inherit','ipc']});exited=once(child,'exit');};
 return {root,dir,counts,states,controlsAt,requests,pausedAt:()=>pauseAt,now,start,stop,close,drain:()=>child!.send({kind:'moremote-drain'}),advance:(ms:number)=>child!.send({type:'advance',ms}),alive:()=>!!child&&child.exitCode===null&&child.signalCode===null};
}

test('actual runtime keeps notifications and command acquisition alive at 3s cadence despite retained receipt and state publication failures',{timeout:20000},async()=>{
 const f=await fixture({receiptFailure:true,stateLosses:20,seedReceipt:true});try{f.start();await until(()=>f.counts.commands>=3,'RECEIPT_OR_STATE_BLOCKED_COMMANDS');assert.ok(f.counts.receipts>=3);assert.equal(f.counts.attention,1);assert.equal(f.counts.pair,0);assert.equal(f.states.length,3);assert.equal(new Set(f.states).size,1);assert.ok(f.controlsAt[2]-f.controlsAt[0]<8500,'isolated publication failures must not back off command/control acquisition');await until(async()=>{const status=await requestControl(f.dir,'status');return status?.stage==='degraded'&&typeof status.lastError==='string'},'PUBLICATION_FAILURE_WAS_HIDDEN');assert.equal(f.counts.mutations,0)}finally{await f.close()}
});

test('actual runtime retries exact notification hydration then stays silent across unchanged measurements',{timeout:20000},async()=>{
 const f=await fixture({stateLosses:2,seedReceipt:true});try{f.start();await until(()=>f.counts.commands>=1,'INITIAL_CYCLE_MISSING');const first=JSON.parse(f.states[0]) as Envelope;const plain=await openEnvelope(Buffer.alloc(32,7),first);assert.deepEqual(Object.keys(plain as object).sort(),['daemonServerId','tasks','version']);f.advance(31000);
  await until(()=>f.counts.commands>=4,'IDLE_CYCLES_MISSING');assert.equal(f.counts.pair,0);assert.equal(f.counts.snapshots,2);assert.equal(f.states.length,3);assert.equal(f.states[0],f.states[1]);assert.equal(f.states[1],f.states[2],'lost-ack retry must survive a newer measurement');assert.equal(f.counts.receipts,1);await until(()=>f.counts.commands>=5,'ACKNOWLEDGED_IDLE_CYCLE_MISSING');assert.equal(f.states.length,3,'unchanged measurements must not publish new notification hydration');
 }finally{await f.close()}
});

for(const missing of [false,true])test(`actual runtime fences ${missing?'missing':'relay-retired'} pairs without forged revoke acknowledgement and stops recovery at original child deadline`,{timeout:20000},async()=>{
 const f=await fixture({retired:!missing,missing,seedReceipt:true});try{f.start();await until(async()=>{const p=(await loadConfig(f.dir)).pairs[0];return !!p&&!p.active&&typeof p.relayRetiredAt==='number'},'RELAY_RETIREMENT_NOT_PERSISTED');const pair=(await loadConfig(f.dir)).pairs[0];assert.equal(pair.revokedAt,undefined);assert.equal(f.counts.mutations,0);const writes=f.states.length,commands=f.counts.commands;f.advance(day+1000);await until(()=>f.counts.controls>=2,'READ_ONLY_RECOVERY_NOT_ATTEMPTED');assert.equal((await loadConfig(f.dir)).pairs.length,1,'known child audit deadline must retain keys');assert.equal(f.states.length,writes);assert.equal(f.counts.commands,commands);
  f.advance(600000);await until(async()=>(await loadConfig(f.dir)).pairs.length===0,'RELAY_RETIREMENT_NEVER_STOPS');const reads=f.counts.controls;await sleep(3300);assert.equal(f.counts.controls,reads,'retired 404 must not poll forever');const journal=new OperationJournal(join(f.dir,'journal.sqlite'));try{assert.equal(journal.revocationTime(pairId),undefined);assert.equal(journal.controlReceipts(pairId,Date.now()).length,0)}finally{journal.close()}
 }finally{await f.close()}
});

test('transient relay failures are not revocation proof and fixture teardown terminates a runtime with an unfinished SDK snapshot',{timeout:12000},async()=>{
 const f=await fixture({transient:true,stallSnapshot:true});try{f.start();await until(()=>f.counts.snapshots>0,'SDK_NOT_REACHED');const pair=(await loadConfig(f.dir)).pairs[0];assert.equal(pair.active,true);assert.equal(pair.revokedAt,undefined);assert.equal(pair.relayRetiredAt,undefined);await bounded(f.stop(),7000,'UNBOUNDED_FIXTURE_TEARDOWN');assert.equal(f.alive(),false)}finally{await f.close()}
});

for(const pause of [{path:'state',status:429},{path:'receipt',status:503},{path:'controls',status:429}] as const)test(`actual runtime honors ${pause.status} quota pause from ${pause.path} without a 3s retry storm, then resumes controls first`,{timeout:20000},async()=>{
 const seconds=pause.path==='controls'?9:6;const f=await fixture({pause:{...pause,seconds},seedReceipt:true});try{
  f.start();await until(()=>f.pausedAt()>0,'GUARD_RESPONSE_NOT_REACHED');const guarded=f.requests[f.requests.length-1];const count=f.requests.length;
  // Deliberately cross the real 3s polling boundary in the runtime subprocess.
  await sleep(3500);assert.equal(f.requests.length,count,'server pause must suppress every later request, including independent publication/reconciliation paths');assert.equal(f.counts.mutations,0);const pair=(await loadConfig(f.dir)).pairs[0];assert.equal(pair.active,true);assert.equal(pair.revokedAt,undefined);assert.equal(pair.relayRetiredAt,undefined);
  await until(()=>f.counts.commands>0,'ORIGINAL_RETRY_DEADLINE_NEVER_RESUMED');const resumed=f.requests[count];assert.ok(resumed);assert.ok(resumed.at-f.pausedAt()>=seconds*1000-200,'Retry-After seconds must not be interpreted as milliseconds or ignored');assert.ok(resumed.path.endsWith('/controls'),'normal revoke-first ordering resumes after the original pause');
  if(pause.path!=='controls'){const retried=f.requests.slice(count).find(request=>request.path===guarded.path);assert.ok(retried);assert.deepEqual(retried.body,guarded.body,'paused immutable publication must retry the original bytes, not renew authority or timestamps')}
  assert.equal(f.counts.mutations,0);
 }finally{await f.close()}
});

test('actual runtime reacquires controls after a receipt pause expires inside a slow SDK snapshot before any cloud recovery or publication',{timeout:20000},async()=>{
 const f=await fixture({pause:{path:'receipt',status:429,seconds:6},snapshotDelayMs:7500,seedReceipt:true});try{
  f.start();await until(()=>f.pausedAt()>0&&f.counts.snapshots>0,'SLOW_SNAPSHOT_DID_NOT_FOLLOW_RECEIPT_PAUSE');const guarded=f.requests.find(request=>request.path.endsWith('/receipt'));assert.ok(guarded);const count=f.requests.length;
  await until(()=>f.counts.commands>0,'NEXT_CONTROL_CYCLE_DID_NOT_RESUME',16000);const resumed=f.requests[count];assert.ok(resumed);assert.ok(resumed.at-f.pausedAt()>=6000,'snapshot must actually outlast the server pause');assert.equal(resumed.method,'GET');assert.ok(resumed.path.endsWith('/controls'),'an expired pause cannot reuse the control acquisition from before the pause');
  const retried=f.requests.slice(count).find(request=>request.path===guarded.path);assert.ok(retried);assert.deepEqual(retried.body,guarded.body,'cycle fencing must retain the original immutable unsent receipt');assert.equal(f.counts.mutations,0);
 }finally{await f.close()}
});

test('parent update drain completes the actual in-flight cycle and releases journal/control ownership without replay',{timeout:12000},async()=>{
 const f=await fixture({snapshotDelayMs:1500,seedReceipt:true});try{
  f.start();await until(()=>f.counts.snapshots>0,'IN_FLIGHT_CYCLE_NOT_REACHED');f.drain();
  await until(()=>!f.alive(),'DRAIN_NEVER_FINISHED');
  assert.equal(f.counts.commands,1,'drain must finish acquisition in its existing cycle, not cancel the SDK await or enter another cycle');
  assert.equal(f.states.length,1);assert.equal(f.counts.mutations,0);assert.equal(await requestControl(f.dir,'status'),null);
  const journal=new OperationJournal(join(f.dir,'journal.sqlite'));try{assert.equal(journal.get(pairId,id)?.state,'accepted')}finally{journal.close()}
 }finally{await f.close()}
});

test('idle runtime never polls cloud system surfaces or publishes directory state',{timeout:15000},async()=>{
 const f=await fixture({pending:false});try{
  f.start();await until(()=>f.counts.commands>=2,'INITIAL_CADENCE_NOT_REACHED');
  f.advance(31000);await until(()=>f.counts.snapshots>=2&&f.counts.commands>=3,'LOCAL_DISCOVERY_NOT_REPEATED');
  assert.equal(f.states.length,0);
  assert.equal(f.requests.some(r=>/activities|widget-device/.test(r.path)),false);
  assert.equal(f.counts.mutations,0);
 }finally{await f.close()}
});
