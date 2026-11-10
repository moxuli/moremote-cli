import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type Socket} from 'node:net';
import {mkdtemp,rm,chmod,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {privateDirectory} from '../src/config.ts';
import {controlEndpoint,requestControl} from '../src/control.ts';
import {RUNTIME_OWNER,createPrivateFile,removeOwnedResource,type ResourceIdentity} from '../src/resources.ts';
async function fixture(response:string,retire=false){
 const dir=await mkdtemp(join(process.platform==='win32'?tmpdir():'/tmp','mcr-'));await privateDirectory(dir);
 const owner={owner:RUNTIME_OWNER,version:1,instanceId:randomUUID(),pid:process.pid,startedAt:Date.now(),token:randomBytes(32).toString('base64url')};
 const sockets=new Set<Socket>();let record:ResourceIdentity,lock:ResourceIdentity;let action:unknown;
 const server=createServer({allowHalfOpen:true},socket=>{
  sockets.add(socket);socket.once('close',()=>sockets.delete(socket));socket.on('error',()=>{});let raw='';socket.on('data',chunk=>raw+=chunk);
  socket.on('end',()=>{const request=JSON.parse(raw);assert.equal(request.token,owner.token);action=request.action;
   if(retire){assert.equal(removeOwnedResource(join(dir,'runtime.json'),record),true);assert.equal(removeOwnedResource(join(dir,'runtime.lock'),lock),true)}
   socket.end(response);
  });
 });
 const listening=Promise.withResolvers<void>();server.once('error',listening.reject);server.listen(controlEndpoint(dir),listening.resolve);await listening.promise;
 let socketIdentity:ResourceIdentity|null=null;if(process.platform!=='win32'){await chmod(controlEndpoint(dir),0o600);const stat=await lstat(controlEndpoint(dir));socketIdentity={dev:stat.dev,ino:stat.ino}}
 lock=createPrivateFile(join(dir,'runtime.lock'),JSON.stringify(owner));record=createPrivateFile(join(dir,'runtime.json'),JSON.stringify({...owner,socket:socketIdentity}));
 async function close(){for(const socket of sockets)socket.destroy();const closed=Promise.withResolvers<void>();server.close(closed.resolve);await closed.promise;await rm(dir,{recursive:true,force:true})}
 return {dir,action:()=>action,close};
}

for(const [response,error] of [['','CONTROL_CONNECTION_CLOSED'],['{"ok":','CONTROL_INVALID_RESPONSE'],['[]','CONTROL_INVALID_RESPONSE']] as const)test(`an owned control peer's incomplete/invalid response is explicit ${error}, never an absent runtime`,{timeout:5000},async()=>{
 const f=await fixture(response);try{await assert.rejects(requestControl(f.dir,'status'),{message:error});assert.equal(f.action(),'status')}finally{await f.close()}
});

test('EOF becomes not-running only after the exact previously validated owner has retired its record',{timeout:5000},async()=>{
 const f=await fixture('',true);try{assert.equal(await requestControl(f.dir,'status'),null);assert.equal(f.action(),'status')}finally{await f.close()}
});
