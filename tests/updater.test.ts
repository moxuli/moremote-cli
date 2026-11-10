import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,symlink,chmod,access} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as sleep} from 'node:timers/promises';
import {privateDirectory,privateManagedDirectory} from '../src/config.ts';
import {updatePackage,managedEntry} from '../src/service.ts';
import {checkForUpdate,queueUpdate,setAutoUpdate} from '../src/updater.ts';
import {CHECK_INTERVAL,initialUpdateState,readUpdateState,writeUpdateState,updateLock,requestSupervisorStop,supervisorRunning} from '../src/update-state.ts';
import {runSupervisor} from '../src/supervisor.ts';
async function until(predicate:()=>boolean|Promise<boolean>,message:string,ms=8000){const end=Date.now()+ms;while(Date.now()<end){if(await predicate())return;await sleep(20)}throw Error(message)}
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'moremote-update-')),dir=join(root,'state'),log=join(root,'runtime.jsonl'),npm=join(root,'npm-cli.js');
 await privateDirectory(dir);await privateManagedDirectory(join(dir,'managed'));await privateManagedDirectory(join(dir,'managed','versions'));
 const saved=process.env.npm_execpath;process.env.npm_execpath=npm;
 // These are platform/process integration tests: parent fake timers cannot
 // complete an independent child process's delayed write or IPC lifecycle.
 // Real installed process fixtures perform a delayed write on drain. Production
 // supervisor must await that process exit, not just its IPC acknowledgement.
 const runtime=`import fs from 'node:fs';const log=${JSON.stringify(log)};const version=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url))).version;function event(kind){fs.appendFileSync(log,JSON.stringify({kind,version,pid:process.pid})+'\\n')}event('start');if(version==='2.0.0'){process.exit(1)}process.send?.({kind:'moremote-ready'});let draining=false;process.on('message',m=>{if(m.kind==='moremote-drain'&&!draining){draining=true;event('drain');setTimeout(()=>{event('commit');process.exit(0)},150)}});`;
 await writeFile(npm,`const fs=require('node:fs'),path=require('node:path');const args=process.argv.slice(2),prefix=args[args.indexOf('--prefix')+1],version=args.at(-1).split('@').at(-1);if(version==='9.0.0')process.exit(1);if(version==='7.0.0'){setTimeout(install,150)}else install();function install(){const root=path.join(prefix,'node_modules','@moxuli','moremote');fs.mkdirSync(path.join(root,'bin'),{recursive:true});fs.mkdirSync(path.join(root,'dist'));fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:version==='8.0.0'?'foreign':'@moxuli/moremote',version,type:'module',moremote:{updateProtocol:1,journalSchema:version==='6.0.0'?2:1,wireProtocol:1}}));fs.writeFileSync(path.join(root,'bin','moremote-cli.js'),${JSON.stringify(runtime)});fs.writeFileSync(path.join(root,'dist','cli.js'),'export {};')}`);
 await updatePackage(dir,'1.0.0');const state=initialUpdateState('1.0.0');state.lastCheck=Date.now();writeUpdateState(dir,state);
 async function events(){try{return (await readFile(log,'utf8')).trim().split('\n').filter(Boolean).map(s=>JSON.parse(s) as {kind:string;version:string;pid:number})}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error}}
 async function close(){if(saved===undefined)delete process.env.npm_execpath;else process.env.npm_execpath=saved;await rm(root,{recursive:true,force:true})}
 return {root,dir,events,close};
}
const timing={pollMs:20,startupGraceMs:200,startupDeadlineMs:1500};

test('writer contention cannot install or alter selection and failed/foreign installs preserve last known good',async()=>{
 const f=await fixture();try{
  const before=await readFile(await managedEntry(f.dir,'1.0.0'));
  const gate=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>();
  const owner=updateLock(f.dir,async()=>{entered.resolve();await gate.promise});await entered.promise;
  try{await assert.rejects(updatePackage(f.dir,'7.0.0'),/UPDATE_BUSY/)}finally{gate.resolve();await owner}
  for(const version of ['8.0.0','9.0.0'])await assert.rejects(queueUpdate(f.dir,version));
  for(const version of ['../2.0.0','01.0.0','1.0.0-01','latest','@other/thing'])await assert.rejects(queueUpdate(f.dir,version),/EXACT_VERSION_REQUIRED/);
  assert.equal(readUpdateState(f.dir)?.active,'1.0.0');assert.equal(readUpdateState(f.dir)?.pending,undefined);assert.deepEqual(await readFile(await managedEntry(f.dir,'1.0.0')),before);
  await assert.rejects(managedEntry(f.dir,'8.0.0'));await assert.rejects(managedEntry(f.dir,'9.0.0'));
 }finally{await f.close()}
});

