import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,readdirSync,renameSync,openSync,closeSync,fsyncSync,constants} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {createPrivateFile,hasCode,inspectResource,readPrivateText,removeOwnedResource,sameResource} from './resources.js';
import {exact,object,UUID} from './limits.js';
import {descriptorLifetime} from './enrollment-protocol.js';

const marker='.moremote-cli-owner';
export interface ActivityCapabilities {version:1;daemonServerId:string;instanceId:string;measuredAt:number;expiresAt:number;titleHints:1}
export function activityCapabilitiesDirectory(home:string,daemon:string) {
 return join(resolve(home),'.moremote-cli-activity',createHash('sha256').update(daemon,'utf8').digest('hex'));
}
function directory(path:string,owner:string,create=true) {
 if(create)try{mkdirSync(path,{mode:0o700});createPrivateFile(join(path,marker),owner)}catch(error){if(!hasCode(error,'EEXIST'))throw error}
 inspectResource(path,'directory');
 if(readPrivateText(join(path,marker),2048).text!==owner)throw Error('FOREIGN_ACTIVITY_CAPABILITIES_DIRECTORY');
}
function document(path:string,daemon:string) {
 const file=readPrivateText(path,4096),value=object(JSON.parse(file.text));
 exact(value,['version','daemonServerId','instanceId','measuredAt','expiresAt','titleHints']);
 if(value.version!==1||value.daemonServerId!==daemon||typeof value.instanceId!=='string'||!UUID.test(value.instanceId)
  ||value.titleHints!==1||!Number.isSafeInteger(value.measuredAt)||Number(value.measuredAt)<0
  ||!Number.isSafeInteger(value.expiresAt)||Number(value.expiresAt)!==Number(value.measuredAt)+descriptorLifetime)throw Error('FOREIGN_ACTIVITY_CAPABILITIES');
 return {value:value as unknown as ActivityCapabilities,identity:file.identity};
}

/** Called only while the enrollment runtime owns its existing exclusive daemon lock. */
export class ActivityCapabilityFiles {
 private path?:string;
 constructor(private home:string,private stateDirectory:string,private daemon:string,private instanceId:string){}
 private hostMarker(){return JSON.stringify({owner:'MoRemote CLI activity capabilities host',version:1,daemonServerId:this.daemon,stateDirectory:resolve(this.stateDirectory)})+'\n'}
 publish(now:number) {
  const root=join(resolve(this.home),'.moremote-cli-activity'),path=activityCapabilitiesDirectory(this.home,this.daemon);
  directory(root,'MoRemote CLI activity capabilities v1\n');
  for(const name of readdirSync(root)){
   if(name===marker)continue;
   if(!/^[0-9a-f]{64}$/.test(name))throw Error('FOREIGN_ACTIVITY_CAPABILITIES_DIRECTORY');
   inspectResource(join(root,name),'directory');
  }
  directory(path,this.hostMarker());
  for(const name of readdirSync(path)){
   if(name===marker||name==='capabilities.json')continue;
   const match=/^capabilities\.json\.([0-9a-f-]{36})\.tmp$/.exec(name);
   if(!match||!UUID.test(match[1]))throw Error('FOREIGN_ACTIVITY_CAPABILITIES_RESOURCE');
   const stage=join(path,name),file=document(stage,this.daemon);
   if(!removeOwnedResource(stage,file.identity))throw Error('DISCOVERY_RESOURCE_CHANGED');
  }
  this.path=join(path,'capabilities.json');
  const before=inspectResource(this.path,'file',true);
  if(before)document(this.path,this.daemon);
  const value:ActivityCapabilities={version:1,daemonServerId:this.daemon,instanceId:this.instanceId,measuredAt:now,expiresAt:now+descriptorLifetime,titleHints:1};
  const temporary=this.path+'.'+randomUUID()+'.tmp',identity=createPrivateFile(temporary,JSON.stringify(value));
  try{
   const current=inspectResource(this.path,'file',true);
   if(before?(!current||!sameResource(before,current)):current!==null)throw Error('DISCOVERY_RESOURCE_CHANGED');
   renameSync(temporary,this.path);
   if(process.platform!=='win32'){const fd=openSync(dirname(this.path),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(fd)}finally{closeSync(fd)}}
  }finally{removeOwnedResource(temporary,identity)}
 }
 close(){
  if(!this.path)return;
  directory(join(resolve(this.home),'.moremote-cli-activity'),'MoRemote CLI activity capabilities v1\n',false);
  directory(dirname(this.path),this.hostMarker(),false);
  if(!inspectResource(this.path,'file',true))return;
  const file=document(this.path,this.daemon);
  if(file.value.instanceId!==this.instanceId)return;
  if(!removeOwnedResource(this.path,file.identity))throw Error('DISCOVERY_RESOURCE_CHANGED');
 }
}
