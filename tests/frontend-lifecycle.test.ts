import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as sleep} from 'node:timers/promises';
import {saveConfig,privateManagedDirectory} from '../src/config.ts';
import {initialUpdateState,writeUpdateState,supervisorRunning} from '../src/update-state.ts';
import {packageVersion} from '../src/updater.ts';
import {requestControl} from '../src/control.ts';
async function bounded<T>(promise:Promise<T>,label:string,ms=8000){const limit=Promise.withResolvers<never>();const timer=setTimeout(()=>limit.reject(Error(label)),ms);try{return await Promise.race([promise,limit.promise])}finally{clearTimeout(timer)}}
async function until(predicate:()=>Promise<boolean>,label:string){const end=Date.now()+8000;while(Date.now()<end){if(await predicate())return;await sleep(20)}throw Error(label)}
async function fixture(){
 const root=await mkdtemp(join(process.platform==='win32'?tmpdir():'/tmp','mfl-')),dir=join(root,'c'),version=await packageVersion();
 await saveConfig(dir,{version:1,clientId:'moremote-cli-frontend-test',paseoHome:join(root,'unused-official'),target:'tcp://127.0.0.1:1',allowLoopbackHttp:false,cloudEnabled:false,pairs:[]});
 await privateManagedDirectory(join(dir,'managed'));await privateManagedDirectory(join(dir,'managed','versions'));
 const selected=join(dir,'managed','versions',version,'node_modules','@moxuli','moremote'),frontend=join(root,'frontend');
 const bin=await readFile(new URL('../bin/moremote-cli.js',import.meta.url),'utf8');
 for(const location of [selected,frontend]){
  await mkdir(join(location,'bin'),{recursive:true});await mkdir(join(location,'dist'));
  await writeFile(join(location,'package.json'),JSON.stringify({name:'@moxuli/moremote',version,type:'module'}));
  await writeFile(join(location,'bin','moremote-cli.js'),bin);
  // Execute production source through tsx without depending on a prior build.
  // These bridges replace no behavior: actual CLI/supervisor/runtime/resources
  // still create the real journal, control server and OS child IPC lifecycle.
  for(const module of ['config','update-state','service','cli'])await writeFile(join(location,'dist',module+'.js'),'export * from '+JSON.stringify(new URL('../src/'+module+'.ts',import.meta.url).href)+';');
 }
 const state=initialUpdateState(version);state.enabled=false;writeUpdateState(dir,state);
 const child=spawn(process.execPath,[join(frontend,'bin','moremote-cli.js'),'run','--data-dir',dir],{cwd:new URL('..',import.meta.url),detached:process.platform!=='win32',env:{...process.env,NODE_OPTIONS:[process.env.NODE_OPTIONS,'--import=tsx'].filter(Boolean).join(' ')},stdio:['ignore','ignore','inherit','ipc']});
 const done=Promise.withResolvers<number|null>(),ready=Promise.withResolvers<string>();let readySeen=false;
 child.on('message',message=>{if(message&&typeof message==='object'&&'kind' in message&&message.kind==='moremote-ready'&&'version' in message&&typeof message.version==='string'){readySeen=true;ready.resolve(message.version)}});
 child.once('error',error=>{done.reject(error);ready.reject(error)});child.once('exit',code=>{done.resolve(code);if(!readySeen)ready.reject(Error('DELEGATED_FRONTEND_EXITED_'+code))});void done.promise.catch(()=>{});void ready.promise.catch(()=>{});
 const waitReady=async(signal:AbortSignal)=>{const cancelled=Promise.withResolvers<never>();const abort=()=>cancelled.reject(signal.reason??Error('READINESS_CANCELLED'));if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});try{assert.equal(await Promise.race([ready.promise,cancelled.promise]),version);assert.equal((await requestControl(dir,'status'))?.version,version)}finally{signal.removeEventListener('abort',abort)}};
 let stopped=false;
 const waitStopped=async()=>{await until(async()=>{try{await lstat(join(dir,'managed','supervisor.lock'));return false}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return true;throw error}},'SUPERVISOR_OWNERSHIP_NOT_RELEASED');assert.equal(await requestControl(dir,'status'),null);assert.equal(supervisorRunning(dir),false);stopped=true};
 async function close(){
  // The process group was created above and contains only this fixture's
  // wrapper/supervisor/runtime. Never signal a PID obtained from state files.
  // Once shutdown is independently proven, the old group ID is no longer an
  // authority to signal anything; teardown must not require another group kill.
  if(!stopped){
   if(process.platform!=='win32'&&child.pid)try{process.kill(-child.pid,'SIGKILL')}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error}
   else if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
  }
  await bounded(done.promise,'FRONTEND_FIXTURE_EXIT_TIMEOUT');await rm(root,{recursive:true,force:true});
 }
 return {dir,version,child,exit:done.promise,waitReady,waitStopped,close};
}

for(const signal of ['SIGTERM','SIGINT'] as const)test(`delegated foreground ${signal} reaches the actual supervisor and waits for runtime ownership release`,{timeout:15000,skip:process.platform==='win32'?'POSIX signal semantics; Windows exercises parent IPC below':false},async(context)=>{
 // Real subprocess signals/IPC and SQLite ownership cannot be proven with a
 // fake clock or a mock child that merely echoes forwarded messages.
 const f=await fixture();try{
  await f.waitReady(context.signal);
  assert.equal(supervisorRunning(f.dir),true);f.child.kill(signal);
  assert.equal(await bounded(f.exit,'WRAPPER_DID_NOT_WAIT_FOR_SHUTDOWN'),0);
  await f.waitStopped();
 }finally{await f.close()}
});

test('loss of the wrapper parent IPC shuts down the delegated supervisor instead of orphaning command consumption',{timeout:15000},async(context)=>{
 const f=await fixture();try{
  await f.waitReady(context.signal);
  f.child.disconnect();assert.equal(await bounded(f.exit,'PARENT_DISCONNECT_ORPHANED_WRAPPER'),0);
  await f.waitStopped();
 }finally{await f.close()}
});

test('abrupt wrapper death closes its child IPC and drains the actual selected runtime',{timeout:15000,skip:process.platform==='win32'?'POSIX dedicated-group cleanup for an intentionally killed wrapper':false},async(context)=>{
 const f=await fixture();try{
  await f.waitReady(context.signal);
  f.child.kill('SIGKILL');await bounded(f.exit,'WRAPPER_KILL_FAILED');
  await f.waitStopped();
 }finally{await f.close()}
});