test('opt-out makes zero registry calls; errors are persisted once per six hours and invalid registry identity never installs',async()=>{
 const f=await fixture();let calls=0;const registry=(async()=>{calls++;return new Response('',{status:404})}) as typeof fetch;
 try{
  const initial=readUpdateState(f.dir)!;delete initial.lastCheck;writeUpdateState(f.dir,initial);await setAutoUpdate(f.dir,false);
  const start=100000000;await checkForUpdate(f.dir,registry,start);assert.equal(calls,0);
  await setAutoUpdate(f.dir,true);await checkForUpdate(f.dir,registry,start);assert.equal(calls,1);assert.equal(readUpdateState(f.dir)?.error,'UPDATE_REGISTRY_UNAVAILABLE');
  await checkForUpdate(f.dir,registry,start+CHECK_INTERVAL-1);assert.equal(calls,1);
  const bad=(async()=>{calls++;return Response.json({name:'foreign',version:'7.0.0'})}) as typeof fetch;
  await checkForUpdate(f.dir,bad,start+CHECK_INTERVAL);assert.equal(calls,2);assert.equal(readUpdateState(f.dir)?.error,'UPDATE_IDENTITY_MISMATCH');assert.equal(readUpdateState(f.dir)?.pending,undefined);
  const good=(async()=>Response.json({name:'@moxuli/moremote',version:'3.0.0'})) as typeof fetch;
  await checkForUpdate(f.dir,good,start+2*CHECK_INTERVAL);assert.equal(readUpdateState(f.dir)?.pending,'3.0.0');
  await setAutoUpdate(f.dir,false);assert.equal(readUpdateState(f.dir)?.pending,undefined);assert.equal(readUpdateState(f.dir)?.enabled,false);
 }finally{await f.close()}
});

test('real supervisor waits for delayed commit/exit before starting candidate and retains previous executable', {timeout:10000},async()=>{
 const f=await fixture();let supervisor:Promise<number>|undefined;
 try{
  await queueUpdate(f.dir,'3.0.0');supervisor=runSupervisor(f.dir,timing);
  await until(()=>readUpdateState(f.dir)?.active==='3.0.0','CANDIDATE_NEVER_ACTIVATED');
  const events=await f.events();const commit=events.findIndex(e=>e.kind==='commit'&&e.version==='1.0.0'),start=events.findIndex(e=>e.kind==='start'&&e.version==='3.0.0');assert.ok(commit>=0&&start>commit,'new runtime must not overlap an unfinished old write');
  assert.equal(readUpdateState(f.dir)?.previous,'1.0.0');assert.equal(readUpdateState(f.dir)?.pending,undefined);await managedEntry(f.dir,'1.0.0');
  await assert.rejects(runSupervisor(f.dir,timing),/UPDATE_BUSY/);
  requestSupervisorStop(f.dir);await supervisor;supervisor=undefined;assert.equal(supervisorRunning(f.dir),false);
  const final=await f.events();assert.equal(final.filter(e=>e.kind==='start'&&e.version==='3.0.0').length,1,'explicit stop must not respawn runtime');
 }finally{if(supervisor){requestSupervisorStop(f.dir);await supervisor}await f.close()}
});

test('failed candidate really restarts last good process; it is not retried automatically', {timeout:10000},async()=>{
 const f=await fixture();let supervisor:Promise<number>|undefined;
 try{
  await queueUpdate(f.dir,'2.0.0');supervisor=runSupervisor(f.dir,timing);
  await until(()=>readUpdateState(f.dir)?.failed==='2.0.0','FAILED_START_NOT_ROLLED_BACK');
  await until(async()=>(await f.events()).filter(e=>e.kind==='start'&&e.version==='1.0.0').length===2,'OLD_PROCESS_NOT_RESTARTED');
  const state=readUpdateState(f.dir)!;assert.equal(state.active,'1.0.0');assert.equal(state.error,'UPDATE_START_FAILED');assert.equal(state.pending,undefined);
  requestSupervisorStop(f.dir);await supervisor;supervisor=undefined;
  await setAutoUpdate(f.dir,true);await updateLock(f.dir,async()=>{const s=readUpdateState(f.dir)!;delete s.lastCheck;delete s.nextCheck;writeUpdateState(f.dir,s)});
  let calls=0;await checkForUpdate(f.dir,(async()=>{calls++;return Response.json({name:'@moxuli/moremote',version:'2.0.0'})}) as typeof fetch);assert.equal(calls,1);assert.equal(readUpdateState(f.dir)?.pending,undefined);
  assert.equal((await f.events()).filter(e=>e.version==='2.0.0'&&e.kind==='start').length,1);
 }finally{if(supervisor){requestSupervisorStop(f.dir);await supervisor}await f.close()}
});

