import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WebSocketServer} from 'ws';
import {wrapSessionMessage} from '@getpaseo/protocol/messages';
import {loadConfig,saveConfig,type Config} from '../src/config.ts';
import {openEnvelope,sealEnvelope} from '../src/crypto.ts';
import {tokenHash} from '../src/pairing.ts';

const production='https://moremote-cloud-ingress.pages.dev';
const localCredential=Buffer.alloc(32,7).toString('base64url');
const phoneToken=Buffer.alloc(32,8).toString('base64url');
const claimId='22222222-2222-4222-8222-222222222222';

async function fixture(t:test.TestContext,origin=production){
 const home=await mkdtemp(join(tmpdir(),'moremote-onboarding-'));
 const state=join(home,'state'),paseoHome=join(home,'paseo');
 const official=new WebSocketServer({host:'127.0.0.1',port:0});
 const relay=createServer();
 let failure:unknown;
 const hellos:any[]=[],officialRequests:string[]=[],cloudRequests:{method:string;path:string;body:any;authorization:string|undefined}[]=[];
 t.after(async()=>{
  for(const socket of official.clients)socket.terminate();
  relay.closeAllConnections();
  const officialClosed=once(official,'close'),relayClosed=once(relay,'close');
  official.close();relay.close();
  await Promise.all([officialClosed,relayClosed]);
  await rm(home,{recursive:true,force:true});
 });
 official.on('connection',socket=>{
  const reply=(message:any)=>socket.send(JSON.stringify(wrapSessionMessage(message)));
  socket.on('message',data=>{
   try{
    const frame=JSON.parse(data.toString());
    if(frame.type==='hello'){
     hellos.push(frame);
     reply({type:'status',payload:{status:'server_info',serverId:'synthetic-onboarding-daemon',hostname:'Synthetic computer',features:{explicitEventSubscriptions:true,ownedSubscriptions:true}}});
    }else if(frame.type==='ping')socket.send(JSON.stringify({type:'pong'}));
    else if(frame.type==='session'){
     const message=frame.message;officialRequests.push(message.type);
     if(message.type==='session.events.set_subscription.request')reply({type:'session.events.set_subscription.response',payload:{requestId:message.requestId,subscriptionId:'synthetic-onboarding-subscription'}});
     else if(message.type==='subscription.release.request')reply({type:'subscription.release.response',payload:{requestId:message.requestId,subscriptionId:message.subscriptionId}});
     else throw Error('UNEXPECTED_OFFICIAL_REQUEST');
    }
   }catch(error){failure=error;socket.terminate()}
  });
 });
 relay.on('request',async(request,response)=>{
  try{
   const chunks:Buffer[]=[];for await(const chunk of request)chunks.push(Buffer.from(chunk));
   const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):undefined;
   cloudRequests.push({method:request.method!,path:request.url!,body,authorization:request.headers.authorization});
   const config=await loadConfig(state),pair=config.pairs.at(-1)!;
   assert.equal(config.cloudEnabled,true,'consent and endpoint must be durable before enrollment I/O');
   assert.equal(pair.apiOrigin,origin);
   assert.equal(request.headers.authorization,'Bearer '+pair.hostToken);
   let result:unknown;
   if(request.method==='POST'&&request.url==='/v1/pairs'){
    assert.deepEqual(body,{pairId:pair.pairId,hostTokenHash:tokenHash(pair.hostToken),enrollmentTokenHash:tokenHash(pair.enrollmentToken!),expiresAt:pair.expiresAt});
    result={ok:true,pairId:pair.pairId,status:'pending'};
   }else if(request.method==='GET'&&request.url==='/v1/pairs/'+pair.pairId){
    const proof=await sealEnvelope(Buffer.from(pair.rootKey,'base64url'),{version:1,pairId:pair.pairId,id:claimId,channel:'enrollment',issuedAt:Date.now(),expiresAt:pair.expiresAt!},{type:'phoneHello',claimId,phoneTokenHash:tokenHash(phoneToken)});
    result={ok:true,pair:{state:'pending',pendingClaim:{claimId,phoneTokenHash:tokenHash(phoneToken),proof}}};
   }else if(request.method==='POST'&&request.url==='/v1/pairs/'+pair.pairId+'/activate'){
    const proof=await openEnvelope(Buffer.from(pair.rootKey,'base64url'),body.proof);
    assert.deepEqual(proof,{type:'companionHello',claimId,phoneTokenHash:tokenHash(phoneToken),daemonServerId:'synthetic-onboarding-daemon',hostName:'Synthetic computer'});
    assert.deepEqual(pair.activationProof,body.proof,'activation proof must already be durable');
    result={ok:true,status:'active'};
   }else throw Error('UNEXPECTED_CLOUD_REQUEST');
   response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify(result));
  }catch(error){failure=error;response.writeHead(500,{'content-type':'application/json'});response.end(JSON.stringify({ok:false,error:{code:'FIXTURE_FAILED'}}))}
 });
 relay.listen(0,'127.0.0.1');
 await Promise.all([once(official,'listening'),once(relay,'listening')]);
 const address=official.address(),relayAddress=relay.address();
 assert.ok(address&&typeof address!=='string');assert.ok(relayAddress&&typeof relayAddress!=='string');
 await mkdir(paseoHome);
 const pid=JSON.stringify({pid:12345,listen:'127.0.0.1:'+address.port});
 await writeFile(join(paseoHome,'paseo.pid'),pid);await writeFile(join(paseoHome,'local-credential'),localCredential);
 const preload='data:text/javascript,'+encodeURIComponent(`const realFetch=globalThis.fetch;globalThis.fetch=(input,init)=>{const url=new URL(String(input));if(url.origin!==${JSON.stringify(origin)})throw Error('UNEXPECTED_TEST_ORIGIN');return realFetch('http://127.0.0.1:${relayAddress.port}'+url.pathname,init)};`);
 const cli=(args:string[])=>{
  const {promise,resolve,reject}=Promise.withResolvers<{code:number|null;out:string;error:string}>();
  const child=spawn(process.execPath,['--import','tsx','--import',preload,'src/cli.ts',...args],{cwd:new URL('..',import.meta.url),env:{...process.env,HOME:home,USERPROFILE:home,LOCALAPPDATA:home,XDG_CONFIG_HOME:join(home,'config'),XDG_STATE_HOME:join(home,'statebase'),PASEO_HOME:paseoHome,PASEO_PASSWORD:'',MOREMOTE_CLI_HOME:state},stdio:['ignore','pipe','pipe'],timeout:15000,killSignal:'SIGKILL'});
  let out='',error='';child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>error+=chunk);
  child.once('error',reject);child.once('close',code=>resolve({code,out,error}));
  return promise;
 };
 const verifyOfficial=async(auth:unknown={kind:'localCredential',token:localCredential})=>{
  assert.equal(failure,undefined);
  assert.equal(await readFile(join(paseoHome,'paseo.pid'),'utf8'),pid);
  assert.equal(await readFile(join(paseoHome,'local-credential'),'utf8'),localCredential);
  assert.ok(officialRequests.every(type=>['session.events.set_subscription.request','subscription.release.request'].includes(type)));
  for(const hello of hellos)assert.deepEqual(hello.auth,auth);
 };
 return {home,state,paseoHome,cli,hellos,cloudRequests,verifyOfficial,target:'tcp://127.0.0.1:'+address.port+'?password=synthetic-explicit-password'};
}

