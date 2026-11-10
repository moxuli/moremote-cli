import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type Socket} from 'node:net';
import {mkdtemp,rm,chmod,lstat,writeFile,readFile,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {privateDirectory} from '../src/config.ts';
import {controlEndpoint,requestControl} from '../src/control.ts';
import {RUNTIME_OWNER,createPrivateFile,removeOwnedResource,type ResourceIdentity,type RuntimeOwner} from '../src/resources.ts';
import {publishControlTransport} from '../src/control-transport.ts';
async function fixture(response:string|readonly (string|Uint8Array)[],retire=false,endResponse=true,framing:'json-lines-v1'|'legacy-eof'='json-lines-v1',stale=false){
 const dir=await mkdtemp(join(process.platform==='win32'?tmpdir():'/tmp','mcr-'));await privateDirectory(dir);
 const owner:RuntimeOwner={owner:RUNTIME_OWNER,version:1,instanceId:randomUUID(),pid:process.pid,startedAt:Date.now(),token:randomBytes(32).toString('base64url')};
 const sockets=new Set<Socket>();let record:ResourceIdentity,lock:ResourceIdentity;let action:unknown,requests=0;
 const server=createServer({allowHalfOpen:true},socket=>{
  sockets.add(socket);socket.once('close',()=>sockets.delete(socket));socket.on('error',()=>{});socket.setEncoding('utf8');let raw='',handled=false;
  const respond=(frame:string)=>{const request=JSON.parse(frame);assert.equal(request.token,owner.token);action=request.action;requests++;
   if(retire){assert.equal(removeOwnedResource(join(dir,'runtime.json'),record),true);assert.equal(removeOwnedResource(join(dir,'runtime.lock'),lock),true)}
   const chunks=typeof response==='string'?[response]:response;
   const send=(index:number)=>{if(index===chunks.length){if(endResponse)socket.end();return}socket.write(chunks[index],error=>{if(!error)setImmediate(()=>send(index+1))})};send(0);
  };
  socket.on('data',chunk=>{if(handled)return;raw+=chunk;if(framing==='legacy-eof')return;const end=raw.indexOf('\n');if(end<0)return;handled=true;respond(raw.slice(0,end))});
  socket.on('end',()=>{if(framing==='legacy-eof'&&!handled){handled=true;respond(raw)}else socket.destroy()});
 });
 const listening=Promise.withResolvers<void>();server.once('error',listening.reject);server.listen(controlEndpoint(dir),listening.resolve);await listening.promise;
 let socketIdentity:ResourceIdentity|null=null;if(process.platform!=='win32'){await chmod(controlEndpoint(dir),0o600);const stat=await lstat(controlEndpoint(dir));socketIdentity={dev:stat.dev,ino:stat.ino}}
 if(framing==='json-lines-v1'||stale)await publishControlTransport(dir,stale?{...owner,instanceId:randomUUID(),token:randomBytes(32).toString('base64url')}:owner);
 lock=createPrivateFile(join(dir,'runtime.lock'),JSON.stringify(owner));record=createPrivateFile(join(dir,'runtime.json'),JSON.stringify({...owner,socket:socketIdentity}));
 async function close(){for(const socket of sockets)socket.destroy();const closed=Promise.withResolvers<void>();server.close(closed.resolve);await closed.promise;await rm(dir,{recursive:true,force:true})}
 return {dir,action:()=>action,requests:()=>requests,close};
}

for(const [response,error] of [['','CONTROL_CONNECTION_CLOSED'],['{"ok":','CONTROL_INVALID_RESPONSE'],['{"ok":true}','CONTROL_INVALID_RESPONSE'],['[]\n','CONTROL_INVALID_RESPONSE'],['x'.repeat(4097)+'\n','CONTROL_LIMIT']] as const)test(`an owned control peer's incomplete/invalid response is explicit ${error}, never an absent runtime`,{timeout:5000},async()=>{
 const f=await fixture(response);try{await assert.rejects(requestControl(f.dir,'status'),{message:error});assert.equal(f.action(),'status')}finally{await f.close()}
});

test('EOF becomes not-running only after the exact previously validated owner has retired its record',{timeout:5000},async()=>{
 const f=await fixture('',true);try{assert.equal(await requestControl(f.dir,'status'),null);assert.equal(f.action(),'status')}finally{await f.close()}
});

test('request/response frames complete without either peer half-closing, including fragmented UTF-8 payload',{timeout:5000},async()=>{
 const frame=Buffer.from('{"ok":true,"label":"通知"}\n'),split=frame.indexOf(Buffer.from('通'))+1;
 const f=await fixture([frame.subarray(0,split),frame.subarray(split,split+1),frame.subarray(split+1)],false,false);
 try{assert.deepEqual(await requestControl(f.dir,'status'),{ok:true,label:'通知'});assert.equal(f.action(),'status')}finally{await f.close()}
});

for(const stale of [false,true])test(`owned published 0.1.0 EOF transport is selected once with ${stale?'stale other-generation':'no'} framing descriptor`,{timeout:5000},async()=>{
 const f=await fixture('{"ok":true,"version":"0.1.0"}',false,true,'legacy-eof',stale);try{
  if(process.platform==='win32'){await assert.rejects(requestControl(f.dir,'status'),{message:'LEGACY_WINDOWS_CONTROL_UNAVAILABLE'});assert.equal(f.requests(),0)}
  else{assert.deepEqual(await requestControl(f.dir,'status'),{ok:true,version:'0.1.0'});assert.equal(f.requests(),1);assert.equal(f.action(),'status')}
 }finally{await f.close()}
});

test('a lost legacy stop acknowledgement never probes or replays against a second transport',{timeout:5000},async()=>{
 const f=await fixture('',false,true,'legacy-eof');try{
  await assert.rejects(requestControl(f.dir,'stop'),{message:process.platform==='win32'?'LEGACY_WINDOWS_CONTROL_UNAVAILABLE':'CONTROL_CONNECTION_CLOSED'});
  assert.equal(f.requests(),process.platform==='win32'?0:1);if(process.platform!=='win32')assert.equal(f.action(),'stop');
 }finally{await f.close()}
});

test('malformed transport metadata is terminal before any authenticated control write',{timeout:5000},async()=>{
 const f=await fixture('{"ok":true}\n');try{
  await writeFile(join(f.dir,'managed','runtime-transport.json'),'{"unmarked":true}');
  await assert.rejects(requestControl(f.dir,'stop'),{message:'INVALID_CONTROL_TRANSPORT'});assert.equal(f.requests(),0);
 }finally{await f.close()}
});

test('a symlinked transport descriptor is not followed or used to send a control',{timeout:5000},async()=>{
 const f=await fixture('{"ok":true}\n');try{
  const target=join(f.dir,'foreign-descriptor'),path=join(f.dir,'managed','runtime-transport.json');await writeFile(target,'unrelated fixture bytes');await rm(path);await symlink(target,path);
  await assert.rejects(requestControl(f.dir,'stop'),/FOREIGN_RESOURCE/);assert.equal(f.requests(),0);assert.equal(await readFile(target,'utf8'),'unrelated fixture bytes');
 }finally{await f.close()}
});