test('crash during activation recovers old selection without starting uncertain candidate', {timeout:10000},async()=>{
 const f=await fixture();let supervisor:Promise<number>|undefined;
 try{
  await queueUpdate(f.dir,'3.0.0');const state=readUpdateState(f.dir)!;state.activating='3.0.0';writeUpdateState(f.dir,state);supervisor=runSupervisor(f.dir,timing);
  await until(()=>readUpdateState(f.dir)?.error==='UPDATE_INTERRUPTED','INTERRUPTED_ACTIVATION_NOT_RECOVERED');
  await until(async()=>(await f.events()).length>0,'OLD_VERSION_NOT_STARTED');assert.equal((await f.events()).some(e=>e.version==='3.0.0'),false);assert.equal(readUpdateState(f.dir)?.active,'1.0.0');
 }finally{if(supervisor){requestSupervisorStop(f.dir);await supervisor}await f.close()}
});

test('foreign update-state symlinks are not adopted',async()=>{
 const f=await fixture();try{
  const path=join(f.dir,'managed','update.json'),outside=join(f.root,'foreign.json');await writeFile(outside,'foreign');await rm(path);await symlink(outside,path);
  assert.throws(()=>readUpdateState(f.dir));assert.equal(await readFile(outside,'utf8'),'foreign');
 }finally{await f.close()}
});

test('Retry-After preserves one original next-check deadline across reconstructed state',async()=>{
 const f=await fixture();try{
  let calls=0;const now=Date.now()+CHECK_INTERVAL,registry=(async()=>{calls++;return new Response('',{status:429,headers:{'Retry-After':'86400'}})}) as typeof fetch;
  await checkForUpdate(f.dir,registry,now);const deadline=readUpdateState(f.dir)?.nextCheck;assert.equal(deadline,now+86400000);
  await checkForUpdate(f.dir,registry,now+CHECK_INTERVAL);assert.equal(calls,1);assert.equal(readUpdateState(f.dir)?.nextCheck,deadline);
 }finally{await f.close()}
});

test('disable during metadata/staging wins over the writer and prevents candidate activation',{timeout:10000},async()=>{
 const f=await fixture();let supervisor:Promise<number>|undefined;
 try{
  const entered=Promise.withResolvers<void>(),response=Promise.withResolvers<Response>();
  const check=checkForUpdate(f.dir,(async()=>{entered.resolve();return response.promise}) as typeof fetch,Date.now()+CHECK_INTERVAL);
  await entered.promise;assert.equal((await setAutoUpdate(f.dir,false)).enabled,false);response.resolve(Response.json({name:'@moxuli/moremote',version:'3.0.0'}));await check;
  assert.equal(readUpdateState(f.dir)?.enabled,false);supervisor=runSupervisor(f.dir,timing);
  await until(async()=>(await f.events()).some(e=>e.version==='1.0.0'&&e.kind==='start'),'OLD_RUNTIME_NOT_STARTED');
  assert.equal((await f.events()).some(e=>e.version==='3.0.0'),false);
 }finally{if(supervisor){requestSupervisorStop(f.dir);await supervisor}await f.close()}
});

test('disable during drain lets the write settle and resumes old version without starting candidate',{timeout:10000},async()=>{
 const f=await fixture();let supervisor:Promise<number>|undefined;
 try{
  await queueUpdate(f.dir,'3.0.0');supervisor=runSupervisor(f.dir,timing);
  await until(async()=>(await f.events()).some(e=>e.kind==='drain'),'OLD_DRAIN_NOT_REACHED');
  await setAutoUpdate(f.dir,false);
  await until(async()=>(await f.events()).filter(e=>e.kind==='start'&&e.version==='1.0.0').length===2,'OLD_RUNTIME_NOT_RESUMED_AFTER_OPTOUT');
  assert.equal((await f.events()).some(e=>e.version==='3.0.0'),false);assert.equal(readUpdateState(f.dir)?.active,'1.0.0');assert.equal(readUpdateState(f.dir)?.activating,undefined);
 }finally{if(supervisor){requestSupervisorStop(f.dir);await supervisor}await f.close()}
});

test('incompatible journal schema stays pending/manual and is never launched or allowed to drain old runtime',{timeout:10000},async()=>{
 const f=await fixture();let supervisor:Promise<number>|undefined;
 try{
  await queueUpdate(f.dir,'6.0.0');assert.equal(readUpdateState(f.dir)?.manualRequired,'6.0.0');supervisor=runSupervisor(f.dir,timing);
  await until(async()=>(await f.events()).length>0,'OLD_RUNTIME_NOT_STARTED');
  const events=await f.events();assert.equal(events.some(e=>e.version==='6.0.0'),false);assert.equal(events.some(e=>e.kind==='drain'),false);assert.equal(readUpdateState(f.dir)?.active,'1.0.0');
 }finally{if(supervisor){requestSupervisorStop(f.dir);await supervisor}await f.close()}
});

