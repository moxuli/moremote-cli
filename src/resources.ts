import { constants, lstatSync, openSync, closeSync, fstatSync, readSync, writeFileSync, fsyncSync, unlinkSync, renameSync, readdirSync, type Stats } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import {isUtf8} from 'node:buffer';

export const JOURNAL_APPLICATION_ID=0x4d524331;
export const CONFIG_BYTES=524288;
export const RUNTIME_OWNER='MoRemote CLI runtime';
export interface ResourceIdentity {dev:number;ino:number}
export interface RuntimeOwner {
 owner:typeof RUNTIME_OWNER;version:1;instanceId:string;pid:number;startedAt:number;token:string;
}
export interface RuntimeLock extends RuntimeOwner {staging?:ResourceIdentity}
export interface RuntimeRecord extends RuntimeOwner {socket:ResourceIdentity|null}
export interface RuntimeResources {
 lock:{value:RuntimeLock;identity:ResourceIdentity}|null;
 record:{value:RuntimeRecord;identity:ResourceIdentity}|null;
 socket:ResourceIdentity|null;
 staged:{path:string;identity:ResourceIdentity}|null;
}
export function hasCode(error:unknown,code:string) {return error instanceof Error&&'code' in error&&error.code===code;}
export function sameResource(left:ResourceIdentity,right:ResourceIdentity) {return left.dev===right.dev&&left.ino===right.ino;}
export function inspectResource(path:string,kind:'file'|'directory'|'socket',optional=false,privateMode=true):Stats|null {
 let stat:Stats;
 try {stat=lstatSync(path);} catch(error) {if(optional&&hasCode(error,'ENOENT'))return null;throw error;}
 if(stat.isSymbolicLink()||!(kind==='file'?stat.isFile():kind==='directory'?stat.isDirectory():stat.isSocket()))throw Error('FOREIGN_RESOURCE_KIND');
 if(kind!=='directory'&&stat.nlink!==1)throw Error('FOREIGN_RESOURCE_LINKS');
 if(typeof process.getuid==='function'&&stat.uid!==process.getuid())throw Error('FOREIGN_RESOURCE_USER');
 if(privateMode&&process.platform!=='win32'&&((stat.mode&0o7077)!==0||(stat.mode&(kind==='directory'?0o700:0o600))!==(kind==='directory'?0o700:0o600)))throw Error('FOREIGN_RESOURCE_MODE');
 return stat;
}
export function readPrivateText(path:string,limit:number,encoding:'utf8'|'utf16le'='utf8',privateMode=true) {
 const before=inspectResource(path,'file',false,privateMode);
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try {
  const opened=fstatSync(fd);
  if(!before||!sameResource(before,opened)||!opened.isFile()||opened.nlink!==1||opened.size>limit)throw Error('FOREIGN_RESOURCE_LIMIT');
  const bytes=Buffer.alloc(limit+1);let size=0;
  while(size<bytes.length) {const count=readSync(fd,bytes,size,bytes.length-size,null);if(count===0)break;size+=count;}
  const after=inspectResource(path,'file',false,privateMode);
  if(size>limit||!after||!sameResource(opened,after)||opened.size!==after.size||opened.mtimeMs!==after.mtimeMs)throw Error('FOREIGN_RESOURCE_CHANGED');
  if(encoding==='utf8'&&!isUtf8(bytes.subarray(0,size)))throw Error('FOREIGN_RESOURCE_ENCODING');
  return {text:bytes.toString(encoding,0,size),identity:{dev:opened.dev,ino:opened.ino}};
 } finally {closeSync(fd);}
}
export function assertStateRoot(dir:string) {
 inspectResource(dir,'directory');
 if(readPrivateText(join(dir,'.moremote-cli-owner'),128).text!=='MoRemote CLI state v1\n')throw Error('FOREIGN_DATA_DIRECTORY');
}
function object(value:unknown):value is Record<string,unknown> {return typeof value==='object'&&value!==null&&!Array.isArray(value);}
function integer(value:unknown,min:number,max=Number.MAX_SAFE_INTEGER):value is number {return typeof value==='number'&&Number.isSafeInteger(value)&&value>=min&&value<=max;}
function resourceIdentity(value:unknown):value is ResourceIdentity {return object(value)&&Object.keys(value).length===2&&integer(value.dev,0)&&integer(value.ino,0);}
function runtimeOwner(value:unknown):value is RuntimeOwner {
 return object(value)&&value.owner===RUNTIME_OWNER&&value.version===1&&typeof value.instanceId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.instanceId)&&integer(value.pid,1,2147483647)&&integer(value.startedAt,1)&&typeof value.token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value.token)&&Buffer.from(value.token,'base64url').toString('base64url')===value.token;
}
export function readRuntimeOwner(path:string):{value:RuntimeLock;identity:ResourceIdentity} {
 const file=readPrivateText(path,2048);const value:unknown=JSON.parse(file.text);
 if(!runtimeOwner(value))throw Error('INVALID_RUNTIME_LOCK');
 if(Object.keys(value).length===6)return {value,identity:file.identity};
 if(Object.keys(value).length===7&&'staging' in value&&resourceIdentity(value.staging))return {value:{...value,staging:value.staging},identity:file.identity};
 throw Error('INVALID_RUNTIME_LOCK');
}
export function readRuntimeRecord(path:string) {
 const file=readPrivateText(path,2048);const value:unknown=JSON.parse(file.text);
 if(!runtimeOwner(value)||!('socket' in value)||Object.keys(value).length!==7||!(value.socket===null||resourceIdentity(value.socket)))throw Error('INVALID_RUNTIME_RECORD');
 return {value:{...value,socket:value.socket},identity:file.identity};
}
export function runtimeMatches(lock:RuntimeOwner,record:RuntimeOwner) {
 return lock.instanceId===record.instanceId&&lock.pid===record.pid&&lock.startedAt===record.startedAt&&lock.token===record.token;
}
export function inspectRuntime(dir:string):RuntimeResources {
 const lockPath=join(dir,'runtime.lock'),recordPath=join(dir,'runtime.json');
 const lock=inspectResource(lockPath,'file',true)?readRuntimeOwner(lockPath):null;
 const record=inspectResource(recordPath,'file',true)?readRuntimeRecord(recordPath):null;
 const socket=process.platform==='win32'?null:inspectResource(join(dir,'runtime.sock'),'socket',true);
 const stageNames=readdirSync(dir).filter(name=>/^s\.[0-9a-f]{8}$/.test(name));
 if(stageNames.some(name=>!lock||name!=='s.'+lock.value.instanceId.slice(0,8)))throw Error('RUNTIME_UNPROVEN_STAGE');
 let staged:RuntimeResources['staged']=null;
 if(lock&&process.platform!=='win32') {
  const path=join(dir,'s.'+lock.value.instanceId.slice(0,8));
  const stat=inspectResource(path,'socket',true,false);
  if(stat) {
   // A pre-chmod crash is recoverable only with an inode durably bound to
   // the marked lock. A filename or private mode alone is not ownership.
   if(!lock.value.staging||!sameResource(stat,lock.value.staging)||(stat.mode&0o7000)!==0)throw Error('RUNTIME_UNPROVEN_STAGE');
   staged={path,identity:{dev:stat.dev,ino:stat.ino}};
  }
 }
 if(record&&(!lock||!runtimeMatches(lock.value,record.value)))throw Error('RUNTIME_RESOURCE_COLLISION');
 if(socket&&!(record?.value.socket&&sameResource(socket,record.value.socket))&&!(lock?.value.staging&&sameResource(socket,lock.value.staging)))throw Error('RUNTIME_RESOURCE_COLLISION');
 if(record&&process.platform!=='win32'&&record.value.socket===null)throw Error('RUNTIME_RESOURCE_COLLISION');
 if(record&&process.platform==='win32'&&record.value.socket!==null)throw Error('RUNTIME_RESOURCE_COLLISION');
 return {lock,record,socket,staged};
}
export function validateJournalPath(path:string):ResourceIdentity|null {
 inspectResource(dirname(path),'directory');
 const existing=inspectResource(path,'file',true);
 const sidecars=['-wal','-shm','-journal'].map(suffix=>inspectResource(path+suffix,'file',true));
 if(!existing) {if(sidecars.some(Boolean))throw Error('FOREIGN_JOURNAL_SIDECAR');return null;}
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try {
  if(!sameResource(existing,fstatSync(fd)))throw Error('FOREIGN_RESOURCE_CHANGED');
  // immutable avoids SQLite creating or updating WAL/SHM while probing ownership.
  const probe=new DatabaseSync(pathToFileURL(path).href+'?mode=ro&immutable=1',{readOnly:true,enableForeignKeyConstraints:false});
  try {if(probe.prepare('PRAGMA application_id').get()?.application_id!==JOURNAL_APPLICATION_ID)throw Error('FOREIGN_JOURNAL');}
  finally {probe.close();}
  const after=inspectResource(path,'file');
  if(!after||!sameResource(existing,after))throw Error('FOREIGN_RESOURCE_CHANGED');
  return {dev:existing.dev,ino:existing.ino};
 } finally {closeSync(fd);}
}
export function removeOwnedResource(path:string,identity:ResourceIdentity,kind:'file'|'socket'='file',privateMode=true) {
 let current:Stats|null;
 try {current=inspectResource(path,kind,true,privateMode);} catch {return false;}
 if(!current||!sameResource(current,identity))return false;
 unlinkSync(path);return true;
}
export function createPrivateFile(path:string,text:string):ResourceIdentity {
 const fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 const identity=fstatSync(fd);
 try {writeFileSync(fd,text);fsyncSync(fd);return {dev:identity.dev,ino:identity.ino};}
 catch(error) {removeOwnedResource(path,identity);throw error;}
 finally {closeSync(fd);}
}
export function openOwnedJournal(path:string):DatabaseSync {
 const existing=validateJournalPath(path);
 const identity=existing??createPrivateFile(path,'');
 const current=inspectResource(path,'file');
 if(!current||!sameResource(current,identity))throw Error('FOREIGN_RESOURCE_CHANGED');
 let db:DatabaseSync;
 try {db=new DatabaseSync(path);} catch(error) {if(!existing)removeOwnedResource(path,identity);throw error;}
 try {
  if(!existing)db.exec(`PRAGMA application_id=${JOURNAL_APPLICATION_ID}`);
  if(db.prepare('PRAGMA application_id').get()?.application_id!==JOURNAL_APPLICATION_ID)throw Error('FOREIGN_JOURNAL');
  const after=inspectResource(path,'file');
  if(!after||!sameResource(after,identity))throw Error('FOREIGN_RESOURCE_CHANGED');
  return db;
 } catch(error) {db.close();if(!existing)removeOwnedResource(path,identity);throw error;}
}
export function writePrivateAtomic(path:string,value:unknown):ResourceIdentity {
 const dir=dirname(path),name=basename(path);
 assertStateRoot(dir);
 if(name!=='config.json'&&name!=='runtime.json'&&name!=='runtime.lock')throw Error('FOREIGN_RESOURCE_NAME');
 const bytes=JSON.stringify(value)+'\n';
 if(name==='config.json'&&Buffer.byteLength(bytes)>CONFIG_BYTES)throw Error('CONFIG_LIMIT');
 const before=inspectResource(path,'file',true);
 if(before) {if(name==='runtime.lock')readRuntimeOwner(path);else assertStateResource(dir,name);}
 const temp=path+'.'+randomUUID()+'.tmp';
 const identity=createPrivateFile(temp,bytes);
 try {
  const current=inspectResource(path,'file',true);
  if(before?(!current||!sameResource(before,current)):current!==null)throw Error('FOREIGN_RESOURCE_CHANGED');
  renameSync(temp,path);
  if(process.platform!=='win32') {
   const fd=openSync(dir,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
   try {fsyncSync(fd);} finally {closeSync(fd);}
  }
  return identity;
 } finally {removeOwnedResource(temp,identity);}
}
export function assertTaskResource(dir:string,platform=process.platform) {
 if(platform!=='win32')throw Error('FOREIGN_TASK_RESOURCE');
 const encoded=readPrivateText(join(dir,'moremote-cli-task.xml'),131072,'utf16le').text;
 const text=encoded.startsWith('\uFEFF')?encoded.slice(1):encoded;
 const marker='Managed by moremote-cli; per-user ownership v1; owner='+createHash('sha256').update(dir).digest('hex');
 if(!text.startsWith('<?xml version="1.0" encoding="UTF-16"?>')||!text.includes('<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">')||!text.includes('<Description>'+marker+'</Description>')||!text.trimEnd().endsWith('</Task>'))throw Error('FOREIGN_TASK_RESOURCE');
}
export function assertStateResource(dir:string,name:string) {
 const path=join(dir,name);
 if(name==='.moremote-cli-owner') {assertStateRoot(dir);return;}
 if(name==='journal.sqlite') {validateJournalPath(path);return;}
 if(/^journal\.sqlite-(wal|shm|journal)$/.test(name)) {validateJournalPath(join(dir,'journal.sqlite'));return;}
 if(name==='runtime.lock'||name==='runtime.json'||name==='runtime.sock') {inspectRuntime(dir);return;}
 if(name==='managed') {
  inspectResource(path,'directory');
  if(readPrivateText(join(path,'.moremote-cli-managed-owner'),128).text!=='MoRemote CLI managed package v1\n')throw Error('FOREIGN_MANAGED_DIRECTORY');return;
 }
 if(/^s\.[0-9a-f]{8}$/.test(name)) {
  const runtime=inspectRuntime(dir);
  if(!runtime.staged||runtime.staged.path!==path)throw Error('RUNTIME_UNPROVEN_STAGE');return;
 }
 if(name==='config.json'||/^config\.json\.[0-9a-f-]{36}\.tmp$/.test(name)) {
  const value:unknown=JSON.parse(readPrivateText(path,CONFIG_BYTES).text);
  if(!object(value)||value.version!==1||typeof value.clientId!=='string'||!value.clientId.startsWith('moremote-cli-')||value.clientId.length>256)throw Error('FOREIGN_CONFIG');return;
 }
 if(/^runtime\.json\.[0-9a-f-]{36}\.tmp$/.test(name)) {readRuntimeRecord(path);return;}
 if(/^runtime\.lock\.[0-9a-f-]{36}\.tmp$/.test(name)) {readRuntimeOwner(path);return;}
 if(name==='moremote-cli-task.xml') {assertTaskResource(dir);return;}
 throw Error('FOREIGN_DATA_DIRECTORY');
}