test('explicit pair discovers existing official connection and enrolls on production without configure; diagnostics never opt in', {timeout:30000},async t=>{
 const f=await fixture(t);
 const fresh=await loadConfig(f.state);assert.equal(fresh.cloudEnabled,false);assert.equal(fresh.apiOrigin,undefined);
 for(const args of [['check'],['status'],['check','--connect']]){
  const result=await f.cli(args);assert.equal(result.code,0,result.error);
  assert.doesNotMatch(result.out,new RegExp(localCredential));
 }
 assert.equal(f.cloudRequests.length,0);assert.equal(f.hellos.length,1);
 await assert.rejects(readFile(join(f.state,'config.json')), {code:'ENOENT'});
 const result=await f.cli(['pair','--json']);assert.equal(result.code,0,result.error);
 const offer=JSON.parse(result.out),saved=await loadConfig(f.state),pair=saved.pairs[0];
 assert.equal(offer.apiOrigin,production);assert.equal(saved.apiOrigin,production);assert.equal(saved.cloudEnabled,true);
 assert.equal(saved.target,undefined);assert.equal(saved.paseoHome,f.paseoHome);
 assert.equal(pair.active,true);assert.equal(pair.pairId,offer.pairId);assert.equal(pair.rootKey,offer.rootKey);
 assert.equal(pair.daemonServerId,'synthetic-onboarding-daemon');assert.equal(pair.enrollmentToken,undefined);
 assert.deepEqual(f.cloudRequests.map(request=>request.method),['POST','GET','POST']);
 assert.deepEqual((await readdir(f.state)).sort(),['.moremote-cli-owner','config.json']);
 await f.verifyOfficial();
});

