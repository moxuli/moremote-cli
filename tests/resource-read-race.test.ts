import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadConfig,type Config} from '../src/config.ts';
import {readPrivateText,sameResource} from '../src/resources.ts';

async function fixture(t:test.TestContext){
 const dir=await mkdtemp(join(tmpdir(),'moremote-read-race-')),path=join(dir,'config.json'),next=join(dir,'replacement.json');
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const config:Config={version:1,clientId:'moremote-cli-read-race',paseoHome:join(dir,'synthetic-official'),allowLoopbackHttp:false,cloudEnabled:false,pairs:[]};
 await writeFile(join(dir,'.moremote-cli-owner'),'MoRemote CLI state v1\n',{mode:0o600});
 await writeFile(path,JSON.stringify(config),{mode:0o600});
 return {dir,path,next,config};
}

function afterFs(t:test.TestContext,method:'lstatSync'|'openSync'|'readSync',after:(args:any[],result:any)=>void){
 const original=fs[method] as (...args:any[])=>any;
 const mocked=t.mock.method(fs,method,(...args:any[])=>{const result=original(...args);after(args,result);return result});
 syncBuiltinESMExports();t.after(()=>{mocked.mock.restore();syncBuiltinESMExports()});
}

// Current Node/Windows can refuse replacing a destination with a live handle.
// Exercise that actual result without throwing before the reader owns its fd.
function tryReplacement(from:string,to:string){
 try{fs.renameSync(from,to);return true}catch(error){
  if(process.platform==='win32'&&error instanceof Error&&'code' in error&&(error.code==='EPERM'||error.code==='EACCES'))return false;
  throw error;
 }
}

for(const boundary of ['lstat','open','read','final-lstat'] as const)test('private config survives an actual atomic replacement after '+boundary,async t=>{
 const f=await fixture(t),replacement={...f.config,clientId:'moremote-cli-replacement'};
 await writeFile(f.next,JSON.stringify(replacement),{mode:0o600});
 const original=fs.lstatSync(f.path);let attempted=false,replaced=false,descriptor:number|undefined;
 const replace=()=>{if(!attempted){attempted=true;replaced=tryReplacement(f.next,f.path)}};
 if(boundary==='lstat'||boundary==='final-lstat'){
  let inspections=0;afterFs(t,'lstatSync',args=>{if(args[0]===f.path&&++inspections===(boundary==='lstat'?1:2))replace()});
 }
 else afterFs(t,'openSync',(args,fd)=>{if(args[0]===f.path){descriptor=fd;if(boundary==='open')replace()}});
 if(boundary==='read')afterFs(t,'readSync',args=>{if(args[0]===descriptor)replace()});
 assert.deepEqual(await loadConfig(f.dir),!replaced||boundary==='final-lstat'?f.config:replacement);
 assert.equal(attempted,true);assert.equal(sameResource(original,fs.lstatSync(f.path)),!replaced);
 if(!replaced){assert.equal(process.platform,'win32');assert.notEqual(boundary,'lstat');fs.renameSync(f.next,f.path)}
 const result=readPrivateText(f.path,4096);assert.deepEqual(JSON.parse(result.text),replacement);assert.equal(sameResource(result.identity,fs.lstatSync(f.path)),true);
});

