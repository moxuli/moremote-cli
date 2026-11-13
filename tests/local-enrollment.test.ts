import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,symlink,link,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as sleep} from 'node:timers/promises';
import {loadConfig,saveConfig,privateManagedDirectory} from '../src/config.ts';
import {initialUpdateState,writeUpdateState,disableAutoUpdate,readUpdateState} from '../src/update-state.ts';
import {setupEnrollment} from '../src/setup.ts';
import {DEFAULT_API_ORIGIN} from '../src/local-enrollment.ts';
import {EnrollmentFiles} from '../src/enrollment-files.ts';
import {activatePending,makeOffer} from '../src/pairing.ts';
import {requestControl} from '../src/control.ts';
import {object} from '../src/limits.ts';
import {enrollmentFixture,daemon,requestId,origin} from './enrollment-fixture.ts';

async function admitted(t:test.TestContext){
 const f=await enrollmentFixture(t),config=await f.setup(),consumer=f.consumer();
 await consumer.cycle(config,daemon,f.cloud);const bytes=await f.put();
 await consumer.cycle(config,daemon,f.cloud);return {...f,config,consumer,bytes,newConsumer:f.consumer};
}

test('fresh explicit setup authenticates with no workspace; passive consumers never create discovery',async t=>{
 const f=await enrollmentFixture(t),config=await loadConfig(f.state);delete config.apiOrigin;await saveConfig(f.state,config);
 const passive=f.consumer();await passive.cycle(config,daemon,f.cloud);await assert.rejects(readdir(f.tree),{code:'ENOENT'});
 await assert.rejects(setupEnrollment(f.state,{yes:false,home:f.home,stopOwned:async()=>{throw Error('UNEXPECTED_STOP')},authenticate:f.authenticate,install:async()=>{throw Error('UNEXPECTED_INSTALL')}}),/EXPLICIT_YES_REQUIRED/);
 const saved=await f.setup();assert.equal(saved.cloudEnabled,true);assert.equal(saved.apiOrigin,DEFAULT_API_ORIGIN);assert.deepEqual(saved.localEnrollment,{home:f.home});assert.equal(saved.daemonServerId,daemon);assert.equal(saved.pairs.length,0);
 assert.equal(f.stopped,1);assert.equal(f.installed,1);assert.equal(f.cloudRequests.length,0);
 assert.ok(f.officialRequests.every(type=>['session.events.set_subscription.request','subscription.release.request'].includes(type)));
 const consumer=f.consumer();await consumer.cycle(saved,daemon,f.cloud);
 const descriptor=object(JSON.parse(await readFile(join(f.tree,'descriptor.json'),'utf8')));
 assert.deepEqual(Object.keys(descriptor).sort(),['apiOrigin','daemonServerId','enabled','expiresAt','instanceId','measuredAt','version']);assert.equal(descriptor.apiOrigin,DEFAULT_API_ORIGIN);assert.equal(descriptor.expiresAt,Number(descriptor.measuredAt)+90000);
 await f.verifyOfficial();
});

test('setup reloads after stopping and preserves custom authorities, active/revoked pairs and update opt-out',async t=>{
 const f=await enrollmentFixture(t),config=await loadConfig(f.state),first=makeOffer(origin).pair,second=makeOffer('https://synthetic-old-relay.example.test').pair;
 first.active=true;first.daemonServerId=daemon;second.revokedAt=1;second.daemonServerId='retired-synthetic-daemon';config.pairs=[first,second];await saveConfig(f.state,config);
 await privateManagedDirectory(join(f.state,'managed'));writeUpdateState(f.state,initialUpdateState('0.1.2'));disableAutoUpdate(f.state);
 const before=await readFile(join(f.state,'managed','update.json'),'utf8');
 const saved=await setupEnrollment(f.state,{yes:true,home:f.home,stopOwned:async()=>{const latest=await loadConfig(f.state);latest.target=undefined;await saveConfig(f.state,latest)},authenticate:f.authenticate,install:async()=>{assert.deepEqual((await loadConfig(f.state)).pairs,[first,second])}});
 assert.equal(saved.apiOrigin,origin);assert.deepEqual(saved.pairs,[first,second]);assert.equal(readUpdateState(f.state)?.enabled,false);assert.equal(await readFile(join(f.state,'managed','update.json'),'utf8'),before);
 await f.verifyOfficial(true);
});

