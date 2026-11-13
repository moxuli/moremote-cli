import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFile,stat,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {ownRuntime,requestControl} from '../src/control.ts';
import {loadConfig,saveConfig} from '../src/config.ts';
import {CONFIG_BYTES} from '../src/resources.ts';
import {enrollmentFixture,daemon} from './enrollment-fixture.ts';
import {setupEnrollment} from '../src/setup.ts';
import {makeOffer} from '../src/pairing.ts';

test('setup excludes a second actual run throughout authenticated configuration writes',{timeout:15000},async t=>{
 const f=await enrollmentFixture(t),original=await loadConfig(f.state),pair=makeOffer(original.apiOrigin!).pair;
 pair.daemonServerId=daemon;original.pairs.push(pair);await saveConfig(f.state,original);
 const before=await readFile(join(f.state,'config.json'));
 await setupEnrollment(f.state,{yes:true,home:f.home,stopOwned:async()=>{},authenticate:async current=>{
  const child=spawn(process.execPath,['--import','tsx','src/cli.ts','run','--data-dir',f.state],{cwd:new URL('..',import.meta.url),env:{...process.env,HOME:f.home,USERPROFILE:f.home,PASEO_HOME:f.paseoHome,PASEO_PASSWORD:''},stdio:['ignore','pipe','pipe','ipc']});
  t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL')});
  const ready=Promise.withResolvers<boolean>(),exited=once(child,'exit');let error='';
  child.stderr.on('data',chunk=>{error+=chunk});child.on('message',message=>{if(message&&typeof message==='object'&&'kind' in message&&message.kind==='moremote-ready')ready.resolve(true)});
  child.once('exit',()=>ready.resolve(false));
  if(await ready.promise){await requestControl(f.state,'stop');if(child.connected)child.disconnect()}
  const [code]=await exited;assert.notEqual(code,0,'concurrent run must not acquire setup configuration ownership');assert.match(error,/CLI_ALREADY_RUNNING/);
  assert.deepEqual(await readFile(join(f.state,'config.json')),before);
  return f.authenticate(current);
 },install:async()=>{}});
 const saved=await loadConfig(f.state);assert.deepEqual(saved.pairs,[pair]);assert.equal(saved.cloudEnabled,true);
});

test('runtime starting during setup preparation keeps its newer configuration intact',async t=>{
 const f=await enrollmentFixture(t);let release:(()=>Promise<void>)|undefined;let expected:Buffer|undefined;
 t.after(async()=>{await release?.()});
 await assert.rejects(setupEnrollment(f.state,{yes:true,home:f.home,stopOwned:async()=>{},prepare:async()=>{
  release=await ownRuntime(f.state,()=>({stage:'synthetic-live'}),()=>{});
  const latest=await loadConfig(f.state),pair=makeOffer(latest.apiOrigin!).pair;pair.daemonServerId=daemon;latest.pairs.push(pair);await saveConfig(f.state,latest);expected=await readFile(join(f.state,'config.json'));
 },authenticate:f.authenticate,install:async()=>{throw Error('UNEXPECTED_INSTALL')}}),/CLI_ALREADY_RUNNING/);
 assert.deepEqual(await readFile(join(f.state,'config.json')),expected);
});

test('duplicate run refuses before rewriting live enrollment configuration',async t=>{
 const f=await enrollmentFixture(t),config=await f.setup(),consumer=f.consumer();await consumer.cycle(config,daemon,f.cloud);await f.put();await consumer.cycle(config,daemon,f.cloud);
 const release=await ownRuntime(f.state,()=>({stage:'synthetic-live'}),()=>{});t.after(release);
 const path=join(f.state,'config.json'),before=await readFile(path),identity=await stat(path);
 const child=spawn(process.execPath,['--import','tsx','src/cli.ts','run','--data-dir',f.state],{cwd:new URL('..',import.meta.url),env:{...process.env,HOME:f.home,USERPROFILE:f.home},stdio:['ignore','pipe','pipe']});
 let error='';child.stderr.on('data',chunk=>{error+=chunk});const [code]=await once(child,'exit');assert.notEqual(code,0);assert.match(error,/CLI_ALREADY_RUNNING/);
 assert.deepEqual(await readFile(path),before);assert.equal((await stat(path)).ino,identity.ino);
 await release();
});

