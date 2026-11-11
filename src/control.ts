import { createServer, createConnection, type Server } from 'node:net';
import { randomBytes, randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { join } from 'node:path';
import { chmodSync, renameSync, readdirSync } from 'node:fs';
import { assertStateRoot, createPrivateFile, hasCode, inspectResource, inspectRuntime, readRuntimeOwner, readRuntimeRecord, removeOwnedResource, runtimeMatches, RUNTIME_OWNER, sameResource, writePrivateAtomic, type ResourceIdentity, type RuntimeOwner } from './resources.js';
import {controlFraming,publishControlTransport,removeControlTransport} from './control-transport.js';

export function controlEndpoint(dir:string) {return process.platform==='win32'?'\\\\.\\pipe\\moremote-cli-'+createHash('sha256').update(dir).digest('hex').slice(0,24):join(dir,'runtime.sock');}
function object(value:unknown):value is Record<string,unknown> {return typeof value==='object'&&value!==null&&!Array.isArray(value);}
function removeRuntimeFile(path:string,identity:ResourceIdentity,owner:RuntimeOwner,record=false) {
 try {
  const current=record?readRuntimeRecord(path):readRuntimeOwner(path);
  if(!sameResource(current.identity,identity)||!runtimeMatches(current.value,owner))return false;
  return removeOwnedResource(path,identity);
 } catch {return false;}
}
function running(pid:number) {
 try {process.kill(pid,0);return true;} catch(error) {if(hasCode(error,'ESRCH'))return false;throw error;}
}
export function runtimeHasLiveOwner(dir:string):boolean {
 if(!inspectResource(dir,'directory',true))return false;
 if(readdirSync(dir).length===0)return false;
 assertStateRoot(dir);
 const {lock}=inspectRuntime(dir);
 return lock!==null&&running(lock.value.pid);
}
export async function requestControl(dir:string,action:'status'|'stop'):Promise<Record<string,unknown>|null> {
 if(!inspectResource(dir,'directory',true))return null;
 if(readdirSync(dir).length===0)return null;
 assertStateRoot(dir);
 const resources=inspectRuntime(dir);
 if(!resources.record)return null;
 if(process.platform!=='win32'&&!resources.socket)return null;
 const expectedRecord=resources.record.identity;
 const record=resources.record.value;
 const framing=controlFraming(dir,record);
 if(framing==='legacy-eof'&&process.platform==='win32'){if(!running(record.pid))return null;throw Error('LEGACY_WINDOWS_CONTROL_UNAVAILABLE')}
 const ownerEnded=()=>{const path=join(dir,'runtime.json');if(!inspectResource(path,'file',true))return true;const current=readRuntimeRecord(path);return !sameResource(current.identity,expectedRecord)||!runtimeMatches(current.value,record)};
 const {promise,resolve,reject}=Promise.withResolvers<Record<string,unknown>|null>();
 const socket=createConnection(controlEndpoint(dir));let raw='',settled=false;socket.setEncoding('utf8');
 const succeed=(value:Record<string,unknown>|null)=>{if(settled)return;settled=true;clearTimeout(timer);socket.destroy();resolve(value)};
 const fail=(error:unknown)=>{if(settled)return;settled=true;clearTimeout(timer);socket.destroy();reject(error)};
 const disconnected=()=>{if(settled)return;if(raw){fail(Error('CONTROL_INVALID_RESPONSE'));return}try{if(ownerEnded())succeed(null);else fail(Error('CONTROL_CONNECTION_CLOSED'))}catch(error){fail(error)}};
 const parseResponse=(frame:string)=>{try{const value:unknown=JSON.parse(frame);if(!object(value))throw Error('CONTROL_INVALID_RESPONSE');succeed(value)}catch{fail(Error('CONTROL_INVALID_RESPONSE'))}};
 const timer=setTimeout(()=>fail(Error('CONTROL_TIMEOUT')),2000);
 socket.on('connect',()=>{
  try {
   const current=inspectRuntime(dir);
   if(!current.record||!sameResource(current.record.identity,expectedRecord)||!runtimeMatches(current.record.value,record))throw Error('RUNTIME_RESOURCE_COLLISION');
   if(controlFraming(dir,current.record.value)!==framing)throw Error('CONTROL_TRANSPORT_CHANGED');
   const payload=JSON.stringify({token:record.token,action})+'\n';
   // The owned generation fact selects exactly one exchange, never a timeout
   // probe/replay. Published 0.1.0 uses EOF; new named pipes remain duplex.
   if(framing==='legacy-eof')socket.end(payload);else socket.write(payload);
  } catch(error) {fail(error);}
 });
 socket.on('data',chunk=>{
  if(settled)return;raw+=chunk;if(Buffer.byteLength(raw)>4096){fail(Error('CONTROL_LIMIT'));return}
  if(framing==='legacy-eof')return;
  const end=raw.indexOf('\n');if(end<0)return;
  if(end!==raw.length-1){fail(Error('CONTROL_INVALID_RESPONSE'));return}
  parseResponse(raw.slice(0,end));
 });
 socket.on('end',()=>{if(framing==='legacy-eof'&&raw)parseResponse(raw);else disconnected()});socket.on('close',disconnected);
 socket.on('error',error=>{if(settled)return;if(hasCode(error,'ECONNREFUSED')||hasCode(error,'ENOENT'))succeed(null);else if(hasCode(error,'ECONNRESET')||hasCode(error,'EPIPE'))disconnected();else fail(error)});
 return promise;
}
function closeServer(server:Server) {
 const {promise,resolve}=Promise.withResolvers<void>();server.close(()=>resolve());return promise;
}
async function assertPipeAbsent(endpoint:string) {
 const {promise,resolve,reject}=Promise.withResolvers<void>();
 const socket=createConnection(endpoint);socket.setTimeout(2000);
 socket.once('connect',()=>{socket.destroy();reject(Error('RUNTIME_RESOURCE_COLLISION'));});
 socket.once('timeout',()=>{socket.destroy();reject(Error('CONTROL_TIMEOUT'));});
 socket.once('error',error=>{if(hasCode(error,'ENOENT')||hasCode(error,'ECONNREFUSED'))resolve();else reject(error);});
 return promise;
}
export async function ownRuntime(dir:string,status:()=>unknown,stop:()=>void) {
 assertStateRoot(dir);
 let previous=inspectRuntime(dir);
 const endpoint=controlEndpoint(dir);
 if(process.platform==='win32'&&!previous.lock) {await assertPipeAbsent(endpoint);previous=inspectRuntime(dir);}
 // Validate every collision before replacing any lock, record or socket.
 if(previous.lock&&running(previous.lock.value.pid))throw Error('CLI_ALREADY_RUNNING');
 if(previous.socket&&!previous.record&&!(previous.lock?.value.staging&&sameResource(previous.socket,previous.lock.value.staging)))throw Error('RUNTIME_RESOURCE_COLLISION');
 if(previous.staged) {
  if(!previous.lock)throw Error('RUNTIME_UNPROVEN_STAGE');
  const current=readRuntimeOwner(join(dir,'runtime.lock'));
  if(!sameResource(current.identity,previous.lock.identity)||!runtimeMatches(current.value,previous.lock.value)||!current.value.staging||!sameResource(current.value.staging,previous.staged.identity))throw Error('RUNTIME_UNPROVEN_STAGE');
  if(!removeOwnedResource(previous.staged.path,previous.staged.identity,'socket',false))throw Error('RUNTIME_RESOURCE_COLLISION');
 }
 if(previous.socket&&!removeOwnedResource(endpoint,previous.socket,'socket'))throw Error('RUNTIME_RESOURCE_COLLISION');
 if(previous.record&&!removeRuntimeFile(join(dir,'runtime.json'),previous.record.identity,previous.record.value,true))throw Error('RUNTIME_RESOURCE_COLLISION');
 if(previous.lock&&!removeRuntimeFile(join(dir,'runtime.lock'),previous.lock.identity,previous.lock.value))throw Error('RUNTIME_RESOURCE_COLLISION');
 const owner:RuntimeOwner={owner:RUNTIME_OWNER,version:1,instanceId:randomUUID(),pid:process.pid,startedAt:Date.now(),token:randomBytes(32).toString('base64url')};
 const lockPath=join(dir,'runtime.lock'),recordPath=join(dir,'runtime.json');
 let lock=createPrivateFile(lockPath,JSON.stringify(owner)+'\n');
 const staging=process.platform==='win32'?endpoint:join(dir,'s.'+owner.instanceId.slice(0,8));
 let socketIdentity:ResourceIdentity|null=null,recordIdentity:ResourceIdentity|null=null,transportIdentity:ResourceIdentity|undefined;
 const server=createServer({allowHalfOpen:true},socket=>{
  let raw='',handled=false;socket.setEncoding('utf8');const timer=setTimeout(()=>socket.destroy(),2000);
  socket.once('close',()=>clearTimeout(timer));socket.on('error',()=>{});socket.on('end',()=>socket.destroy());
  const reply=(value:Record<string,unknown>)=>{const frame=JSON.stringify(value)+'\n';if(Buffer.byteLength(frame)>4096)socket.destroy();else socket.write(frame)};
  socket.on('data',chunk=>{
   if(handled){socket.destroy();return}raw+=chunk;if(Buffer.byteLength(raw)>4096){handled=true;socket.destroy();return}
   const end=raw.indexOf('\n');if(end<0)return;handled=true;
   try {
    if(end!==raw.length-1)throw Error('CONTROL_FRAME');
    const request:unknown=JSON.parse(raw.slice(0,end));
    if(!object(request)||typeof request.token!=='string'||request.token.length!==43)throw Error('CONTROL_AUTH');
    const left=Buffer.from(request.token),right=Buffer.from(owner.token);
    if(left.length!==right.length||!timingSafeEqual(left,right))throw Error('CONTROL_AUTH');
    if(request.action==='stop') {stop();reply({ok:true,stopping:true});}
    else if(request.action==='status') {const value=status();if(!object(value))throw Error('CONTROL_STATUS');reply({ok:true,...value});}
    else throw Error('CONTROL_ACTION');
   } catch {reply({ok:false});}
  });
 });
 try {
  if(process.platform!=='win32'&&inspectResource(staging,'socket',true))throw Error('RUNTIME_RESOURCE_COLLISION');
  const {promise,resolve,reject}=Promise.withResolvers<void>();
  server.once('error',reject);server.listen(staging,resolve);await promise;server.removeListener('error',reject);
  if(process.platform!=='win32') {
   const created=inspectResource(staging,'socket',false,false);
   if(!created)throw Error('RUNTIME_RESOURCE_COLLISION');
   const current=readRuntimeOwner(lockPath);
   if(!sameResource(current.identity,lock)||!runtimeMatches(current.value,owner))throw Error('RUNTIME_RESOURCE_COLLISION');
   lock=writePrivateAtomic(lockPath,{...owner,staging:{dev:created.dev,ino:created.ino}});
   chmodSync(staging,0o600);
   const secured=inspectResource(staging,'socket');
   if(!secured||!sameResource(created,secured)||inspectResource(endpoint,'socket',true))throw Error('RUNTIME_RESOURCE_COLLISION');
   // libuv closes/unlinks the bind path, not the public path. A replacement
   // runtime.sock therefore cannot be removed implicitly by server.close().
   renameSync(staging,endpoint);socketIdentity={dev:secured.dev,ino:secured.ino};
  }
  // Publish the generation fact durably before making its unchanged legacy-
  // compatible record visible; readers can never select EOF for this record.
  transportIdentity=await publishControlTransport(dir,owner);
  recordIdentity=writePrivateAtomic(recordPath,{...owner,socket:socketIdentity});
 } catch(error) {
  await closeServer(server);
  if(socketIdentity)removeOwnedResource(endpoint,socketIdentity,'socket');
  if(recordIdentity)removeRuntimeFile(recordPath,recordIdentity,owner,true);
  if(transportIdentity)removeControlTransport(dir,transportIdentity,owner);
  removeRuntimeFile(lockPath,lock,owner);throw error;
 }
 let closing:Promise<void>|undefined;
 return ()=>{
  if(closing)return closing;
  if(process.platform!=='win32'&&inspectResource(staging,'socket',true))throw Error('RUNTIME_RESOURCE_COLLISION');
  closing=(async()=>{
   await closeServer(server);
   if(socketIdentity)removeOwnedResource(endpoint,socketIdentity,'socket');
   if(recordIdentity)removeRuntimeFile(recordPath,recordIdentity,owner,true);
   removeRuntimeFile(lockPath,lock,owner);
   if(transportIdentity)removeControlTransport(dir,transportIdentity,owner);
  })();
  return closing;
 };
}
