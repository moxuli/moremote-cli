import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtemp,rm,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {saveConfig} from '../src/config.ts';
import {openOwnedJournal} from '../src/resources.ts';
import {requestControl} from '../src/control.ts';
async function bounded<T>(promise:Promise<T>,label:string,ms=5000){const limit=Promise.withResolvers<never>();const timer=setTimeout(()=>limit.reject(Error(label)),ms);try{return await Promise.race([promise,limit.promise])}finally{clearTimeout(timer)}}
interface FixtureProcess {child:ChildProcess;exit:Promise<number|null>;ready:Promise<void>}
function start(source:string):FixtureProcess{
 const child=spawn(process.execPath,['--import','tsx','--input-type=module','--eval',source],{cwd:new URL('..',import.meta.url),stdio:['ignore','ignore','inherit','ipc']});
 const done=Promise.withResolvers<number|null>(),ready=Promise.withResolvers<void>();let readySeen=false;
 child.on('message',message=>{if(message&&typeof message==='object'&&'kind' in message&&message.kind==='moremote-ready'){readySeen=true;ready.resolve()}});
 child.once('error',error=>{done.reject(error);ready.reject(error)});child.once('exit',code=>{done.resolve(code);if(!readySeen)ready.reject(Error('RUNTIME_EXITED_BEFORE_READY_'+code))});void done.promise.catch(()=>{});void ready.promise.catch(()=>{});return {child,exit:done.promise,ready:ready.promise};
}
async function dispose(child:ChildProcess,exit:Promise<number|null>){if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await bounded(exit,'OWNED_FIXTURE_EXIT_TIMEOUT')}

test('SQLite initialization failure releases live control ownership, closes its database and permits a repaired runtime to restart',{timeout:15000},async()=>{
 // These subprocesses deliberately use real SQLite/control handles: fake timers
 // cannot prove the event loop exits rather than retaining a live IPC server.
 const root=await mkdtemp(join(process.platform==='win32'?tmpdir():'/tmp','mri-')),dir=join(root,'c');const children:FixtureProcess[]=[];
 try{
  await saveConfig(dir,{version:1,clientId:'moremote-cli-startup-test',paseoHome:join(root,'unused-official'),target:'tcp://127.0.0.1:1',allowLoopbackHttp:false,cloudEnabled:false,pairs:[]});
  const broken=openOwnedJournal(join(dir,'journal.sqlite'));try{broken.exec('CREATE TABLE occurrences(incompatible TEXT)')}finally{broken.close()}
  const runtime=new URL('../src/runtime.ts',import.meta.url).href,control=new URL('../src/control.ts',import.meta.url).href;
  const first=start(`import {runRuntime} from ${JSON.stringify(runtime)};import {requestControl} from ${JSON.stringify(control)};try{await runRuntime(${JSON.stringify(dir)});process.exitCode=2}catch{process.send?.({kind:'initialization-failed',runtime:await requestControl(${JSON.stringify(dir)},'status')});process.exitCode=1}finally{if(process.connected)process.disconnect()}`);children.push(first);
  const report=Promise.withResolvers<unknown>();first.child.on('message',report.resolve);
  assert.deepEqual(await bounded(report.promise,'INITIALIZATION_REPORT_MISSING'),{kind:'initialization-failed',runtime:null});
  assert.equal(await bounded(first.exit,'FAILED_RUNTIME_RETAINED_SERVER'),1);
  for(const name of ['runtime.lock','runtime.json',...(process.platform==='win32'?[]:['runtime.sock'])])await assert.rejects(lstat(join(dir,name)),{code:'ENOENT'});
  const repaired=openOwnedJournal(join(dir,'journal.sqlite'));try{repaired.exec('DROP TABLE occurrences')}finally{repaired.close()}
  const second=start(`import {runRuntime} from ${JSON.stringify(runtime)};await runRuntime(${JSON.stringify(dir)});if(process.connected)process.disconnect()`);children.push(second);
  await bounded(second.ready,'REPAIRED_RUNTIME_COULD_NOT_ACQUIRE');assert.ok(await requestControl(dir,'status'));
  await requestControl(dir,'stop');assert.equal(await bounded(second.exit,'REPAIRED_RUNTIME_COULD_NOT_EXIT'),0);
 }finally{for(const {child,exit} of children)await dispose(child,exit);await rm(root,{recursive:true,force:true})}
});
