import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp,mkdir,writeFile,readFile,chmod,rm,symlink,lstat } from 'node:fs/promises';
import { join,dirname,relative } from 'node:path';
import { tmpdir } from 'node:os';
import { installService,managedEntry,removeService,serviceDefinition,serviceStatus,stopService,updatePackage } from '../src/service.ts';
import type { ServiceDefinition } from '../src/service.ts';
import { assertTaskResource } from '../src/resources.ts';

const platforms=['darwin','linux','win32'];
const executableFixtures={skip:process.platform==='win32'?'POSIX executable manager fixtures; Windows task adapter is exercised on POSIX without native registration':false};
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'moremote-cli-service-'));
 const bin=join(dir,'tools'),home=join(dir,'home'),data=join(dir,'data'),state=join(dir,'manager.json'),log=join(dir,'commands.jsonl');
 await Promise.all([mkdir(bin),mkdir(home),mkdir(data,{mode:0o700})]);
 const saved={PATH:process.env.PATH,XDG_CONFIG_HOME:process.env.XDG_CONFIG_HOME,npm_execpath:process.env.npm_execpath,SERVICE_FIXTURE:process.env.SERVICE_FIXTURE,SERVICE_LOG:process.env.SERVICE_LOG};
 process.env.PATH=bin;process.env.XDG_CONFIG_HOME=join(home,'.config');process.env.SERVICE_FIXTURE=state;process.env.SERVICE_LOG=log;
 const script=`#!${process.execPath}
const fs=require('node:fs');const path=require('node:path');
const args=process.argv.slice(2),program=path.basename(process.argv[1]);
fs.appendFileSync(process.env.SERVICE_LOG,JSON.stringify({program,args})+'\\n');
const state=JSON.parse(fs.readFileSync(process.env.SERVICE_FIXTURE,'utf8'));
if(state.error){console.error('manager unreachable');process.exit(1)}
if(program==='launchctl'&&args[0]==='print'){
 if(!state.registered){console.error('Could not find service "com.moremote.cli" in domain for user gui');process.exit(113)}
 console.log('gui/501/com.moremote.cli = {\\n path = '+state.path+'\\n}');
}else if(program==='systemctl'&&args.includes('show')){
 console.log('LoadState='+(state.registered?'loaded':'not-found')+'\\nActiveState='+(state.active?'active':'inactive')+'\\nFragmentPath='+(state.registered?state.path:''));
}else if(program==='powershell.exe'){
 if(!state.registered)process.exit(3);
 console.log(state.content);
}else{
 if(args.includes('bootstrap')||args.includes('enable')||args.includes('/Create')){state.registered=true;state.active=true}
 if(args.includes('bootout'))state.registered=false;
 if(args.includes('stop')||args.includes('/End'))state.active=false;
 if(args.includes('disable')||args.includes('/Delete'))state.registered=false;
 fs.writeFileSync(process.env.SERVICE_FIXTURE,JSON.stringify(state));
}
`;
 for(const program of ['launchctl','systemctl','powershell.exe','schtasks']){const file=join(bin,program);await writeFile(file,script);await chmod(file,0o700)}
 const entry=join(dir,'moremote-cli.js');await writeFile(entry,'console.log("synthetic CLI");\n');
 async function select(platform:string,registered=false,options:{error?:boolean;path?:string;content?:string}={}){
  const def=serviceDefinition(platform,home,process.execPath,entry,data);
  await writeFile(state,JSON.stringify({registered,active:registered,path:options.path??def.path,content:options.content??def.content,error:options.error??false}));
  return def;
 }
 async function commands(){try{return (await readFile(log,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))}catch(error){if(error instanceof Error&&'code' in error&&error.code==='ENOENT')return [];throw error}}
 async function close(){for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value}await rm(dir,{recursive:true,force:true})}
 return {dir,bin,home,data,state,entry,select,commands,close};
}
async function writeDefinition(def:ServiceDefinition){await mkdir(dirname(def.path),{recursive:true});await writeFile(def.path,def.content,{encoding:def.platform==='win32'?'utf16le':'utf8',mode:0o600})}

test('manager failure is unknown and stop/remove cannot claim success',executableFixtures,async()=>{
 const f=await fixture();try{for(const platform of platforms){
  const def=await f.select(platform,true,{error:true});await writeDefinition(def);
  const status=await serviceStatus(def);assert.equal(status.owned,true);assert.equal(status.registration,'unknown');
  await assert.rejects(stopService(def),/SERVICE_MANAGER_UNKNOWN/);await assert.rejects(removeService(def),/SERVICE_MANAGER_UNKNOWN/);
  assert.equal(await readFile(def.path,def.platform==='win32'?'utf16le':'utf8'),def.content);
 }
 // A missing executable is also unknown, not a confirmed absent registration.
 const def=await f.select('darwin');await rm(join(f.bin,'launchctl'));
 assert.equal((await serviceStatus(def)).registration,'unknown');await assert.rejects(stopService(def),/SERVICE_MANAGER_UNKNOWN/);
 }finally{await f.close()}
});