test('readonly managed ownership fails explicitly rather than overwriting outside files',{skip:process.platform==='win32'?'Windows uses user-profile ACLs':false},async()=>{
 const f=await fixture();const managed=join(f.dir,'managed');try{await chmod(managed,0o500);await assert.rejects(updatePackage(f.dir,'3.0.0'));}finally{await chmod(managed,0o700);await f.close()}
});

test('explicit stop during an update drain settles the write without launching candidate or respawning old runtime',{timeout:10000},async()=>{
 const f=await fixture();let supervisor:Promise<number>|undefined;
 try{
  await queueUpdate(f.dir,'3.0.0');supervisor=runSupervisor(f.dir,timing);
  await until(async()=>(await f.events()).some(e=>e.kind==='drain'),'UPDATE_DRAIN_NOT_REACHED');
  requestSupervisorStop(f.dir);assert.equal(await supervisor,0);supervisor=undefined;
  const events=await f.events();assert.equal(events.filter(e=>e.kind==='start').length,1);assert.equal(events.filter(e=>e.kind==='commit').length,1);
  assert.equal(readUpdateState(f.dir)?.active,'1.0.0');assert.equal(readUpdateState(f.dir)?.activating,undefined);assert.equal(supervisorRunning(f.dir),false);
 }finally{if(supervisor){requestSupervisorStop(f.dir);await supervisor}await f.close()}
});

for(const [active,candidate,pending] of [
 ['1.2.3-beta.1','1.2.3',true],
 ['1.2.3-beta.1','1.2.4',true],
 ['1.2.3-beta.1','1.2.2',false],
 ['1.2.3','1.2.3',false],
 ['1.2.4','1.2.3',false]
] as const)test(`stable discovery ${candidate} respects semver precedence over active ${active}`,async()=>{
 const f=await fixture();try{
  await updatePackage(f.dir,active);const state=readUpdateState(f.dir)!;state.active=active;delete state.lastCheck;delete state.nextCheck;writeUpdateState(f.dir,state);
  await checkForUpdate(f.dir,(async()=>Response.json({name:'@moxuli/moremote',version:candidate})) as typeof fetch);
  assert.equal(readUpdateState(f.dir)?.pending,pending?candidate:undefined);assert.equal(readUpdateState(f.dir)?.active,active);
 }finally{await f.close()}
});

test('managed install pins npmjs scope even when real npm resolves an inherited hostile scoped registry',async()=>{
 const candidates=[process.env.npm_execpath,join(dirname(process.execPath),'node_modules','npm','bin','npm-cli.js'),join(dirname(process.execPath),'..','lib','node_modules','npm','bin','npm-cli.js')].filter((p):p is string=>!!p&&p.endsWith('npm-cli.js'));
 let realNpm:string|undefined;for(const path of candidates)try{await access(path);realNpm=path;break}catch{}
 assert.ok(realNpm,'Managed installation requires the real npm CLI');
 const f=await fixture(),saved=process.env.npm_config_userconfig;
 try{
  const rc=join(f.root,'hostile.npmrc');await writeFile(rc,'@moxuli:registry=http://127.0.0.1:1/hostile/\\n');process.env.npm_config_userconfig=rc;
  // Resolve effective precedence with the actual npm client, rather than
  // asserting argument spelling or making a registry/network request.
  await writeFile(join(f.root,'npm-cli.js'),`const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');const args=process.argv.slice(2),flags=args.filter(a=>a.startsWith('--registry=')||a.startsWith('--@moxuli:registry='));const registry=cp.execFileSync(process.execPath,[${JSON.stringify(realNpm)},'config','get','@moxuli:registry',...flags],{encoding:'utf8'}).trim();if(registry!=='https://registry.npmjs.org')throw Error('HOSTILE_SCOPE_SELECTED');const prefix=args[args.indexOf('--prefix')+1],version=args.at(-1).split('@').at(-1),root=path.join(prefix,'node_modules','@moxuli','moremote');fs.mkdirSync(path.join(root,'bin'),{recursive:true});fs.mkdirSync(path.join(root,'dist'));fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'@moxuli/moremote',version,registry}));fs.writeFileSync(path.join(root,'bin','moremote-cli.js'),'');fs.writeFileSync(path.join(root,'dist','cli.js'),'');`);
  const entry=await updatePackage(f.dir,'4.0.0');const manifest=JSON.parse(await readFile(join(dirname(dirname(entry)),'package.json'),'utf8'));
  assert.equal(manifest.registry,'https://registry.npmjs.org');assert.equal(readUpdateState(f.dir)?.active,'1.0.0');
 }finally{if(saved===undefined)delete process.env.npm_config_userconfig;else process.env.npm_config_userconfig=saved;await f.close()}
});