test('exact immutable request creates one durable pair and reuses its original canonical offer',async t=>{
 const f=await admitted(t);const first=await f.response();assert.equal(first.status,'offer');assert.deepEqual(first.offer,f.config.enrollmentRequests![0].offer);assert.equal(first.expiresAt,f.request().expiresAt);
 for(let retry=0;retry<3;retry++){const config=await loadConfig(f.state);await f.consumer.cycle(config,daemon,f.cloud);assert.deepEqual(await f.response(),first)}
 assert.equal(f.creates.size,1);assert.equal(f.cloudRequests.filter(request=>request.method==='POST').length,1);assert.equal((await loadConfig(f.state)).pairs.length,1);
 assert.equal((await stat(join(f.tree,'responses',requestId+'.json'))).mode&0o777,0o600);
 const descriptor=await readFile(join(f.tree,'descriptor.json'),'utf8');f.advance(29999);await f.consumer.cycle(await loadConfig(f.state),daemon,f.cloud);assert.equal(await readFile(join(f.tree,'descriptor.json'),'utf8'),descriptor);
 f.advance(1);await f.consumer.cycle(await loadConfig(f.state),daemon,f.cloud);assert.notEqual(await readFile(join(f.tree,'descriptor.json'),'utf8'),descriptor);
});

test('changed bytes, client, daemon and expiry never replace an admitted request authority',async t=>{
 const f=await admitted(t),original=await f.response(),request=f.request();
 for(const bytes of [f.bytes+'\n',JSON.stringify({...request,clientId:'55555555-5555-4555-8555-555555555555'}),JSON.stringify({...request,daemonServerId:'foreign-daemon'}),JSON.stringify({...request,expiresAt:request.expiresAt-1}),'','{']){
  await f.put(request,bytes);await assert.rejects(f.consumer.cycle(await loadConfig(f.state),daemon,f.cloud),/ENROLLMENT_REQUEST_CONFLICT/);
  await assert.rejects(f.response(),{code:'ENOENT'});await f.put(request,f.bytes);await f.consumer.cycle(await loadConfig(f.state),daemon,f.cloud);assert.deepEqual(await f.response(),original);
 }
 assert.equal(f.creates.size,1);assert.equal(f.cloudRequests.filter(request=>request.method==='POST').length,1);
});

test('concurrent ownership fails closed; graceful restart preserves pair and exact offer',async t=>{
 const f=await admitted(t),other=f.newConsumer(),original=await f.response();
 await assert.rejects(other.cycle(await loadConfig(f.state),daemon,f.cloud),/DISCOVERY_ALREADY_RUNNING/);
 f.consumer.close();await assert.rejects(f.response(),{code:'ENOENT'});
 await other.cycle(await loadConfig(f.state),daemon,f.cloud);assert.deepEqual(await f.response(),original);assert.equal(f.creates.size,1);
 const foreign=new EnrollmentFiles({home:f.home,stateDirectory:join(f.home,'foreign-state'),daemonServerId:daemon});assert.throws(()=>foreign.open(),/FOREIGN_DISCOVERY_DIRECTORY/);
});

