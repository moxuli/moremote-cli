import {join} from 'node:path';
import {openSync,closeSync,fsyncSync,renameSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {privateManagedDirectory} from './config.js';
import {managedRoot} from './update-state.js';
import {inspectResource,readPrivateText,createPrivateFile,removeOwnedResource,sameResource,type ResourceIdentity,type RuntimeOwner} from './resources.js';
const OWNER='MoRemote CLI control transport';
interface Descriptor {owner:typeof OWNER;version:1;framing:'json-lines-v1';instanceId:string;pid:number;startedAt:number;tokenHash:string}
function readDescriptor(dir:string){
 if(!inspectResource(join(dir,'managed'),'directory',true))return null;
 const root=managedRoot(dir),path=join(root,'runtime-transport.json');if(!inspectResource(path,'file',true))return null;
 const file=readPrivateText(path,2048);let value:Descriptor;
 try{value=JSON.parse(file.text)}catch{throw Error('INVALID_CONTROL_TRANSPORT')}
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==7||value.owner!==OWNER||value.version!==1||value.framing!=='json-lines-v1'||typeof value.instanceId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.instanceId)||!Number.isSafeInteger(value.pid)||value.pid<1||value.pid>2147483647||!Number.isSafeInteger(value.startedAt)||value.startedAt<1||typeof value.tokenHash!=='string'||!/^[0-9a-f]{64}$/.test(value.tokenHash))throw Error('INVALID_CONTROL_TRANSPORT');
 return {...file,value};
}
function matches(value:Descriptor,owner:RuntimeOwner){return value.instanceId===owner.instanceId&&value.pid===owner.pid&&value.startedAt===owner.startedAt&&value.tokenHash===createHash('sha256').update(owner.token).digest('hex')}
export function controlFraming(dir:string,owner:RuntimeOwner):'legacy-eof'|'json-lines-v1'{
 const descriptor=readDescriptor(dir);return descriptor&&matches(descriptor.value,owner)?'json-lines-v1':'legacy-eof';
}
export async function publishControlTransport(dir:string,owner:RuntimeOwner){
 // Nested managed resources are understood/ignored by the published 0.1.0
 // root reader; its exact six/seven-key runtime lock/record stays unchanged.
 await privateManagedDirectory(join(dir,'managed'));const root=managedRoot(dir),path=join(root,'runtime-transport.json'),before=readDescriptor(dir);
 const value:Descriptor={owner:OWNER,version:1,framing:'json-lines-v1',instanceId:owner.instanceId,pid:owner.pid,startedAt:owner.startedAt,tokenHash:createHash('sha256').update(owner.token).digest('hex')};
 const temp=path+'.'+randomUUID()+'.tmp',identity=createPrivateFile(temp,JSON.stringify(value)+'\n');
 try{
  const current=readDescriptor(dir);if(before?(!current||!sameResource(before.identity,current.identity)||before.text!==current.text):current!==null)throw Error('CONTROL_TRANSPORT_CHANGED');
  renameSync(temp,path);if(process.platform!=='win32'){const fd=openSync(root,'r');try{fsyncSync(fd)}finally{closeSync(fd)}}return identity;
 }finally{removeOwnedResource(temp,identity)}
}
export function removeControlTransport(dir:string,identity:ResourceIdentity,owner:RuntimeOwner){
 try{const current=readDescriptor(dir);if(!current||!sameResource(current.identity,identity)||!matches(current.value,owner))return false;return removeOwnedResource(join(managedRoot(dir),'runtime-transport.json'),identity)}catch{return false}
}
