import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile, stat, symlink, chmod, rename, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { ownRuntime, requestControl, controlEndpoint } from '../src/control.ts';
import { spawnSync } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { RUNTIME_OWNER } from '../src/resources.ts';
import { assertOwnedDirectory } from '../src/config.ts';

async function fixture() {
 const dir=await mkdtemp(join(tmpdir(),'mrc-ipc-'));
 await writeFile(join(dir,'.moremote-companion-owner'),'MoRemote Companion state v1\n',{mode:0o600});
 return dir;
}
async function absent(path:string) {await assert.rejects(lstat(path),{code:'ENOENT'});}

test('foreign socket regular file and symlink collisions survive startup and requests untouched',async()=>{
 if(process.platform==='win32')return;
 for(const kind of ['file','symlink']) {
  const dir=await fixture(),endpoint=controlEndpoint(dir),target=join(dir,'synthetic-target');
  try {
   await writeFile(target,'unrelated resource',{mode:0o640});
   if(kind==='file')await writeFile(endpoint,'foreign socket filename',{mode:0o600});else await symlink(target,endpoint);
   const before=await readFile(endpoint),mode=(await stat(endpoint)).mode;
   await assert.rejects(ownRuntime(dir,()=>({}),()=>{}),/RESOURCE|COLLISION/);
   await assert.rejects(requestControl(dir,'status'),/RESOURCE|COLLISION/);
   assert.deepEqual(await readFile(endpoint),before);assert.equal((await stat(endpoint)).mode,mode);await absent(join(dir,'runtime.lock'));await absent(join(dir,'runtime.json'));
  } finally {await rm(dir,{recursive:true,force:true});}
 }
});

test('unrelated live UNIX socket is not unlinked or adopted without an owned record',async()=>{
 if(process.platform==='win32')return;
 const dir=await fixture(),endpoint=controlEndpoint(dir),server=createServer();
 try {
  const listening=Promise.withResolvers<void>();server.once('error',listening.reject);server.listen(endpoint,listening.resolve);await listening.promise;await chmod(endpoint,0o600);const before=await lstat(endpoint);
  await assert.rejects(ownRuntime(dir,()=>({}),()=>{}),/COLLISION/);await assert.rejects(requestControl(dir,'status'),/COLLISION/);
  assert.equal((await lstat(endpoint)).ino,before.ino);await absent(join(dir,'runtime.lock'));
 } finally {const closed=Promise.withResolvers<void>();server.close(()=>closed.resolve());await closed.promise;await rm(dir,{recursive:true,force:true});}
});
test('unmarked or oversized runtime records cannot mutate lock or endpoint',async()=>{
 for(const content of [JSON.stringify({pid:process.pid}),JSON.stringify({owner:'MoRemote Companion runtime',version:1,pid:process.pid,token:'x'.repeat(5000)})]) {
  const dir=await fixture();
  try {
   const path=join(dir,'runtime.lock');await writeFile(path,content,{mode:0o600});const before=await readFile(path);
   await assert.rejects(ownRuntime(dir,()=>({}),()=>{}),/RUNTIME|RESOURCE/);await assert.rejects(requestControl(dir,'status'),/RUNTIME|RESOURCE/);assert.deepEqual(await readFile(path),before);await absent(join(dir,'runtime.json'));
  } finally {await rm(dir,{recursive:true,force:true});}
 }
});

test('owned IPC round trip and cleanup preserve replacement record, lock and socket',async()=>{
 const dir=await fixture();let dispose:(()=>Promise<void>)|undefined;
 try {
  dispose=await ownRuntime(dir,()=>({running:true}),()=>{});
  assert.deepEqual(await requestControl(dir,'status'),{ok:true,running:true});
  for(const name of ['runtime.json','runtime.lock']) {await rename(join(dir,name),join(dir,name+'.old'));await writeFile(join(dir,name),'foreign replacement',{mode:0o600});}
  if(process.platform!=='win32') {await rename(controlEndpoint(dir),join(dir,'saved.sock'));await writeFile(controlEndpoint(dir),'foreign replacement',{mode:0o600});}
  await dispose();dispose=undefined;
  assert.equal(await readFile(join(dir,'runtime.json'),'utf8'),'foreign replacement');assert.equal(await readFile(join(dir,'runtime.lock'),'utf8'),'foreign replacement');
  if(process.platform!=='win32')assert.equal(await readFile(controlEndpoint(dir),'utf8'),'foreign replacement');
 } finally {if(dispose)await dispose();await rm(dir,{recursive:true,force:true});}
});

