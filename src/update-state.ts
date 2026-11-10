import {join} from 'node:path';
import {openSync,closeSync,fsyncSync,renameSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {assertStateRoot,inspectResource,readPrivateText,createPrivateFile,removeOwnedResource,hasCode} from './resources.js';
export const PACKAGE='@moxuli/moremote';
export const CHECK_INTERVAL=6*60*60*1000;
const OWNER='MoRemote CLI updater v1';
export interface UpdateState {owner:typeof OWNER;enabled:boolean;active:string;bootstrap:string;previous?:string;pending?:string;pendingManual?:boolean;activating?:string;failed?:string;manualRequired?:string;lastCheck?:number;nextCheck?:number;error?:string}
export function exactVersion(value:string){if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?$/.test(value))throw Error('EXACT_VERSION_REQUIRED');return value}
export function managedRoot(dir:string){assertStateRoot(dir);const root=join(dir,'managed');inspectResource(root,'directory');if(readPrivateText(join(root,'.moremote-cli-managed-owner'),128).text!=='MoRemote CLI managed package v1\n')throw Error('FOREIGN_MANAGED_DIRECTORY');return root}
export function readUpdateState(dir:string):UpdateState|undefined{
 let root;try{root=managedRoot(dir)}catch(error){if(hasCode(error,'ENOENT'))return;throw error}
 const path=join(root,'update.json');if(!inspectResource(path,'file',true))return;
 const s=JSON.parse(readPrivateText(path,8192).text) as UpdateState;
 if(s.owner!==OWNER||typeof s.enabled!=='boolean'||typeof s.active!=='string'||typeof s.bootstrap!=='string')throw Error('INVALID_UPDATE_STATE');
 for(const v of [s.active,s.bootstrap,s.previous,s.pending,s.activating,s.failed,s.manualRequired])if(v!==undefined)exactVersion(v);
 if(s.lastCheck!==undefined&&(!Number.isSafeInteger(s.lastCheck)||s.lastCheck<0)||s.nextCheck!==undefined&&(!Number.isSafeInteger(s.nextCheck)||s.nextCheck<0)||s.error!==undefined&&(typeof s.error!=='string'||!/^[A-Z0-9_]+$/.test(s.error))||s.pendingManual!==undefined&&typeof s.pendingManual!=='boolean')throw Error('INVALID_UPDATE_STATE');if(autoUpdateDisabled(dir))s.enabled=false;return s;
}
export function initialUpdateState(version:string):UpdateState{return {owner:OWNER,enabled:true,active:exactVersion(version),bootstrap:version}}
function syncDirectory(root:string){if(process.platform==='win32')return;const fd=openSync(root,'r');try{fsyncSync(fd)}finally{closeSync(fd)}}
export function writeUpdateState(dir:string,state:UpdateState){
 const root=managedRoot(dir),path=join(root,'update.json');readUpdateState(dir);
 const temp=path+'.'+randomUUID()+'.tmp',identity=createPrivateFile(temp,JSON.stringify(state)+'\n');
 try{renameSync(temp,path);syncDirectory(root)}finally{removeOwnedResource(temp,identity)}
}
export async function updateLock<T>(dir:string,work:()=>Promise<T>,name='writer'):Promise<T>{
 const root=managedRoot(dir),path=join(root,name+'.lock');
 const old=inspectResource(path,'file',true);
 if(old){const value=JSON.parse(readPrivateText(path,2048).text);if(value.owner!==OWNER||!Number.isSafeInteger(value.pid)||value.pid<1||typeof value.nonce!=='string')throw Error('FOREIGN_UPDATE_LOCK');
  try{process.kill(value.pid,0);throw Error('UPDATE_BUSY')}catch(error){if(!hasCode(error,'ESRCH'))throw error}
  if(!removeOwnedResource(path,old))throw Error('UPDATE_BUSY');
 }
 let identity;try{identity=createPrivateFile(path,JSON.stringify({owner:OWNER,pid:process.pid,nonce:randomUUID()})+'\n')}catch(error){if(hasCode(error,'EEXIST'))throw Error('UPDATE_BUSY');throw error}
 try{return await work()}finally{if(!removeOwnedResource(path,identity))throw Error('UPDATE_LOCK_CHANGED')}
}
export function supervisorRunning(dir:string){
 const root=managedRoot(dir),path=join(root,'supervisor.lock'),stat=inspectResource(path,'file',true);if(!stat)return false;
 const value=JSON.parse(readPrivateText(path,2048).text);if(value.owner!==OWNER||!Number.isSafeInteger(value.pid)||value.pid<1||typeof value.nonce!=='string')throw Error('FOREIGN_UPDATE_LOCK');
 try{process.kill(value.pid,0);return true}catch(error){if(hasCode(error,'ESRCH'))return false;throw error}
}
export function supervisorStopRequested(dir:string,clear=false){
 const path=join(managedRoot(dir),'stop-request'),stat=inspectResource(path,'file',true);if(!stat)return false;
 if(readPrivateText(path,128).text!==OWNER+'\n')throw Error('FOREIGN_UPDATE_STOP');
 if(clear&&!removeOwnedResource(path,stat))throw Error('UPDATE_STOP_CHANGED');return true;
}
export function requestSupervisorStop(dir:string){
 if(!readUpdateState(dir))return;
 if(supervisorStopRequested(dir))return;
 try{createPrivateFile(join(managedRoot(dir),'stop-request'),OWNER+'\n')}catch(error){if(!hasCode(error,'EEXIST'))throw error;supervisorStopRequested(dir)}
}
export function autoUpdateDisabled(dir:string,clear=false){
 const path=join(managedRoot(dir),'auto-disabled'),stat=inspectResource(path,'file',true);if(!stat)return false;
 if(readPrivateText(path,128).text!==OWNER+'\n')throw Error('FOREIGN_UPDATE_POLICY');
 if(clear){if(!removeOwnedResource(path,stat))throw Error('UPDATE_POLICY_CHANGED');syncDirectory(managedRoot(dir))}return true;
}
export function disableAutoUpdate(dir:string){
 if(autoUpdateDisabled(dir))return;
 try{createPrivateFile(join(managedRoot(dir),'auto-disabled'),OWNER+'\n');syncDirectory(managedRoot(dir))}catch(error){if(!hasCode(error,'EEXIST'))throw error;autoUpdateDisabled(dir)}
}