test('explicit pair opts in on configured custom origin without retargeting retained pair authority', {timeout:30000},async t=>{
 const origin='https://synthetic-custom-relay.example.test',f=await fixture(t,origin);
 const configured=await f.cli(['configure','--api-origin',origin,'--target',f.target]);assert.equal(configured.code,0,configured.error);
 const config=await loadConfig(f.state);assert.equal(config.cloudEnabled,false);
 const retained={pairId:'11111111-1111-4111-8111-111111111111',apiOrigin:'https://synthetic-former-relay.example.test',rootKey:Buffer.alloc(32,9).toString('base64url'),hostToken:Buffer.alloc(32,10).toString('base64url'),active:false,revokedAt:1,daemonServerId:'synthetic-former-daemon'};
 config.pairs.push(retained);await saveConfig(f.state,config);
 const before=await readFile(join(f.state,'config.json'),'utf8');
 for(const args of [['check'],['status']])assert.equal((await f.cli(args)).code,0);
 assert.equal(await readFile(join(f.state,'config.json'),'utf8'),before);assert.equal(f.cloudRequests.length,0);
 const result=await f.cli(['pair','--json']);assert.equal(result.code,0,result.error);
 const saved=await loadConfig(f.state);assert.equal(saved.apiOrigin,origin);assert.equal(saved.cloudEnabled,true);assert.equal(saved.target,f.target);
 assert.equal(JSON.parse(result.out).apiOrigin,origin);assert.deepEqual(saved.pairs[0],retained);assert.equal(saved.pairs[1].active,true);
 await f.verifyOfficial({kind:'password',password:'synthetic-explicit-password'});
});

test('pair rejects invalid configured origin and pinned daemon mismatch before cloud enrollment', {timeout:30000},async t=>{
 const f=await fixture(t);
 const config:Config={...(await loadConfig(f.state)),apiOrigin:'http://synthetic-insecure.example.test',cloudEnabled:false};
 await saveConfig(f.state,config);
 let result=await f.cli(['pair','--json']);assert.notEqual(result.code,0);assert.match(result.error,/HTTPS_REQUIRED/);
 assert.equal(f.hellos.length,0);assert.equal(f.cloudRequests.length,0);
 config.apiOrigin=production;config.daemonServerId='synthetic-other-daemon';await saveConfig(f.state,config);
 const before=await readFile(join(f.state,'config.json'),'utf8');
 result=await f.cli(['pair','--json']);assert.notEqual(result.code,0);assert.match(result.error,/DAEMON_IDENTITY_CHANGED/);
 assert.equal(await readFile(join(f.state,'config.json'),'utf8'),before);assert.equal(f.cloudRequests.length,0);
 await f.verifyOfficial();
});