test('stale owned socket is recovered only with matching marked lock and inode-bound record',async()=>{
 if(process.platform==='win32')return;
 const dir=await fixture(),endpoint=controlEndpoint(dir);let dispose:(()=>Promise<void>)|undefined;
 try {
  const owner={owner:RUNTIME_OWNER,version:1,instanceId:randomUUID(),startedAt:Date.now(),token:randomBytes(32).toString('base64url')};
  const child=spawnSync(process.execPath,['-e',`
   const net=require('node:net'),fs=require('node:fs'),path=require('node:path');
   const dir=process.argv[1],owner=JSON.parse(process.argv[2]);owner.pid=process.pid;
   net.createServer().listen(path.join(dir,'runtime.sock'),()=>{
    fs.chmodSync(path.join(dir,'runtime.sock'),0o600);
    const stat=fs.lstatSync(path.join(dir,'runtime.sock'));
    fs.writeFileSync(path.join(dir,'runtime.lock'),JSON.stringify(owner),{mode:0o600});
    fs.writeFileSync(path.join(dir,'runtime.json'),JSON.stringify({...owner,socket:{dev:stat.dev,ino:stat.ino}}),{mode:0o600});
    process.exit(0);
   });`,dir,JSON.stringify(owner)],{encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);assert.equal((await lstat(endpoint)).isSocket(),true);
  dispose=await ownRuntime(dir,()=>({running:true}),()=>{});
  assert.deepEqual(await requestControl(dir,'status'),{ok:true,running:true});
  assert.notEqual(JSON.parse(await readFile(join(dir,'runtime.json'),'utf8')).instanceId,owner.instanceId);
  const lock=await readFile(join(dir,'runtime.lock'));
  await assert.rejects(ownRuntime(dir,()=>({}),()=>{}),/ALREADY_RUNNING/);
  assert.deepEqual(await readFile(join(dir,'runtime.lock')),lock);
  await dispose();dispose=undefined;await absent(endpoint);assert.equal(await requestControl(dir,'status'),null);
 } finally {if(dispose)await dispose();await rm(dir,{recursive:true,force:true});}
});

test('cleanup does not remove in-place corrupted runtime ownership records',async()=>{
 const dir=await fixture();let dispose:(()=>Promise<void>)|undefined;
 try {
  dispose=await ownRuntime(dir,()=>({}),()=>{});
  for(const name of ['runtime.lock','runtime.json'])await writeFile(join(dir,name),'foreign in-place contents');
  await dispose();dispose=undefined;
  assert.equal(await readFile(join(dir,'runtime.lock'),'utf8'),'foreign in-place contents');
  assert.equal(await readFile(join(dir,'runtime.json'),'utf8'),'foreign in-place contents');
 } finally {if(dispose)await dispose();await rm(dir,{recursive:true,force:true});}
});

test('socket staging fits when the public endpoint is near the UNIX path limit',async(t)=>{
 if(process.platform==='win32')return;
 const base=await fixture();let dispose:(()=>Promise<void>)|undefined;
 try {
  const padding=100-Buffer.byteLength(join(base,'runtime.sock'))-1;
  if(padding<1) {t.skip('temporary base path already exceeds the portable UNIX endpoint bound');return;}
  const dir=join(base,'x'.repeat(padding));await mkdir(dir,{mode:0o700});
  await writeFile(join(dir,'.moremote-companion-owner'),'MoRemote Companion state v1\n',{mode:0o600});
  assert.equal(Buffer.byteLength(controlEndpoint(dir)),100);
  dispose=await ownRuntime(dir,()=>({running:true}),()=>{});
  assert.deepEqual(await requestControl(dir,'status'),{ok:true,running:true});
  await dispose();dispose=undefined;await absent(controlEndpoint(dir));
 } finally {if(dispose)await dispose();await rm(base,{recursive:true,force:true});}
});

test('cleanup refuses a foreign replacement at libuv staging pathname before closing',async()=>{
 if(process.platform==='win32')return;
 const dir=await fixture();let dispose:(()=>Promise<void>)|undefined;
 try {
  dispose=await ownRuntime(dir,()=>({running:true}),()=>{});
  const record=JSON.parse(await readFile(join(dir,'runtime.json'),'utf8'));
  const staging=join(dir,'s.'+record.instanceId.slice(0,8));await writeFile(staging,'foreign staging replacement',{mode:0o600});
  await assert.rejects(async()=>{if(dispose)await dispose();},/RESOURCE|COLLISION/);
  assert.equal(await readFile(staging,'utf8'),'foreign staging replacement');
  await assert.rejects(requestControl(dir,'status'),/RESOURCE|COLLISION|RUNTIME/);
  await rm(staging);await dispose();dispose=undefined;
 } finally {if(dispose)await dispose();await rm(dir,{recursive:true,force:true});}
});

test('read-only control discovery accepts an empty private directory but not an unmarked collision',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mrc-empty-'));
 try {
  assert.equal(await requestControl(dir,'status'),null);await absent(join(dir,'.moremote-companion-owner'));
  await writeFile(join(dir,'unrelated'),'foreign private file',{mode:0o600});
  await assert.rejects(requestControl(dir,'status'));
  assert.equal(await readFile(join(dir,'unrelated'),'utf8'),'foreign private file');
 } finally {await rm(dir,{recursive:true,force:true});}
});

