import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

test('actual purge command refuses foreign task XML before contacting service managers',async()=>{
 const home=await mkdtemp(join(tmpdir(),'mrc-purge-resource-')),dir=join(home,'state');
 try {
  await mkdir(dir,{mode:0o700});
  await writeFile(join(dir,'.moremote-cli-owner'),'MoRemote CLI state v1\n',{mode:0o600});
  const task=join(dir,'moremote-cli-task.xml');await writeFile(task,'<Task>synthetic unrelated task</Task>',{mode:0o600});
  const bytes=await readFile(task),mode=(await stat(task)).mode;
  const {promise,resolve,reject}=Promise.withResolvers<number|null>();let error='';
  const child=spawn(process.execPath,['--import','tsx','src/cli.ts','uninstall','--yes','--purge','--data-dir',dir],{
   cwd:new URL('..',import.meta.url),env:{...process.env,HOME:home,USERPROFILE:home,LOCALAPPDATA:home,XDG_CONFIG_HOME:join(home,'config'),XDG_STATE_HOME:join(home,'statebase'),PASEO_HOME:join(home,'paseo'),PASEO_PASSWORD:'',MOREMOTE_CLI_HOME:dir},stdio:['ignore','pipe','pipe']
  });
  child.stdout.resume();child.stderr.on('data',chunk=>{error+=chunk;});child.once('error',reject);child.once('exit',resolve);
  assert.notEqual(await promise,0);assert.match(error,/FOREIGN_TASK_RESOURCE/);
  assert.deepEqual(await readFile(task),bytes);assert.equal((await stat(task)).mode,mode);
  assert.equal(await readFile(join(dir,'.moremote-cli-owner'),'utf8'),'MoRemote CLI state v1\n');
 } finally {await rm(home,{recursive:true,force:true});}
});
