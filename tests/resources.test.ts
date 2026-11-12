import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, chmod, stat, symlink, link, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { assertStateResource, assertStateRoot, assertTaskResource, JOURNAL_APPLICATION_ID, openOwnedJournal, validateJournalPath, writePrivateAtomic } from '../src/resources.ts';
import { serviceDefinition } from '../src/service.ts';
import { assertOwnedDirectory } from '../src/config.ts';

async function fixture() {
 const dir=await mkdtemp(join(tmpdir(),'mrc-resource-'));
 await writeFile(join(dir,'.moremote-cli-owner'),'MoRemote CLI state v1\n',{mode:0o600});
 return dir;
}

test('foreign SQLite identity is rejected without changing bytes, mode or sidecars',async()=>{
 const dir=await fixture(),path=join(dir,'journal.sqlite');
 try {
  const db=new DatabaseSync(path);db.exec('CREATE TABLE unrelated(secret TEXT); INSERT INTO unrelated VALUES (\'synthetic\')');db.close();await chmod(path,0o600);
  const before=await readFile(path),mode=(await stat(path)).mode,names=await readdir(dir);
  assert.throws(()=>validateJournalPath(path),/FOREIGN_JOURNAL/);
  assert.throws(()=>openOwnedJournal(path),/FOREIGN_JOURNAL/);
  assert.deepEqual(await readFile(path),before);assert.equal((await stat(path)).mode,mode);assert.deepEqual(await readdir(dir),names);
 } finally {await rm(dir,{recursive:true,force:true});}
});

test('symlink and hardlink journals cannot mutate their external SQLite target',async()=>{
 const dir=await fixture(),external=await mkdtemp(join(tmpdir(),'mrc-external-')),target=join(external,'unrelated.sqlite'),path=join(dir,'journal.sqlite');
 try {
  const db=new DatabaseSync(target);db.exec('CREATE TABLE unrelated(value TEXT)');db.close();await chmod(target,0o600);
  const before=await readFile(target),mode=(await stat(target)).mode;
  for(const make of [symlink,link]) {
   await make(target,path);assert.throws(()=>openOwnedJournal(path),/RESOURCE/);await rm(path);
   assert.deepEqual(await readFile(target),before);assert.equal((await stat(target)).mode,mode);
  }
 } finally {await rm(dir,{recursive:true,force:true});await rm(external,{recursive:true,force:true});}
});

test('new journal has explicit identity and existing owned journal is probed without writes',async()=>{
 const dir=await fixture(),path=join(dir,'journal.sqlite');
 try {
  assert.equal(validateJournalPath(path),null);
  const db=openOwnedJournal(path);assert.equal(db.prepare('PRAGMA application_id').get()?.application_id,JOURNAL_APPLICATION_ID);db.exec('CREATE TABLE synthetic(value TEXT)');db.close();
  const before=await readFile(path),mode=(await stat(path)).mode,names=await readdir(dir);
  assert.ok(validateJournalPath(path));assert.deepEqual(await readFile(path),before);assert.equal((await stat(path)).mode,mode);assert.deepEqual(await readdir(dir),names);
  const reopened=openOwnedJournal(path);reopened.close();
 } finally {await rm(dir,{recursive:true,force:true});}
});

test('root markers, resource kinds and private modes are enforced without chmod',async()=>{
 const dir=await fixture(),path=join(dir,'config.json');
 try {
  await assertStateRoot(dir);await writeFile(path,'{}',{mode:0o644});
  assert.throws(()=>assertStateResource(dir,'config.json'),process.platform==='win32'?/FOREIGN_CONFIG/:/RESOURCE/);if(process.platform!=='win32')assert.equal((await stat(path)).mode&0o777,0o644);
  await rm(path);await symlink(join(dir,'.moremote-cli-owner'),path);assert.throws(()=>assertStateResource(dir,'config.json'),/RESOURCE/);
  await rm(join(dir,'.moremote-cli-owner'));await symlink(path,join(dir,'.moremote-cli-owner'));assert.throws(()=>assertStateRoot(dir),/RESOURCE/);
 } finally {await rm(dir,{recursive:true,force:true});}
});