test('shutdown discovery accepts an owned record and lock after the public socket disappears',async()=>{
 if(process.platform==='win32')return;
 const dir=await fixture();let dispose:(()=>Promise<void>)|undefined;
 try {
  dispose=await ownRuntime(dir,()=>({running:true}),()=>{});
  await rename(controlEndpoint(dir),join(dir,'synthetic-removed.sock'));
  assert.equal(await requestControl(dir,'status'),null);
  await dispose();dispose=undefined;
  await absent(join(dir,'runtime.json'));await absent(join(dir,'runtime.lock'));
 } finally {if(dispose)await dispose();await rm(dir,{recursive:true,force:true});}
});

test('inode-recorded staged socket survives crash recovery before and after private chmod',async()=>{
 if(process.platform==='win32')return;
 for(const secure of [false,true]) {
  const dir=await fixture();let dispose:(()=>Promise<void>)|undefined;
  try {
   const owner={owner:RUNTIME_OWNER,version:1,instanceId:randomUUID(),startedAt:Date.now(),token:randomBytes(32).toString('base64url')};
   const name='s.'+owner.instanceId.slice(0,8),path=join(dir,name);
   const child=spawnSync(process.execPath,['-e',`
    const net=require('node:net'),fs=require('node:fs'),path=require('node:path');
    const dir=process.argv[1],owner=JSON.parse(process.argv[2]);owner.pid=process.pid;
    const staged=path.join(dir,'s.'+owner.instanceId.slice(0,8));
    net.createServer().listen(staged,()=>{
     fs.chmodSync(staged,process.argv[3]==='true'?0o600:0o755);
     const stat=fs.lstatSync(staged);
     fs.writeFileSync(path.join(dir,'runtime.lock'),JSON.stringify({...owner,staging:{dev:stat.dev,ino:stat.ino}}),{mode:0o600});
     process.exit(0);
    });`,dir,JSON.stringify(owner),String(secure)],{encoding:'utf8'});
   assert.equal(child.status,0,child.stderr);
   dispose=await ownRuntime(dir,()=>({running:true}),()=>{});
   await absent(path);assert.deepEqual(await requestControl(dir,'status'),{ok:true,running:true});
   await dispose();dispose=undefined;await assertOwnedDirectory(dir);
  } finally {if(dispose)await dispose();await rm(dir,{recursive:true,force:true});}
 }
});

test('unrecorded or inode-mismatched staged socket is not adopted or chmodded during recovery',async()=>{
 if(process.platform==='win32')return;
 for(const recorded of [false,true]) {
  const dir=await fixture();
  try {
   const owner={owner:RUNTIME_OWNER,version:1,instanceId:randomUUID(),startedAt:Date.now(),token:randomBytes(32).toString('base64url')};
   const path=join(dir,'s.'+owner.instanceId.slice(0,8));
   const child=spawnSync(process.execPath,['-e',`
    const net=require('node:net'),fs=require('node:fs'),path=require('node:path');
    const dir=process.argv[1],owner=JSON.parse(process.argv[2]);owner.pid=process.pid;
    const staged=path.join(dir,'s.'+owner.instanceId.slice(0,8));
    net.createServer().listen(staged,()=>{
     fs.chmodSync(staged,0o755);const stat=fs.lstatSync(staged);
     if(process.argv[3]==='true')owner.staging={dev:stat.dev,ino:stat.ino+1};
     fs.writeFileSync(path.join(dir,'runtime.lock'),JSON.stringify(owner),{mode:0o600});process.exit(0);
    });`,dir,JSON.stringify(owner),String(recorded)],{encoding:'utf8'});
   assert.equal(child.status,0,child.stderr);const before=await lstat(path),lock=await readFile(join(dir,'runtime.lock'));
   await assert.rejects(ownRuntime(dir,()=>({}),()=>{}),/RUNTIME/);
   assert.equal((await lstat(path)).ino,before.ino);assert.equal((await lstat(path)).mode,before.mode);assert.deepEqual(await readFile(join(dir,'runtime.lock')),lock);
  } finally {await rm(dir,{recursive:true,force:true});}
 }
});
