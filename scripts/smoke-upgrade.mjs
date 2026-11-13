// Explicit integration acceptance: real npm/tarballs and production supervisor,
// isolated state, no native service/global install/cloud/official daemon writes.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as sleep} from 'node:timers/promises';
import {saveConfig,privateManagedDirectory} from '../dist/config.js';
import {managedEntry} from '../dist/service.js';
import {queueUpdate} from '../dist/updater.js';
import {initialUpdateState,writeUpdateState,readUpdateState,requestSupervisorStop} from '../dist/update-state.js';
import {requestControl} from '../dist/control.js';
const npm=process.env.npm_execpath;assert(npm?.endsWith('npm-cli.js'),'Invoke with npm run smoke:upgrade');
const root=await mkdtemp(join(process.platform==='win32'?tmpdir():'/tmp','mru-')),dir=join(root,'state');
const owned=new Set();let supervisor,stage='initializing',complete=false,cleaning;
function checkpoint(value){stage=value;console.log('[upgrade-smoke] '+value)}
function npmRun(args,cwd=process.cwd()){return execFileSync(process.execPath,[npm,...args],{cwd,encoding:'utf8',timeout:60000,killSignal:'SIGKILL',stdio:['ignore','pipe','pipe']})}
async function deadline(promise,ms,label){const limit=Promise.withResolvers();const timer=setTimeout(()=>limit.reject(Error(label)),ms);try{return await Promise.race([promise,limit.promise])}finally{clearTimeout(timer)}}
async function until(predicate,label,ms){const end=Date.now()+ms;while(Date.now()<end){if(await deadline(Promise.resolve().then(predicate),Math.min(2500,end-Date.now()),label+'_PROBE_TIMEOUT'))return;await sleep(100)}throw Error(label)}
function track(child){
 const done=Promise.withResolvers(),ready=Promise.withResolvers(),record={child,exit:done.promise,ready:ready.promise};let readySeen=false;owned.add(record);
 child.on('message',message=>{if(message&&typeof message==='object'&&message.kind==='moremote-ready'&&typeof message.version==='string'){readySeen=true;ready.resolve(message.version)}});
 child.once('error',error=>{done.reject(error);ready.reject(error)});child.once('exit',(code,signal)=>{done.resolve({code,signal});if(!readySeen)ready.reject(Error('CHILD_EXITED_BEFORE_READY_'+code))});void done.promise.catch(()=>{});void ready.promise.catch(()=>{});return record;
}
function alive(record){return record.child.exitCode===null&&record.child.signalCode===null}
async function publishedRuntimeVersion(){
 try{return (await requestControl(dir,'status'))?.version}
 catch(error){
  // A rollback publishes selection before its replacement runtime is ready.
  // Keep the ownership rejection intact; this is only a bounded read-only probe
  // of the fixture's still-owned supervisor, never a control mutation retry.
  if(error.message==='RUNTIME_UNPROVEN_STAGE'&&supervisor&&alive(supervisor))return undefined;
  throw error;
 }
}
async function terminate(record){
 if(alive(record)&&record.child.pid){
  // Only dedicated groups/PIDs created and retained by this fixture. Never read
  // a PID from state or signal any official daemon/native service manager.
  if(process.platform==='win32')execFileSync('taskkill',['/PID',String(record.child.pid),'/T','/F'],{timeout:5000,stdio:'ignore'});
  else try{process.kill(-record.child.pid,'SIGKILL')}catch(error){if(error.code!=='ESRCH')throw error}
 }
 await deadline(record.exit,5000,'OWNED_CHILD_EXIT_TIMEOUT');
}
async function cleanup(){
 if(cleaning)return cleaning;
 cleaning=(async()=>{
  if(supervisor&&alive(supervisor)){
   requestSupervisorStop(dir);
   await deadline(requestControl(dir,'stop'),2500,'CLEANUP_CONTROL_TIMEOUT').catch(()=>{});
   await deadline(supervisor.exit,5000,'CLEANUP_GRACE_TIMEOUT').catch(()=>{});
  }
  const errors=[];for(const record of owned)try{await terminate(record)}catch(error){errors.push(error)}
  if(complete&&errors.length===0)await deadline(rm(root,{recursive:true,force:true}),10000,'CLEANUP_FILES_TIMEOUT');
  else{
   let selection;try{selection=readUpdateState(dir)}catch{}
   await writeFile(join(root,'smoke-failure.json'),JSON.stringify({stage,selection,teardownErrors:errors.map(error=>error.message)},null,2));
   console.error('[upgrade-smoke] preserved evidence: '+root);
  }
  if(errors.length)throw new AggregateError(errors,'OWNED_CHILD_TEARDOWN_FAILED');
 })();return cleaning;
}
const interrupted=code=>{complete=false;void cleanup().catch(error=>console.error(error.message)).finally(()=>process.exit(code))};
const onInterrupt=()=>interrupted(130),onTerminate=()=>interrupted(143);process.once('SIGINT',onInterrupt);process.once('SIGTERM',onTerminate);
try{
 checkpoint('pack original');
 const original=JSON.parse(npmRun(['pack','--json','--ignore-scripts','--pack-destination',root]))[0];
 await saveConfig(dir,{version:1,clientId:'moremote-cli-packaged-acceptance',target:'tcp://127.0.0.1:1',paseoHome:join(root,'unused-official'),allowLoopbackHttp:false,cloudEnabled:false,pairs:[]});
 await privateManagedDirectory(join(dir,'managed'));await privateManagedDirectory(join(dir,'managed','versions'));
 for(const version of ['9000.0.1','9000.0.2','9000.0.3']){
  checkpoint('pack '+version);
  const build=join(root,version);await mkdir(build);execFileSync('tar',['-xf',join(root,original.filename),'-C',build],{timeout:10000,killSignal:'SIGKILL'});const source=join(build,'package');
  const pkg=JSON.parse(await readFile(join(source,'package.json'),'utf8'));pkg.version=version;await writeFile(join(source,'package.json'),JSON.stringify(pkg));
  if(version==='9000.0.3'){
   // A valid, compatible package whose managed runtime fails before readiness.
   // Only these disposable package bytes change; production code stays intact.
   const cli=join(source,'dist','cli.js');
   await writeFile(cli,"if(process.env.MOREMOTE_MANAGED_CHILD==='1')process.exit(73);\n"+await readFile(cli,'utf8'));
  }
  const tarball=JSON.parse(npmRun(['pack','--json','--ignore-scripts','--pack-destination',build],source))[0];
  checkpoint('install '+version);
  npmRun(['install','--prefix',join(dir,'managed','versions',version),'--ignore-scripts','--no-audit','--no-fund','--fetch-retries=0','--fetch-timeout=20000','--registry=https://registry.npmjs.org',join(build,tarball.filename)]);
  await managedEntry(dir,version);
 }
 const state=initialUpdateState('9000.0.1');state.lastCheck=Date.now();state.nextCheck=Date.now()+21600000;writeUpdateState(dir,state);
 const entry=join(dir,'managed','versions','9000.0.1','node_modules','@moxuli','moremote','bin','moremote-service.js');
 checkpoint('start retained supervisor');
 supervisor=track(spawn(process.execPath,[entry,'run','--data-dir',dir],{detached:process.platform!=='win32',stdio:['ignore','ignore','inherit','ipc']}));
 assert.equal(await deadline(supervisor.ready,20000,'INITIAL_PACKAGED_RUNTIME_NOT_RUNNING'),'9000.0.1');assert.equal((await requestControl(dir,'status'))?.version,'9000.0.1');
 checkpoint('queue compatible candidate');
 await queueUpdate(dir,'9000.0.2');
 await until(async()=>readUpdateState(dir)?.active==='9000.0.2'&&await publishedRuntimeVersion()==='9000.0.2','PACKAGED_UPDATE_DID_NOT_ACTIVATE',90000);
 assert.equal(readUpdateState(dir).previous,'9000.0.1');await managedEntry(dir,'9000.0.1');
 checkpoint('verify frontend through symlinked parent');
 // Node ESM canonicalizes import.meta.url. /tmp→/private/tmp exposed an infinite
 // respawn on macOS; an explicit parent alias exercises it on every platform.
 const alias=join(root,'path-alias');await symlink(root,alias,process.platform==='win32'?'junction':'dir');const aliasDir=join(alias,'state');
 const frontend=await managedEntry(aliasDir,'9000.0.1');
 const frontendRun=track(spawn(process.execPath,[frontend,'--version'],{detached:process.platform!=='win32',stdio:['ignore','pipe','pipe'],env:{...process.env,MOREMOTE_CLI_HOME:aliasDir}}));
 let stdout='',stderrSize=0,outputLimit=false;
 frontendRun.child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>65536){outputLimit=true;void terminate(frontendRun).catch(()=>{})}});
 frontendRun.child.stderr.on('data',chunk=>{stderrSize+=chunk.length;if(stderrSize>65536){outputLimit=true;void terminate(frontendRun).catch(()=>{})}});
 const frontendResult=await deadline(frontendRun.exit,10000,'ALIASED_FRONTEND_TIMEOUT');
 assert.equal(outputLimit,false);assert.equal(frontendResult.code,0);assert.equal(stdout.trim(),'9000.0.2','retained frontend must dispatch once to selected CLI despite parent path aliases');
 checkpoint('queue failing compatible candidate');
 await queueUpdate(dir,'9000.0.3');
 await until(async()=>readUpdateState(dir)?.failed==='9000.0.3'
  &&readUpdateState(dir)?.active==='9000.0.2'
  &&await publishedRuntimeVersion()==='9000.0.2',
  'PACKAGED_UPDATE_DID_NOT_ROLL_BACK',90000);
 const recovered=readUpdateState(dir);
 assert.equal(recovered.bootstrap,'9000.0.1');assert.equal(recovered.previous,'9000.0.1');
 assert.equal(recovered.error,'UPDATE_START_FAILED');
 assert.equal(recovered.pending,undefined);assert.equal(recovered.activating,undefined);
 await managedEntry(dir,'9000.0.1');await managedEntry(dir,'9000.0.3');
 checkpoint('stop owned supervisor');
 requestSupervisorStop(dir);await deadline(requestControl(dir,'stop'),2500,'STOP_CONTROL_TIMEOUT');
 assert.equal((await deadline(supervisor.exit,20000,'SUPERVISOR_STOP_FAILED')).code,0);
 complete=true;checkpoint('accepted');
 console.log('Real packaged upgrade accepted: 9000.0.1 → 9000.0.2; failed 9000.0.3 rolls back; retained bootstrap/previous; aliased frontend; clean stop; no service installed.');
}finally{
 try{await cleanup()}finally{process.removeListener('SIGINT',onInterrupt);process.removeListener('SIGTERM',onTerminate)}
}