test('lost cloud creation acknowledgement and dead runtime restart reuse exact durable cloud bytes', {timeout:20000},async t=>{
 const f=await enrollmentFixture(t),config=await f.setup(),initial=f.consumer();await initial.cycle(config,daemon,f.cloud);initial.close();await f.put();f.dropCreate();
 const script=`import {loadConfig} from ${JSON.stringify(new URL('../src/config.ts',import.meta.url).href)};import {LocalEnrollment} from ${JSON.stringify(new URL('../src/local-enrollment.ts',import.meta.url).href)};import {CloudClient} from ${JSON.stringify(new URL('../src/cloud-client.ts',import.meta.url).href)};const config=await loadConfig(${JSON.stringify(f.state)});const realFetch=globalThis.fetch;const fetcher=(input,init)=>realFetch('http://127.0.0.1:${f.relayPort}'+new URL(String(input)).pathname,init);const consumer=new LocalEnrollment(${JSON.stringify(f.state)},{clock:()=>${f.now}});try{await consumer.cycle(config,${JSON.stringify(daemon)},pair=>new CloudClient(pair.apiOrigin,pair.pairId,pair.hostToken,false,fetcher));process.exit(2)}catch{process.exit(0)}`;
 const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',script],{cwd:new URL('..',import.meta.url),env:{...process.env,HOME:f.home,USERPROFILE:f.home},stdio:['ignore','pipe','pipe']});
 let error='';child.stderr.on('data',chunk=>{error+=chunk});const [code]=await once(child,'exit');assert.equal(code,0,error);
 const saved=await loadConfig(f.state),record=saved.enrollmentRequests![0];assert.equal(record.created,false);await assert.rejects(f.response(),{code:'ENOENT'});
 const restarted=f.consumer();await restarted.cycle(saved,daemon,f.cloud);assert.equal(f.creates.size,1);assert.equal(f.cloudRequests.length,2);assert.equal(f.cloudRequests[0].bytes,f.cloudRequests[1].bytes);assert.equal(saved.pairs.length,1);assert.equal(saved.enrollmentRequests![0].created,true);assert.deepEqual((await f.response()).offer,record.offer);
});

test('cloud disablement hides offers; revoked exact requests stay disabled while an explicit fresh request can enroll',async t=>{
 const f=await admitted(t);let config=await loadConfig(f.state);config.cloudEnabled=false;await saveConfig(f.state,config);await f.consumer.cycle(config,daemon,f.cloud);
 await assert.rejects(f.response(),{code:'ENOENT'});assert.equal(object(JSON.parse(await readFile(join(f.tree,'descriptor.json'),'utf8'))).enabled,false);assert.equal(f.creates.size,1);
 config=await f.setup();config.pairs[0].revokedAt=f.now;await saveConfig(f.state,config);await f.consumer.cycle(config,daemon,f.cloud);assert.equal((await f.response()).status,'disabled');assert.equal((await f.response()).offer,undefined);
 const newRequest=f.request({id:'66666666-6666-4666-8666-666666666666'});await f.put(newRequest);await f.consumer.cycle(config,daemon,f.cloud);
 assert.equal(config.pairs.length,2);assert.equal(f.creates.size,2);
 assert.equal((await f.response()).status,'disabled');
 const replacement=object(JSON.parse(await readFile(join(f.tree,'responses',newRequest.id+'.json'),'utf8')));
 assert.equal(replacement.status,'offer');assert.notEqual(object(replacement.offer).pairId,config.pairs[0].pairId);
});

test('activation uses unchanged endpoint proof and removes request and private response immediately',async t=>{
 const f=await admitted(t);f.allowClaim();const config=await loadConfig(f.state),pair=config.pairs[0];
 assert.equal(await activatePending(config,f.state,pair,f.cloud(pair),daemon,'Synthetic computer'),true);await f.consumer.cleanup(config);
 assert.equal((await loadConfig(f.state)).pairs[0].active,true);await assert.rejects(f.response(),{code:'ENOENT'});await assert.rejects(readFile(join(f.tree,'requests',requestId+'.json')),{code:'ENOENT'});
 assert.equal(f.creates.size,1);assert.deepEqual(f.cloudRequests.map(request=>request.method),['POST','GET','POST']);
});