test('loaded registrations are inspected even when their local file is missing',executableFixtures,async()=>{
 const f=await fixture();try{for(const platform of platforms){
  const def=await f.select(platform,true);
  const status=await serviceStatus(def);assert.equal(status.owned,false);assert.equal(status.registration,'registered');
  await assert.rejects(stopService(def),/FOREIGN_SERVICE_REGISTRATION/);await assert.rejects(removeService(def),/FOREIGN_SERVICE_REGISTRATION/);
 }
 assert.equal((await f.commands()).filter(c=>c.args.includes('bootout')||c.args.includes('/End')||c.args.includes('stop')||c.args.includes('/Delete')).length,0);
 }finally{await f.close()}
});

test('confirmed absence differs from unavailable manager and native lifecycle uses argument arrays',executableFixtures,async()=>{
 const f=await fixture();try{for(const platform of platforms){
  const def=await f.select(platform);assert.deepEqual(await serviceStatus(def),{owned:false,registration:'absent'});
  await installService(def);assert.equal((await serviceStatus(def)).registration,'registered');
  if(platform==='win32'){
   const bytes=await readFile(def.path);
   assert.deepEqual(bytes.subarray(0,2),Buffer.from([0xff,0xfe]),'The native XML file must declare its UTF-16LE byte order.');
   assert.equal(bytes.toString('utf16le'),'\uFEFF'+def.content);
   assertTaskResource(f.data,'win32');
  }
  await stopService(def);await removeService(def);await assert.rejects(lstat(def.path),{code:'ENOENT'});
 }
 const calls=await f.commands();assert.ok(calls.some(c=>c.program==='launchctl'&&c.args[0]==='bootstrap'));
 assert.ok(calls.some(c=>c.program==='systemctl'&&JSON.stringify(c.args)===JSON.stringify(['--user','enable','--now','moremote-cli.service'])));
 assert.ok(calls.some(c=>c.program==='schtasks'&&c.args.includes('/XML')&&c.args.includes('/Create')));
 }finally{await f.close()}
});

test('foreign manager registration cannot be stopped, removed or overwritten',executableFixtures,async()=>{
 const f=await fixture();try{for(const platform of platforms){
  const def=await f.select(platform,true,{path:join(f.dir,'foreign.service'),content:'<Task><RegistrationInfo><Description>foreign</Description></RegistrationInfo></Task>'});await writeDefinition(def);
  await assert.rejects(stopService(def),/FOREIGN_SERVICE_REGISTRATION/);await assert.rejects(removeService(def),/FOREIGN_SERVICE_REGISTRATION/);await assert.rejects(installService(def),/FOREIGN_SERVICE_REGISTRATION/);
  assert.equal(await readFile(def.path,def.platform==='win32'?'utf16le':'utf8'),def.content);
 }
 }finally{await f.close()}
});

test('canonical parent aliases retain exact owned native service management',executableFixtures,async()=>{
 const f=await fixture();try{for(const platform of ['darwin','linux']){
  const alias=join(f.dir,'home-alias-'+platform);await symlink(f.home,alias,'dir');
  const original=await f.select(platform);
  const reported=join(alias,relative(f.home,original.path));
  const def=await f.select(platform,true,{path:reported});await writeDefinition(def);
  assert.deepEqual(await serviceStatus(def),{owned:true,registration:'registered'});
  await stopService(def);await removeService(def);await assert.rejects(lstat(def.path),{code:'ENOENT'});
 }}finally{await f.close()}
});

test('a manager-reported leaf symlink never grants native service authority',executableFixtures,async()=>{
 const f=await fixture();try{for(const platform of ['darwin','linux']){
  const def=await f.select(platform);await writeDefinition(def);
  const alias=join(f.dir,'leaf-'+platform);await symlink(def.path,alias);
  await f.select(platform,true,{path:alias});
  await assert.rejects(stopService(def),/FOREIGN_SERVICE_REGISTRATION/);
  await assert.rejects(removeService(def),/FOREIGN_SERVICE_REGISTRATION/);
  assert.equal(await readFile(def.path,'utf8'),def.content);
 }
 assert.equal((await f.commands()).filter(c=>c.args.includes('bootout')||c.args.includes('stop')||c.args.includes('disable')).length,0);
 }finally{await f.close()}
});

