import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {absentServiceManager} from './service-manager-fixture.ts';

async function fixture(home:string){
 const manager=await absentServiceManager(home);
 assert.equal(new URL(manager.preload).protocol,'file:');
 const cli=(args:string[])=>new Promise<{code:number|null;out:string;error:string}>((resolve,reject)=>{
  const child=spawn(process.execPath,['--import','tsx','--import',manager.preload,'src/cli.ts',...args],{cwd:new URL('..',import.meta.url),env:{...process.env,HOME:home,USERPROFILE:home,LOCALAPPDATA:home,XDG_CONFIG_HOME:join(home,'config'),XDG_STATE_HOME:join(home,'statebase'),PASEO_HOME:join(home,'paseo'),PASEO_PASSWORD:'',MOREMOTE_CLI_HOME:join(home,'state')},stdio:['ignore','pipe','pipe'],timeout:15000,killSignal:'SIGKILL'});
  let out='',error='';child.stdout.on('data',chunk=>{out+=chunk});child.stderr.on('data',chunk=>{error+=chunk});
  child.once('error',reject);child.once('close',code=>resolve({code,out,error}));
 });
 return {cli,verify:manager.verify};
}

test('actual CLI configuration and diagnostics remain independent and redact target credentials',async()=>{
 const home=await mkdtemp(join(tmpdir(),'moremote-cli-'));
 try{
  const f=await fixture(home),result=await f.cli(['configure','--target','tcp://127.0.0.1:6767?password=synthetic-secret']);assert.equal(result.code,0,result.error);
  const saved=JSON.parse(await readFile(join(home,'state','config.json'),'utf8'));assert.equal(saved.cloudEnabled,false);
  const check=await f.cli(['check']);assert.equal(check.code,0,check.error);
  const status=await f.cli(['status']);assert.equal(status.code,0,status.error);assert.doesNotMatch(status.out,/synthetic-secret|paseoHome|rootKey|hostToken/);
  assert.equal(JSON.parse(status.out).runtime,null);assert.deepEqual(JSON.parse(status.out).service,{owned:false,registration:'absent'});
  await f.verify();
 }finally{await rm(home,{recursive:true,force:true})}
});

test('actual lifecycle commands preserve official-like foreign data and demand explicit registration/update consent',async()=>{
 const home=await mkdtemp(join(tmpdir(),'moremote-cli-own-'));
 try{
  const f=await fixture(home),foreign=join(home,'official');await mkdir(foreign);await writeFile(join(foreign,'paseo.pid'),'synthetic-official-state');
  const denied=await f.cli(['uninstall','--yes','--purge','--data-dir',foreign]);assert.notEqual(denied.code,0);assert.equal(await readFile(join(foreign,'paseo.pid'),'utf8'),'synthetic-official-state');
  for(const args of [['service-install'],['update','--version','0.1.0']]){
   const result=await f.cli(args);assert.notEqual(result.code,0);assert.match(result.error,/EXPLICIT_YES_REQUIRED|EXACT_VERSION_AND_YES_REQUIRED/);
  }
  for(const args of [['configure','--target','127.0.0.1:6767'],['cloud-disable'],['stop'],['uninstall','--yes']]){
   const result=await f.cli(args);assert.equal(result.code,0,result.error);
  }
  assert.equal(JSON.parse(await readFile(join(home,'state','config.json'),'utf8')).cloudEnabled,false);
  const purged=await f.cli(['uninstall','--yes','--purge']);assert.equal(purged.code,0,purged.error);
  await assert.rejects(readFile(join(home,'state','config.json'),'utf8'));assert.equal(await readFile(join(foreign,'paseo.pid'),'utf8'),'synthetic-official-state');
  await f.verify();
 }finally{await rm(home,{recursive:true,force:true})}
});