test('original expiry cleans keys from discovery and expired requests cannot renew enrollment',async t=>{
 const f=await admitted(t),request=f.request();f.advance(600000);const config=await loadConfig(f.state);await f.consumer.cleanup(config);
 await assert.rejects(f.response(),{code:'ENOENT'});await assert.rejects(readFile(join(f.tree,'requests',requestId+'.json')),{code:'ENOENT'});assert.deepEqual((await loadConfig(f.state)).enrollmentRequests,[]);
 await f.put(request);await f.consumer.cycle(config,daemon,f.cloud);assert.equal(f.creates.size,1);assert.equal(config.pairs.length,1);await assert.rejects(f.response(),{code:'ENOENT'});
 await f.put(f.request({clientId:'99999999-9999-4999-8999-999999999999'}));await assert.rejects(f.consumer.cycle(config,daemon,f.cloud),/ENROLLMENT_REQUEST_CONFLICT/);assert.equal(f.creates.size,1);
});

test('admission is bounded to sixteen requests and the existing sixteen-pair ceiling',async t=>{
 const f=await enrollmentFixture(t),config=await f.setup(),consumer=f.consumer();await consumer.cycle(config,daemon,f.cloud);
 for(let index=0;index<17;index++){const suffix=String(index).padStart(12,'0'),request=f.request({id:'77777777-7777-4777-8777-'+suffix,clientId:'88888888-8888-4888-8888-'+suffix}),bytes=JSON.stringify(request);await f.put(request,bytes+' '.repeat(4096-Buffer.byteLength(bytes)))}
 for(let cycle=0;cycle<16;cycle++)await consumer.cycle(config,daemon,f.cloud);assert.equal(config.pairs.length,16);assert.equal(f.creates.size,16);
 assert.equal((await loadConfig(f.state)).enrollmentRequests?.length,16);
 await assert.rejects(consumer.cycle(config,daemon,f.cloud),/PAIRING_LIMIT/);assert.equal(f.creates.size,16);assert.equal(config.pairs.length,16);
});

test('foreign roots, markers, request links and response collisions fail before cloud creation',async t=>{
 for(const boundary of ['root','marker','request-symlink','request-hardlink','response','daemon','oversize','utf8','future'])await t.test(boundary,async t=>{
  const f=await enrollmentFixture(t),config=await f.setup(),consumer=f.consumer();
  if(boundary==='root'){await symlink(f.paseoHome,join(f.home,'.moremote-cli-connect'),'dir');await assert.rejects(consumer.cycle(config,daemon,f.cloud),/FOREIGN_RESOURCE_KIND/);assert.equal(f.creates.size,0);return}
  await consumer.cycle(config,daemon,f.cloud);
  if(boundary==='marker'){await writeFile(join(f.tree,'.moremote-cli-owner'),'foreign');await assert.rejects(consumer.cycle(config,daemon,f.cloud),/FOREIGN_DISCOVERY_DIRECTORY/);const next=f.consumer();await assert.rejects(next.cycle(config,daemon,f.cloud),/FOREIGN_DISCOVERY_DIRECTORY/)}
  else if(boundary==='request-symlink'){
   await symlink(join(f.paseoHome,'local-credential'),join(f.tree,'requests',requestId+'.json'));await assert.rejects(consumer.cycle(config,daemon,f.cloud),/FOREIGN_RESOURCE_KIND/);
  }else if(boundary==='request-hardlink'){
   await writeFile(join(f.home,'foreign'),JSON.stringify(f.request()));await link(join(f.home,'foreign'),join(f.tree,'requests',requestId+'.json'));await assert.rejects(consumer.cycle(config,daemon,f.cloud),/FOREIGN_RESOURCE_LINKS/);
  }else if(boundary==='response'){
   await f.put();await writeFile(join(f.tree,'responses',requestId+'.json'),'{}',{mode:0o600});await assert.rejects(consumer.cycle(config,daemon,f.cloud),/FOREIGN_DISCOVERY_RESPONSE/);
  }else if(boundary==='daemon'){
   await f.put(f.request({daemonServerId:'different-daemon'}));await assert.rejects(consumer.cycle(config,daemon,f.cloud),/ENROLLMENT_DAEMON_MISMATCH/);
  }else if(boundary==='oversize'){
   await f.put(f.request(),' '.repeat(4097));await assert.rejects(consumer.cycle(config,daemon,f.cloud),/FOREIGN_RESOURCE_LIMIT/);
  }else if(boundary==='utf8'){
   await writeFile(join(f.tree,'requests',requestId+'.json'),Buffer.from([0xff]),{mode:0o600});await assert.rejects(consumer.cycle(config,daemon,f.cloud),/FOREIGN_RESOURCE_ENCODING/);
  }else{
   await f.put(f.request({issuedAt:f.now+1,expiresAt:f.now+600001}));await assert.rejects(consumer.cycle(config,daemon,f.cloud),/ENROLLMENT_REQUEST_FROM_FUTURE/);
  }
  assert.equal(f.creates.size,0);await f.verifyOfficial();
 });
});