test('service replacement changes only an existing owned file and rejects foreign collisions',executableFixtures,async()=>{
 const f=await fixture();try{for(const platform of platforms){
  const def=await f.select(platform);
  await mkdir(dirname(def.path),{recursive:true});await writeFile(def.path,'foreign file');
  await assert.rejects(installService(def),/FOREIGN_SERVICE_FILE/);assert.equal(await readFile(def.path,'utf8'),'foreign file');
  await rm(def.path);await writeDefinition(def);const before=await lstat(def.path);
  await installService(def);
  assert.equal(await readFile(def.path,platform==='win32'?'utf16le':'utf8'),(platform==='win32'?'\uFEFF':'')+def.content);
  const after=await lstat(def.path);assert.notEqual(after.ino,before.ino);assert.equal(after.isSymbolicLink(),false);
  if(process.platform!=='win32')assert.equal(after.mode&0o777,0o600);
 }}finally{await f.close()}
});

test('service installation rejects existing and dangling symlinks without external writes',executableFixtures,async()=>{
 const f=await fixture();try{for(const platform of platforms){for(const dangling of [false,true]){
  const def=await f.select(platform);const outside=join(f.dir,'outside-'+platform+'-'+dangling);await mkdir(dirname(def.path),{recursive:true});
  if(!dangling)await writeFile(outside,def.content,{encoding:platform==='win32'?'utf16le':'utf8'});
  await symlink(outside,def.path);await assert.rejects(installService(def),/FOREIGN_SERVICE_FILE/);
  assert.equal((await lstat(def.path)).isSymbolicLink(),true);
  if(dangling)await assert.rejects(lstat(outside),{code:'ENOENT'});else assert.equal(await readFile(outside,platform==='win32'?'utf16le':'utf8'),def.content);
  await rm(def.path);
 }} }finally{await f.close()}
});

test('managed updates preserve selected bytes and path across failure and a new verified version',async()=>{
 const f=await fixture();try{
 const npm=join(f.dir,'npm-cli.js');process.env.npm_execpath=npm;
 await writeFile(npm,`const fs=require('node:fs'),path=require('node:path');const args=process.argv.slice(2),prefix=args[args.indexOf('--prefix')+1],version=args.at(-1).split('@').at(-1),root=path.join(prefix,'node_modules','@moxuli','moremote');fs.mkdirSync(path.join(root,'bin'),{recursive:true});fs.mkdirSync(path.join(root,'dist'));fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'@moxuli/moremote',version:version==='2.0.0'?'0.0.0':version}));fs.writeFileSync(path.join(root,'bin','moremote-cli.js'),'installed '+version);fs.writeFileSync(path.join(root,'dist','cli.js'),'build '+version);if(version==='3.0.0')process.exit(1);`);
 const first=await updatePackage(f.data,'1.0.0');assert.equal(first,await managedEntry(f.data,'1.0.0'));
 const original=await readFile(first);const definition=serviceDefinition('darwin',f.home,process.execPath,first,f.data);await writeDefinition(definition);const registration=await readFile(definition.path);
 const installedFiles=[join(dirname(dirname(first)),'package.json'),join(dirname(dirname(first)),'dist','cli.js')];
 const installedBytes=await Promise.all(installedFiles.map(path=>readFile(path)));
 await assert.rejects(updatePackage(f.data,'2.0.0'),/UPDATE_IDENTITY_MISMATCH/);await assert.rejects(updatePackage(f.data,'3.0.0'));
 const next=await updatePackage(f.data,'4.0.0');assert.notEqual(first,next);assert.deepEqual(await readFile(first),original);assert.deepEqual(await readFile(definition.path),registration);
 assert.equal(await updatePackage(f.data,'1.0.0'),first);assert.deepEqual(await readFile(first),original);assert.equal(await readFile(next,'utf8'),'installed 4.0.0');
 assert.deepEqual(await Promise.all(installedFiles.map(path=>readFile(path))),installedBytes);
 await assert.rejects(managedEntry(f.data,'2.0.0'));await assert.rejects(managedEntry(f.data,'3.0.0'));await assert.rejects(updatePackage(f.data,'../1.0.0'),/EXACT_VERSION_REQUIRED/);
 }finally{await f.close()}
});

test('default subprocess capture does not leak npm or manager output before sanitized errors',()=>{
 const serviceURL=new URL('../src/service.ts',import.meta.url).href;
 for(const childSource of [
  "process.stdout.write('/synthetic/private/user/npm-path');process.stderr.write('/synthetic/private/user/service-path');process.exitCode=1;",
  "process.stdout.write('/synthetic/private/'.repeat(5000));process.exitCode=1;"
 ]){
  const runner=`import {command} from ${JSON.stringify(serviceURL)};try{await command(process.execPath,['-e',${JSON.stringify(childSource)}]);process.exitCode=2}catch{console.error('SANITIZED_FAILURE');process.exitCode=1}`;
  const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',runner],{cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:10000});
  assert.equal(result.error,undefined);assert.equal(result.status,1);
  assert.doesNotMatch(result.stdout+result.stderr,/\/synthetic\/private\//,'Captured child paths must never reach the caller output.');
 }
});
