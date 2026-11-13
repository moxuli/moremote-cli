import {dirname,join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {privateDirectory,privateManagedDirectory} from './config.js';
import {CONFIG_BYTES} from './resources.js';
import {runtimeHasLiveOwner} from './control.js';
import {managedEntry,stagePackage} from './service.js';
import {packageManaged,packageVersion,compatibleEntry,serviceEntry} from './updater.js';
import {readUpdateState,writeUpdateState,initialUpdateState,updateLock,supervisorRunning,autoUpdateDisabled} from './update-state.js';
import {object} from './limits.js';

export async function supportsLocalEnrollment(entry:string){
 const manifest=object(JSON.parse(await readFile(join(dirname(dirname(entry)),'package.json'),'utf8')));
 const capability=manifest.moremote?object(manifest.moremote):{};
 return capability.localEnrollment===1&&typeof capability.configBytes==='number'&&capability.configBytes>=CONFIG_BYTES&&await compatibleEntry(entry);
}
// Explicit setup may upgrade only this owned CLI, even when automatic updates
// are opted out. Never select an older public package as a feature fallback.
export async function setupServiceEntry(directory:string,currentEntry:string){
 const selected=readUpdateState(directory);
 if(!selected&&!await packageManaged())return currentEntry;
 await privateDirectory(directory);await privateManagedDirectory(join(directory,'managed'));await privateManagedDirectory(join(directory,'managed','versions'));
 await updateLock(directory,async()=>{
  if(supervisorRunning(directory)||runtimeHasLiveOwner(directory))throw Error('STOP_CLI_BEFORE_SETUP');
  let state=readUpdateState(directory);
  let entry=state?await managedEntry(directory,state.active):undefined;
  const capable=entry?await supportsLocalEnrollment(entry):false;
  if(state&&capable&&state.bootstrap===state.active)return;
  if(!entry||!capable){
   const version=await packageVersion();
   try{entry=await stagePackage(directory,version)}catch(error){
    if(error instanceof Error&&error.message.startsWith('FOREIGN_'))throw error;
    throw Error('SETUP_CURRENT_PACKAGE_UNAVAILABLE');
   }
   if(!await supportsLocalEnrollment(entry))throw Error('SETUP_CAPABILITY_REQUIRED');
   if(state){state.previous=state.active;state.active=version}else state=initialUpdateState(version);
   delete state.pending;delete state.pendingManual;delete state.activating;delete state.manualRequired;
  }
  if(!state)throw Error('SETUP_CAPABILITY_REQUIRED');
  // The old bootstrap's compatibility reader cannot promise the enlarged
  // config bound. Retain its immutable package/previous identity, not its loop.
  state.bootstrap=state.active;
  if(autoUpdateDisabled(directory))state.enabled=false;
  writeUpdateState(directory,state);
 });
 return serviceEntry(directory);
}
