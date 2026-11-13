import {mkdirSync,readdirSync,renameSync,openSync,closeSync,fsyncSync,constants} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createPrivateFile,hasCode,inspectResource,readPrivateText,removeOwnedResource,sameResource,type ResourceIdentity} from './resources.js';
import {object,exact,UUID} from './limits.js';
import {DISCOVERY_NAME,descriptorLifetime,descriptorRenewal,type EnrollmentDescriptor,type EnrollmentRecord,type EnrollmentResponse} from './enrollment-protocol.js';
import {validateOrigin} from './config.js';

const marker='.moremote-cli-owner';
const rootMarker='MoRemote CLI discovery v1\n';
function alive(pid:number){try{process.kill(pid,0);return true}catch(error){if(hasCode(error,'ESRCH'))return false;throw error}}
function assertDirectory(path:string,text:string){
 inspectResource(path,'directory');if(readPrivateText(join(path,marker),2048).text!==text)throw Error('FOREIGN_DISCOVERY_DIRECTORY');
}
function directory(path:string,text:string){
 try{mkdirSync(path,{mode:0o700});createPrivateFile(join(path,marker),text)}catch(error){if(!hasCode(error,'EEXIST'))throw error}
 assertDirectory(path,text);
}
function atomic(path:string,value:unknown,limit:number){
 const bytes=JSON.stringify(value);if(Buffer.byteLength(bytes)>limit)throw Error('ENROLLMENT_RESPONSE_LIMIT');
 const before=inspectResource(path,'file',true),temporary=path+'.'+randomUUID()+'.tmp';const identity=createPrivateFile(temporary,bytes);
 try{
  const current=inspectResource(path,'file',true);
  if(before?(!current||!sameResource(before,current)):current!==null)throw Error('DISCOVERY_RESOURCE_CHANGED');
  renameSync(temporary,path);
  if(process.platform!=='win32'){const fd=openSync(dirname(path),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(fd)}finally{closeSync(fd)}}
 }finally{removeOwnedResource(temporary,identity)}
}
function validateDescriptor(path:string,daemon:string){
 const old=object(JSON.parse(readPrivateText(path,4096).text));exact(old,['version','daemonServerId','instanceId','apiOrigin','enabled','measuredAt','expiresAt']);
 if(old.version!==1||old.daemonServerId!==daemon||typeof old.instanceId!=='string'||!UUID.test(old.instanceId)||typeof old.apiOrigin!=='string'||typeof old.enabled!=='boolean'||!Number.isSafeInteger(old.measuredAt)||Number(old.measuredAt)<0||Number(old.expiresAt)!==Number(old.measuredAt)+descriptorLifetime)throw Error('FOREIGN_DISCOVERY_DESCRIPTOR');
 if(validateOrigin(old.apiOrigin,false)!==old.apiOrigin)throw Error('FOREIGN_DISCOVERY_DESCRIPTOR');
}
export function discoveryDirectory(home:string,daemonServerId:string){return join(resolve(home),DISCOVERY_NAME,createHash('sha256').update(daemonServerId,'utf8').digest('hex'))}
export interface DiscoveryOptions {home:string;stateDirectory:string;daemonServerId:string;instanceId?:string;isAlive?:(pid:number)=>boolean}
export class EnrollmentFiles {
 readonly path:string;
 readonly instanceId:string;
 private lock:ResourceIdentity|undefined;
 private measuredAt=-Infinity;
 private enabled:boolean|undefined;
 private readonly hostMarker:string;
 constructor(private options:DiscoveryOptions){
  this.instanceId=options.instanceId??randomUUID();this.path=discoveryDirectory(options.home,options.daemonServerId);
  this.hostMarker=JSON.stringify({owner:'MoRemote CLI discovery host',version:1,daemonServerId:options.daemonServerId,stateDirectory:resolve(options.stateDirectory)})+'\n';
 }
 open(records:EnrollmentRecord[]=[]){
  if(this.lock){this.assertOwner();return}
  const home=resolve(this.options.home),root=join(home,DISCOVERY_NAME),daemon=this.options.daemonServerId;
  inspectResource(home,'directory',false,false);
  directory(root,rootMarker);
  for(const name of readdirSync(root)){if(name===marker)continue;if(!/^[0-9a-f]{64}$/.test(name))throw Error('FOREIGN_DISCOVERY_DIRECTORY');inspectResource(join(root,name),'directory')}
  directory(this.path,this.hostMarker);
  const stages:{path:string;id?:string}[]=[];
  for(const name of readdirSync(this.path)){
   if([marker,'runtime.lock','descriptor.json','requests','responses'].includes(name))continue;
   if(/^descriptor\.json\.[0-9a-f-]{36}\.tmp$/.test(name)&&UUID.test(name.slice(16,-4))){stages.push({path:join(this.path,name)});continue}
   throw Error('FOREIGN_DISCOVERY_RESOURCE');
  }
  for(const child of ['requests','responses']){
   directory(join(this.path,child),'MoRemote CLI discovery '+child+' v1\n');
   for(const name of readdirSync(join(this.path,child))){
    if(name===marker)continue;
    if(child==='responses'&&/^[0-9a-f-]{36}\.json\.[0-9a-f-]{36}\.tmp$/.test(name)&&UUID.test(name.slice(0,36))&&UUID.test(name.slice(42,-4))){stages.push({path:join(this.path,child,name),id:name.slice(0,36)});continue}
    if(!/^[0-9a-f-]{36}\.json$/.test(name)||!UUID.test(name.slice(0,-5)))throw Error('FOREIGN_DISCOVERY_RESOURCE');
    inspectResource(join(this.path,child,name),'file',false,child!=='requests');
   }
  }
  const lockPath=join(this.path,'runtime.lock');
  if(inspectResource(lockPath,'file',true)){
   const previous=readPrivateText(lockPath,2048),owner=object(JSON.parse(previous.text));exact(owner,['owner','version','instanceId','pid','stateDirectory']);
   if(owner.owner!=='MoRemote CLI discovery runtime'||owner.version!==1||typeof owner.instanceId!=='string'||!UUID.test(owner.instanceId)||!Number.isSafeInteger(owner.pid)||Number(owner.pid)<1||Number(owner.pid)>2147483647||owner.stateDirectory!==resolve(this.options.stateDirectory))throw Error('FOREIGN_DISCOVERY_LOCK');
   if((this.options.isAlive??alive)(Number(owner.pid)))throw Error('DISCOVERY_ALREADY_RUNNING');
   if(!removeOwnedResource(lockPath,previous.identity))throw Error('DISCOVERY_RESOURCE_CHANGED');
  }
  this.lock=createPrivateFile(lockPath,JSON.stringify({owner:'MoRemote CLI discovery runtime',version:1,instanceId:this.instanceId,pid:process.pid,stateDirectory:resolve(this.options.stateDirectory)}));
  try{for(const stage of stages){
   if(stage.id)this.responseIdentity(stage.id,records.find(record=>record.request.id===stage.id),stage.path);else validateDescriptor(stage.path,daemon);
   const file=readPrivateText(stage.path,8192);if(!removeOwnedResource(stage.path,file.identity))throw Error('DISCOVERY_RESOURCE_CHANGED');
  }}catch(error){removeOwnedResource(lockPath,this.lock);this.lock=undefined;throw error}
 }
 private assertOwner(){
  if(!this.lock)throw Error('DISCOVERY_NOT_OWNED');
  assertDirectory(join(resolve(this.options.home),DISCOVERY_NAME),rootMarker);
  assertDirectory(this.path,this.hostMarker);
  for(const child of ['requests','responses'])assertDirectory(join(this.path,child),'MoRemote CLI discovery '+child+' v1\n');
  const lock=readPrivateText(join(this.path,'runtime.lock'),2048);
  if(!sameResource(lock.identity,this.lock)||object(JSON.parse(lock.text)).instanceId!==this.instanceId)throw Error('DISCOVERY_RESOURCE_CHANGED');
 }
 publish(enabled:boolean,apiOrigin:string,now:number){
  this.assertOwner();if(now-this.measuredAt<descriptorRenewal&&this.enabled===enabled)return;
  const path=join(this.path,'descriptor.json');
  if(inspectResource(path,'file',true))validateDescriptor(path,this.options.daemonServerId);
  const descriptor:EnrollmentDescriptor={version:1,daemonServerId:this.options.daemonServerId,instanceId:this.instanceId,apiOrigin,enabled,measuredAt:now,expiresAt:now+descriptorLifetime};
  atomic(path,descriptor,4096);this.measuredAt=now;this.enabled=enabled;
 }
 requestNames(){this.assertOwner();return readdirSync(join(this.path,'requests')).filter(name=>name!==marker).sort()}
 readRequest(name:string){
  this.assertOwner();if(!/^[0-9a-f-]{36}\.json$/.test(name)||!UUID.test(name.slice(0,-5)))throw Error('FOREIGN_DISCOVERY_RESOURCE');
  // Official fs.entry.create may use 0644; the enclosing owned directories are 0700.
  const path=join(this.path,'requests',name),before=inspectResource(path,'file',false,false)!;
  const result=readPrivateText(path,4096,'utf8',false);
  if(!sameResource(before,result.identity))throw Error('DISCOVERY_RESOURCE_CHANGED');return result;
 }
 private responseIdentity(id:string,record?:EnrollmentRecord,path=join(this.path,'responses',id+'.json')){
  if(!inspectResource(path,'file',true))return;
  const file=readPrivateText(path,8192),response=object(JSON.parse(file.text));exact(response,['version','id','clientId','daemonServerId','expiresAt','status','offer','code']);
  if(!record||response.version!==1||response.id!==id||response.clientId!==record.request.clientId||response.daemonServerId!==record.request.daemonServerId||response.expiresAt!==record.offer.expiresAt||!['pending','offer','active','disabled','error'].includes(String(response.status))||response.code!==undefined&&(typeof response.code!=='string'||!/^[A-Z0-9_]{1,64}$/.test(response.code)))throw Error('FOREIGN_DISCOVERY_RESPONSE');
  if(response.status==='offer'?JSON.stringify(response.offer)!==JSON.stringify(record.offer):response.offer!==undefined)throw Error('FOREIGN_DISCOVERY_RESPONSE');
  return file.identity;
 }
 assertResponseAvailable(id:string,record?:EnrollmentRecord){this.assertOwner();this.responseIdentity(id,record)}
 writeResponse(record:EnrollmentRecord,response:EnrollmentResponse){this.assertOwner();this.responseIdentity(record.request.id,record);atomic(join(this.path,'responses',record.request.id+'.json'),response,8192)}
 removeResponse(record:EnrollmentRecord){this.assertOwner();const identity=this.responseIdentity(record.request.id,record);if(identity&&!removeOwnedResource(join(this.path,'responses',record.request.id+'.json'),identity))throw Error('DISCOVERY_RESOURCE_CHANGED')}
 removeRequest(name:string,identity:ResourceIdentity){this.assertOwner();if(!removeOwnedResource(join(this.path,'requests',name),identity,'file',false))throw Error('DISCOVERY_RESOURCE_CHANGED')}
 close(records:EnrollmentRecord[]=[]){
  if(!this.lock)return;this.assertOwner();
  try{
   for(const record of records)this.removeResponse(record);
   const descriptor=join(this.path,'descriptor.json');if(inspectResource(descriptor,'file',true)){validateDescriptor(descriptor,this.options.daemonServerId);const file=readPrivateText(descriptor,4096);if(object(JSON.parse(file.text)).instanceId===this.instanceId)removeOwnedResource(descriptor,file.identity)}
  }finally{if(!removeOwnedResource(join(this.path,'runtime.lock'),this.lock))throw Error('DISCOVERY_RESOURCE_CHANGED');this.lock=undefined}
 }
}
