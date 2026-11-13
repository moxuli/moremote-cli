import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WebSocketServer} from 'ws';
import {wrapSessionMessage,WSInboundMessageSchema,type WSHelloMessage,type SessionOutboundMessage} from '@getpaseo/protocol/messages';
import type {TestContext} from 'node:test';
import {CloudClient} from '../src/cloud-client.ts';
import {loadConfig,saveConfig,type Pair} from '../src/config.ts';
import {OfficialClient} from '../src/official-client.ts';
import {LocalEnrollment} from '../src/local-enrollment.ts';
import {discoveryDirectory} from '../src/enrollment-files.ts';
import {setupEnrollment} from '../src/setup.ts';
import {openEnvelope,sealEnvelope} from '../src/crypto.ts';
import {tokenHash} from '../src/pairing.ts';
import type {EnrollmentRequest} from '../src/enrollment-protocol.ts';
import {object} from '../src/limits.ts';

export const daemon='synthetic-single-pairing-daemon';
export const client='22222222-2222-4222-8222-222222222222';
export const requestId='33333333-3333-4333-8333-333333333333';
export const origin='https://synthetic-relay.example.test';
export async function enrollmentFixture(t:TestContext){
 const home=await mkdtemp(join(tmpdir(),'moremote-enrollment-')),state=join(home,'state'),paseoHome=join(home,'paseo');
 let now=Date.now(),failure:unknown,dropNextCreate=false,holdNextCreate=false,claim=false;
 const hellos:WSHelloMessage[]=[],officialRequests:string[]=[],cloudRequests:{method:string;path:string;bytes:string}[]=[];
 const creates=new Map<string,string>();
 const official=new WebSocketServer({host:'127.0.0.1',port:0}),relay=createServer();
 const consumers:LocalEnrollment[]=[];
 t.after(async()=>{
  for(const consumer of consumers)try{consumer.close()}catch{}
  for(const socket of official.clients)socket.terminate();relay.closeAllConnections();
  const closed=[once(official,'close'),once(relay,'close')];official.close();relay.close();await Promise.all(closed);
  await rm(home,{recursive:true,force:true});assert.equal(failure,undefined);
 });
 official.on('connection',socket=>{
  const reply=(message:SessionOutboundMessage)=>socket.send(JSON.stringify(wrapSessionMessage(message)));
  socket.on('message',data=>{try{
   const frame=WSInboundMessageSchema.parse(JSON.parse(data.toString()));
   if(frame.type==='hello'){hellos.push(frame);reply({type:'status',payload:{status:'server_info',serverId:daemon,hostname:'Synthetic computer',features:{explicitEventSubscriptions:true,ownedSubscriptions:true}}})}
   else if(frame.type==='ping')socket.send(JSON.stringify({type:'pong'}));
   else if(frame.type==='session'){
    const message=frame.message;officialRequests.push(message.type);
    if(message.type==='session.events.set_subscription.request')reply({type:'session.events.set_subscription.response',payload:{requestId:message.requestId,subscriptionId:'enrollment-fixture'}});
    else if(message.type==='subscription.release.request')reply({type:'subscription.release.response',payload:{requestId:message.requestId,subscriptionId:message.subscriptionId}});
    else if(message.type==='fetch_agents_request')reply({type:'fetch_agents_response',payload:{requestId:message.requestId,entries:[],pageInfo:{nextCursor:null,prevCursor:null,hasMore:false}}});
    else throw Error('UNEXPECTED_OFFICIAL_REQUEST');
   }
  }catch(error){failure=error;socket.terminate()}});
 });
 relay.on('request',async(request,response)=>{try{
  const chunks:Buffer[]=[];for await(const chunk of request)chunks.push(Buffer.from(chunk));
  const bytes=Buffer.concat(chunks).toString('utf8'),body=bytes?object(JSON.parse(bytes)):undefined;
  cloudRequests.push({method:request.method!,path:request.url!,bytes});
  const saved=await loadConfig(state),id=body?.pairId??request.url!.split('/')[3];assert.ok(typeof id==='string');
  const pair=saved.pairs.find(pair=>pair.pairId===id)!;
  assert.ok(pair);assert.equal(request.headers.authorization,'Bearer '+pair.hostToken);
  let result:unknown={ok:true};
  if(request.method==='POST'&&request.url==='/v1/pairs'){
   const record=saved.enrollmentRequests!.find(record=>record.pairId===pair.pairId)!;
   assert.equal(record.createBytes,bytes,'exact cloud-create bytes are durable before I/O');assert.equal(record.created,false);
   if(creates.has(id))assert.equal(creates.get(id),bytes);else creates.set(id,bytes);
   if(dropNextCreate){dropNextCreate=false;response.destroy();return}
   if(holdNextCreate){holdNextCreate=false;await once(response,'close');return}
   result={ok:true,pairId:id,status:'pending'};
  }else if(request.method==='GET'&&request.url==='/v1/pairs/'+id){
   const claimId='44444444-4444-4444-8444-444444444444',phoneTokenHash=tokenHash(Buffer.alloc(32,9).toString('base64url'));
   const proof=await sealEnvelope(Buffer.from(pair.rootKey,'base64url'),{version:1,pairId:id,id:claimId,channel:'enrollment',issuedAt:Date.now(),expiresAt:pair.expiresAt!},{type:'phoneHello',claimId,phoneTokenHash});
   result={ok:true,pair:{state:'pending',...(claim?{pendingClaim:{claimId,phoneTokenHash,proof}}:{})}};
  }else if(request.method==='POST'&&request.url==='/v1/pairs/'+id+'/activate'){
   assert.ok(body);assert.deepEqual(pair.activationProof,body.proof);
   const proof=object(await openEnvelope(Buffer.from(pair.rootKey,'base64url'),body.proof));assert.equal(proof.daemonServerId,daemon);
   result={ok:true,status:'active'};
  }else if(request.method==='GET'&&request.url!.endsWith('/controls')){
   if(!pair.active&&pair.revokedAt===undefined){response.writeHead(409,{'content-type':'application/json'});response.end(JSON.stringify({ok:false,error:{code:'pair_not_active',message:'pair_not_active'}}));return}
   result={ok:true,controls:[]};
  }
  else if(request.method==='GET'&&request.url!.endsWith('/commands'))result={ok:true,commands:[]};
  else if(request.method==='GET'&&request.url!.endsWith('/activities'))result={ok:true,subscriptions:[]};
  else if(!['PUT','POST'].includes(request.method!))throw Error('UNEXPECTED_CLOUD_REQUEST');
  response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify(result));
 }catch(error){failure=error;response.writeHead(500,{'content-type':'application/json'});response.end(JSON.stringify({ok:false,error:{code:'FIXTURE_FAILED'}}))}});
 relay.listen(0,'127.0.0.1');await Promise.all([once(official,'listening'),once(relay,'listening')]);
 const address=official.address(),relayAddress=relay.address();assert.ok(address&&typeof address!=='string');assert.ok(relayAddress&&typeof relayAddress!=='string');
 await mkdir(paseoHome,{mode:0o700});const pid=JSON.stringify({pid:12345,listen:'127.0.0.1:'+address.port}),credential=Buffer.alloc(32,7).toString('base64url');
 await writeFile(join(paseoHome,'paseo.pid'),pid);await writeFile(join(paseoHome,'local-credential'),credential);
 const config=await loadConfig(state);config.paseoHome=paseoHome;config.apiOrigin=origin;config.target='tcp://127.0.0.1:'+address.port+'?password=synthetic-enrollment-password';await saveConfig(state,config);
 const authenticate=async(current:typeof config)=>{
  // Select synthetic credentials without inheriting the operator's password.
  // OfficialClient consumes this environment value synchronously at construction.
  const inherited=process.env.PASEO_PASSWORD;let connection:OfficialClient;
  try{delete process.env.PASEO_PASSWORD;connection=new OfficialClient(current)}
  finally{if(inherited===undefined)delete process.env.PASEO_PASSWORD;else process.env.PASEO_PASSWORD=inherited}
  try{await connection.connect();return {serverId:connection.info()!.serverId}}finally{await connection.close()}
 };
 let stopped=0,installed=0;
 const setup=async()=>setupEnrollment(state,{yes:true,home,stopOwned:async()=>{stopped++},authenticate,install:async()=>{installed++}});
 const fetcher:typeof fetch=(input,init)=>{const url=new URL(String(input));assert.equal(url.origin,origin);return fetch('http://127.0.0.1:'+relayAddress.port+url.pathname,init)};
 const cloud=(pair:Pair)=>new CloudClient(pair.apiOrigin!,pair.pairId,pair.hostToken,false,fetcher);
 const consumer=()=>{const result=new LocalEnrollment(state,{clock:()=>now});consumers.push(result);return result};
 const tree=discoveryDirectory(home,daemon);
 const request=(overrides:Partial<EnrollmentRequest>={}):EnrollmentRequest=>({version:1,id:requestId,clientId:client,daemonServerId:daemon,issuedAt:now,expiresAt:now+600000,...overrides});
 const put=async(value=request(),bytes=JSON.stringify(value))=>{await writeFile(join(tree,'requests',value.id+'.json'),bytes,{mode:0o644});return bytes};
 const response=async(id=requestId)=>object(JSON.parse(await readFile(join(tree,'responses',id+'.json'),'utf8')));
 const verifyOfficial=async(local=false)=>{assert.equal(failure,undefined);assert.equal(await readFile(join(paseoHome,'paseo.pid'),'utf8'),pid);assert.equal(await readFile(join(paseoHome,'local-credential'),'utf8'),credential);for(const hello of hellos)assert.deepEqual(hello.auth,local?{kind:'localCredential',token:credential}:{kind:'password',password:'synthetic-enrollment-password'})};
 return {home,state,paseoHome,tree,setup,authenticate,consumer,cloud,request,put,response,creates,cloudRequests,hellos,officialRequests,fetcher,relayPort:relayAddress.port,verifyOfficial,get stopped(){return stopped},get installed(){return installed},get now(){return now},advance:(ms:number)=>{now+=ms},dropCreate:()=>{dropNextCreate=true},holdCreate:()=>{holdNextCreate=true},allowClaim:()=>{claim=true}};
}