test('request changes while cloud creation is in flight never publish an original offer to replacement bytes',async t=>{
 const f=await enrollmentFixture(t),config=await f.setup(),consumer=f.consumer();await consumer.cycle(config,daemon,f.cloud);const original=await f.put();
 await assert.rejects(consumer.cycle(config,daemon,pair=>({create:async body=>{const result=await f.cloud(pair).create(body);await f.put(f.request(),original+'\n');return result}})),/ENROLLMENT_REQUEST_CONFLICT/);
 await assert.rejects(f.response(),{code:'ENOENT'});assert.equal(f.creates.size,1);assert.equal(config.pairs.length,1);
});

test('real runtime serial cycle enrolls before any workspace and cleans private response after activation', {timeout:20000},async t=>{
 const f=await enrollmentFixture(t),config=await f.setup(),initial=f.consumer();await initial.cycle(config,daemon,f.cloud);initial.close();await f.put();f.allowClaim();
 const preload='data:text/javascript,'+encodeURIComponent(`const realFetch=globalThis.fetch;globalThis.fetch=(input,init)=>{const url=new URL(String(input));if(url.origin!==${JSON.stringify(origin)})throw Error('UNEXPECTED_TEST_ORIGIN');return realFetch('http://127.0.0.1:${f.relayPort}'+url.pathname,init)};`);
 const child=spawn(process.execPath,['--import','tsx','--import',preload,'src/cli.ts','run','--data-dir',f.state],{cwd:new URL('..',import.meta.url),env:{...process.env,HOME:f.home,USERPROFILE:f.home,PASEO_HOME:f.paseoHome,MOREMOTE_CLI_HOME:f.state,PASEO_PASSWORD:''},stdio:['ignore','pipe','pipe']});
 let output='',error='';child.stdout.on('data',chunk=>{output+=chunk});child.stderr.on('data',chunk=>{error+=chunk});const exited=once(child,'exit');
 t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL')});
 const deadline=Date.now()+15000;let active=false;
 while(Date.now()<deadline&&child.exitCode===null){active=(await loadConfig(f.state)).pairs[0]?.active===true;if(active)break;await sleep(25)}
 assert.equal(active,true,error);await requestControl(f.state,'stop');const [code]=await exited;assert.equal(code,0,error);
 const saved=await loadConfig(f.state);assert.equal(saved.pairs.length,1);assert.equal(saved.pairs[0].active,true);assert.equal(f.creates.size,1);
 await assert.rejects(f.response(),{code:'ENOENT'});assert.doesNotMatch(output,/rootKey|enrollmentToken|hostToken/);assert.doesNotMatch(error,/rootKey|enrollmentToken|hostToken/);await f.verifyOfficial();
 assert.ok(f.officialRequests.every(type=>['session.events.set_subscription.request','subscription.release.request','fetch_agents_request'].includes(type)));
});
