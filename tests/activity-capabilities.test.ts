import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile,symlink,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {EnrollmentFiles} from '../src/enrollment-files.ts';

const daemon='synthetic-capability-daemon',instanceId='11111111-1111-4111-8111-111111111111';
async function fixture(t:TestContext) {
 const home=await mkdtemp(join(tmpdir(),'moremote-capabilities-'));
 const files=new EnrollmentFiles({home,stateDirectory:join(home,'state'),daemonServerId:daemon,instanceId});
 const path=join(home,'.moremote-cli-activity',createHash('sha256').update(daemon).digest('hex'),'capabilities.json');
 t.after(async()=>{try{files.close()}catch{}await rm(home,{recursive:true,force:true})});
 return {home,files,path};
}
test('capability publication stays outside the legacy descriptor and follows its instance, clock and cleanup',async t=>{
 const {files,path}=await fixture(t);files.open();files.publish(true,'https://relay.example.test',1000);
 const descriptor=JSON.parse(await readFile(join(files.path,'descriptor.json'),'utf8'));
 assert.deepEqual(Object.keys(descriptor).sort(),['apiOrigin','daemonServerId','enabled','expiresAt','instanceId','measuredAt','version']);
 const first=await readFile(path,'utf8');
 assert.deepEqual(JSON.parse(first),{version:1,daemonServerId:daemon,instanceId,measuredAt:1000,expiresAt:91000,titleHints:1});
 if(process.platform!=='win32')assert.equal((await lstat(path)).mode&0o777,0o600);
 files.publish(true,'https://relay.example.test',30999);assert.equal(await readFile(path,'utf8'),first);
 files.publish(true,'https://relay.example.test',31000);assert.equal(JSON.parse(await readFile(path,'utf8')).expiresAt,121000);
 files.close();await assert.rejects(readFile(path),{code:'ENOENT'});
 files.open();files.publish(true,'https://relay.example.test',32000);assert.equal(JSON.parse(await readFile(path,'utf8')).instanceId,instanceId);
});
test('foreign capability documents and symlinks cannot be overwritten or removed',async t=>{
 const {home,files,path}=await fixture(t);files.open();files.publish(true,'https://relay.example.test',1000);
 const original=JSON.parse(await readFile(path,'utf8'));
 await writeFile(path,JSON.stringify({...original,daemonServerId:'another-daemon'}),{mode:0o600});
 assert.throws(()=>files.publish(true,'https://relay.example.test',31000),/FOREIGN/);
 assert.throws(()=>files.close(),/FOREIGN/);
 assert.equal(JSON.parse(await readFile(path,'utf8')).daemonServerId,'another-daemon');
 await rm(path);const other=join(home,'outside');await writeFile(other,'do not touch',{mode:0o600});
 await symlink(other,path);
 const replacement=new EnrollmentFiles({home,stateDirectory:join(home,'state'),daemonServerId:daemon,isAlive:()=>false});
 replacement.open();assert.throws(()=>replacement.publish(true,'https://relay.example.test',32000),/FOREIGN_RESOURCE_KIND/);
 assert.equal(await readFile(other,'utf8'),'do not touch');try{replacement.close()}catch{}
});
test('a dead runtime can replace only its marked capability file without changing legacy descriptor fields',async t=>{
 const {home,files,path}=await fixture(t);files.open();files.publish(true,'https://relay.example.test',1000);
 const replacementId='22222222-2222-4222-8222-222222222222';
 const replacement=new EnrollmentFiles({home,stateDirectory:join(home,'state'),daemonServerId:daemon,instanceId:replacementId,isAlive:()=>false});
 replacement.open();replacement.publish(true,'https://relay.example.test',2000);
 const descriptor=JSON.parse(await readFile(join(replacement.path,'descriptor.json'),'utf8'));
 const capability=JSON.parse(await readFile(path,'utf8'));
 assert.equal(descriptor.instanceId,replacementId);assert.equal(capability.instanceId,replacementId);
 assert.equal(capability.measuredAt,descriptor.measuredAt);assert.equal(capability.expiresAt,descriptor.expiresAt);
 assert.throws(()=>files.close(),/DISCOVERY_RESOURCE_CHANGED/);
 replacement.close();
});