for(const boundary of ['lstat','read'] as const)for(const foreign of ['symlink','hardlink','mode','oversize'] as const)test('replacement after '+boundary+' still rejects '+foreign,{skip:foreign==='mode'&&process.platform==='win32'},async t=>{
 const f=await fixture(t),target=join(f.dir,'foreign.json');await writeFile(target,JSON.stringify(f.config),{mode:0o600});
 if(foreign==='symlink')fs.symlinkSync(target,f.next);
 else if(foreign==='hardlink')fs.linkSync(target,f.next);
 else await writeFile(f.next,foreign==='oversize'?'x'.repeat(4097):JSON.stringify(f.config),{mode:foreign==='mode'?0o644:0o600});
 let attempted=false,replaced=false,descriptor:number|undefined;
 const replace=()=>{if(!attempted){attempted=true;replaced=tryReplacement(f.next,f.path)}};
 if(boundary==='lstat')afterFs(t,'lstatSync',args=>{if(args[0]===f.path)replace()});
 else{
  afterFs(t,'openSync',(args,fd)=>{if(args[0]===f.path)descriptor=fd});
  afterFs(t,'readSync',args=>{if(args[0]===descriptor)replace()});
 }
 const rejection=foreign==='symlink'?/ELOOP|FOREIGN_RESOURCE_KIND/:foreign==='hardlink'?/FOREIGN_RESOURCE_LINKS/:foreign==='mode'?/FOREIGN_RESOURCE_MODE/:/FOREIGN_RESOURCE_LIMIT/;
 let result:ReturnType<typeof readPrivateText>|undefined,failure:unknown;
 try{result=readPrivateText(f.path,4096)}catch(error){failure=error}
 if(!replaced){
  assert.equal(process.platform,'win32');assert.equal(boundary,'read');assert.equal(failure,undefined);assert.ok(result);
  assert.deepEqual(JSON.parse(result.text),f.config);assert.equal(sameResource(result.identity,fs.lstatSync(f.path)),true);
  fs.renameSync(f.next,f.path);assert.throws(()=>readPrivateText(f.path,4096),rejection);
 }else{assert.ok(failure instanceof Error);assert.match(failure.message,rejection)}
 assert.equal(attempted,true);assert.equal(fs.readFileSync(target,'utf8'),JSON.stringify(f.config));
});

test('same-inode writes during a private read are rejected rather than retried',async t=>{
 const f=await fixture(t);let descriptor:number|undefined,changed=false;
 afterFs(t,'openSync',(args,fd)=>{if(args[0]===f.path)descriptor=fd});
 afterFs(t,'readSync',args=>{if(args[0]===descriptor&&!changed){changed=true;fs.writeFileSync(f.path,'{}');fs.utimesSync(f.path,new Date(),new Date(Date.now()+1000))}});
 assert.throws(()=>readPrivateText(f.path,4096),/FOREIGN_RESOURCE_CHANGED/);assert.equal(changed,true);
});

for(const mutation of ['truncate','same-size'] as const)test('in-place '+mutation+' with attempted atomic replacement still rejects observed mutation',async t=>{
 const f=await fixture(t);await writeFile(f.next,JSON.stringify({...f.config,clientId:'moremote-cli-replacement'}),{mode:0o600});
 const original=fs.lstatSync(f.path);let descriptor:number|undefined,changed=false,replaced=false;
 afterFs(t,'openSync',(args,fd)=>{if(args[0]===f.path)descriptor=fd});
 afterFs(t,'readSync',args=>{if(args[0]===descriptor&&!changed){
  changed=true;fs.writeFileSync(f.path,mutation==='truncate'?'{}':'x'.repeat(original.size));
  fs.utimesSync(f.path,new Date(),new Date(Date.now()+1000));replaced=tryReplacement(f.next,f.path);
 }});
 assert.throws(()=>readPrivateText(f.path,4096),/FOREIGN_RESOURCE_CHANGED/);
 assert.equal(changed,true);assert.equal(sameResource(original,fs.lstatSync(f.path)),!replaced);if(!replaced)assert.equal(process.platform,'win32');
});

test('continuous valid replacements have a bounded read failure',async t=>{
 const f=await fixture(t);let replacements=0;
 afterFs(t,'lstatSync',args=>{if(args[0]===f.path){
  assert.ok(replacements<8,'a private read must not spin indefinitely');
  fs.writeFileSync(f.next,JSON.stringify({...f.config,clientId:'moremote-cli-generation-'+replacements}),{mode:0o600});fs.renameSync(f.next,f.path);replacements++;
 }});
 assert.throws(()=>readPrivateText(f.path,4096),/FOREIGN_RESOURCE_CHANGED/);assert.ok(replacements>1);
});