test('atomic JSON replacement refuses linked or foreign targets and leaves external bytes/mode unchanged',async()=>{
 const dir=await fixture(),external=await mkdtemp(join(tmpdir(),'mrc-json-')),target=join(external,'synthetic.json'),path=join(dir,'config.json');
 const value={version:1,clientId:'moremote-cli-synthetic'};
 try {
  await writeFile(target,JSON.stringify(value),{mode:0o600});const before=await readFile(target),mode=(await stat(target)).mode;
  for(const make of [symlink,link]) {
   await make(target,path);assert.throws(()=>writePrivateAtomic(path,value),/RESOURCE/);await rm(path);
   assert.deepEqual(await readFile(target),before);assert.equal((await stat(target)).mode,mode);
  }
  await writeFile(path,'{"version":1,"clientId":"unrelated"}',{mode:0o600});assert.throws(()=>writePrivateAtomic(path,value),/FOREIGN_CONFIG/);
  assert.equal(await readFile(path,'utf8'),'{"version":1,"clientId":"unrelated"}');await rm(path);
  writePrivateAtomic(path,value);assert.deepEqual(JSON.parse(await readFile(path,'utf8')),value);
  writePrivateAtomic(path,{...value,cloudEnabled:false});assert.equal(JSON.parse(await readFile(path,'utf8')).cloudEnabled,false);
 } finally {await rm(dir,{recursive:true,force:true});await rm(external,{recursive:true,force:true});}
});

test('temporary JSON names do not by themselves establish ownership',async()=>{
 const dir=await fixture();
 try {
  const name='config.json.11111111-1111-4111-8111-111111111111.tmp';
  await writeFile(join(dir,name),'unrelated private file',{mode:0o600});
  assert.throws(()=>assertStateResource(dir,name));
  assert.equal(await readFile(join(dir,name),'utf8'),'unrelated private file');
 } finally {await rm(dir,{recursive:true,force:true});}
});

test('foreign private task XML fails root purge ownership without changing bytes or mode',async()=>{
 const dir=await fixture(),path=join(dir,'moremote-cli-task.xml');
 try {
  await writeFile(path,'<Task>unrelated user task</Task>',{mode:0o600});
  const bytes=await readFile(path),mode=(await stat(path)).mode;
  assert.throws(()=>assertTaskResource(dir,'win32'),/FOREIGN/);
  await assert.rejects(assertOwnedDirectory(dir),/FOREIGN/);
  assert.deepEqual(await readFile(path),bytes);assert.equal((await stat(path)).mode,mode);
 } finally {await rm(dir,{recursive:true,force:true});}
});

test('Windows task XML requires UTF16LE exact CLI marker bound to its data directory',async()=>{
 const dir=await fixture(),other=await fixture(),path=join(dir,'moremote-cli-task.xml');
 try {
  const definition=serviceDefinition('win32','/synthetic/home','C:\\synthetic\\node.exe','C:\\synthetic\\moremote-cli.js',dir);
  for(const prefix of ['', '\uFEFF']){
   await writeFile(path,prefix+definition.content,{encoding:'utf16le',mode:0o600});assertTaskResource(dir,'win32');
  }
  if(process.platform!=='win32')assert.throws(()=>assertStateResource(dir,'moremote-cli-task.xml'),/FOREIGN/);
  const foreign=serviceDefinition('win32','/synthetic/home','C:\\synthetic\\node.exe','C:\\synthetic\\moremote-cli.js',other);
  await writeFile(path,'\uFEFF'+foreign.content,'utf16le');assert.throws(()=>assertTaskResource(dir,'win32'),/FOREIGN/);
  await writeFile(path,'\uFEFF\uFEFF'+definition.content,'utf16le');assert.throws(()=>assertTaskResource(dir,'win32'),/FOREIGN/);
  await writeFile(path,definition.content,'utf8');assert.throws(()=>assertTaskResource(dir,'win32'),/FOREIGN/);
 } finally {await rm(dir,{recursive:true,force:true});await rm(other,{recursive:true,force:true});}
});