test('sixteen maximum-size requests preserve exact control whitespace across every config reader and writer',async t=>{
 const f=await enrollmentFixture(t),config=await f.setup(),consumer=f.consumer();await consumer.cycle(config,daemon,f.cloud);
 const originals=new Map<string,string>();
 for(let index=0;index<16;index++){
  const suffix=String(index).padStart(12,'0'),request=f.request({id:'77777777-7777-4777-8777-'+suffix,clientId:'88888888-8888-4888-8888-'+suffix});
  const compact=JSON.stringify(request),bytes=compact+'\t\n'.repeat(Math.floor((4096-Buffer.byteLength(compact))/2))+' '.repeat((4096-Buffer.byteLength(compact))%2);originals.set(request.id,bytes);await f.put(request,bytes);
 }
 for(let index=0;index<16;index++)await consumer.cycle(config,daemon,f.cloud);
 const path=join(f.state,'config.json'),before=await readFile(path);assert.ok(before.length>131072);assert.ok(before.length<=CONFIG_BYTES);
 const saved=await loadConfig(f.state);assert.equal(saved.enrollmentRequests?.length,16);for(const record of saved.enrollmentRequests!)assert.equal(record.bytes,originals.get(record.request.id));
 saved.pairs[0].activationProof='x'.repeat(CONFIG_BYTES);await assert.rejects(saveConfig(f.state,saved),/CONFIG_LIMIT/);assert.deepEqual(await readFile(path),before);
});

test('optional admission attempts one cloud create per cycle and aborts a held response within its own deadline',{timeout:15000},async t=>{
 const f=await enrollmentFixture(t),config=await f.setup(),consumer=f.consumer();await consumer.cycle(config,daemon,f.cloud);
 await f.put();await f.put(f.request({id:'66666666-6666-4666-8666-666666666666',clientId:'55555555-5555-4555-8555-555555555555'}));
 f.holdCreate();const start=performance.now();await assert.rejects(consumer.cycle(config,daemon,f.cloud));const elapsed=performance.now()-start;
 assert.ok(elapsed>=2500&&elapsed<5000,'optional create must use a separate ~3s deadline');assert.equal(f.cloudRequests.length,1);assert.equal(config.pairs.length,1);assert.equal(config.enrollmentRequests![0].created,false);
 await consumer.cycle(await loadConfig(f.state),daemon,f.cloud);assert.equal(f.cloudRequests.length,2);assert.equal(f.cloudRequests[0].bytes,f.cloudRequests[1].bytes);assert.equal(f.creates.size,1);
 await consumer.cycle(await loadConfig(f.state),daemon,f.cloud);assert.equal(f.creates.size,2);
});

test('fresh run initializes configuration only inside acquired runtime ownership',{timeout:15000},async t=>{
 const f=await enrollmentFixture(t);await rm(join(f.state,'config.json'));
 const child=spawn(process.execPath,['--import','tsx','src/cli.ts','run','--data-dir',f.state],{cwd:new URL('..',import.meta.url),env:{...process.env,HOME:f.home,USERPROFILE:f.home,PASEO_HOME:f.paseoHome,PASEO_PASSWORD:''},stdio:['ignore','pipe','pipe','ipc']});
 t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL')});
 const ready=Promise.withResolvers<void>(),exited=once(child,'exit');let error='';
 child.stderr.on('data',chunk=>{error+=chunk});child.on('message',message=>{if(message&&typeof message==='object'&&'kind' in message&&message.kind==='moremote-ready')ready.resolve()});
 child.once('exit',()=>ready.reject(Error(error||'RUNTIME_EXITED_BEFORE_READY')));
 await ready.promise;const saved=await loadConfig(f.state);
 assert.equal(saved.paseoHome,f.paseoHome);assert.equal(saved.cloudEnabled,false);assert.deepEqual(saved.pairs,[]);assert.equal(saved.localEnrollment,undefined);
 assert.ok((await readFile(join(f.state,'config.json'),'utf8')).includes(saved.clientId));await requestControl(f.state,'stop');if(child.connected)child.disconnect();const [code]=await exited;assert.equal(code,0,error);
 await f.verifyOfficial(true);
});
