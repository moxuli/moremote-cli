import {basename,dirname,join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {privateDirectory,privateManagedDirectory} from './config.js';
import {managedEntry,stagePackage,command} from './service.js';
import {PACKAGE,CHECK_INTERVAL,exactVersion,initialUpdateState,readUpdateState,writeUpdateState,updateLock,autoUpdateDisabled,disableAutoUpdate} from './update-state.js';
import {inspectResource} from './resources.js';
export {readUpdateState} from './update-state.js';
export async function packageVersion(){const p=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));if(p.name!==PACKAGE)throw Error('UPDATE_IDENTITY_MISMATCH');return exactVersion(p.version)}
export async function packageManaged(){
 const root=dirname(fileURLToPath(new URL('../package.json',import.meta.url)));
 if(basename(root)!=='moremote'||basename(dirname(root))!=='@moxuli'||basename(dirname(dirname(root)))!=='node_modules')return false;
 inspectResource(root,'directory',false,false);inspectResource(join(root,'package.json'),'file',false,false);await packageVersion();return true;
}
export async function compatibleEntry(entry:string){
 const pkg=JSON.parse(await readFile(join(dirname(dirname(entry)),'package.json'),'utf8'));
 return pkg.moremote?.updateProtocol===1&&pkg.moremote?.journalSchema===1&&pkg.moremote?.wireProtocol===1;
}
async function selectCandidate(dir:string,version:string,manual:boolean){
 const state=readUpdateState(dir)!;const entry=await stagePackage(dir,version);
 if(version!==state.active){state.pending=version;state.pendingManual=manual;delete state.manualRequired;
  if(!await compatibleEntry(entry)){state.manualRequired=version;state.error='UPDATE_MANUAL_COMPATIBILITY_REQUIRED'}
 }
 else{delete state.pending;delete state.pendingManual;delete state.manualRequired}
 if(autoUpdateDisabled(dir))state.enabled=false;return state;
}
export async function ensureManaged(dir:string){
 await privateDirectory(dir);await privateManagedDirectory(join(dir,'managed'));await privateManagedDirectory(join(dir,'managed','versions'));
 return updateLock(dir,async()=>{let state=readUpdateState(dir);if(!state){const version=await packageVersion();await stagePackage(dir,version);state=initialUpdateState(version);writeUpdateState(dir,state)}await managedEntry(dir,state.active);return state});
}
export async function queueUpdate(dir:string,version:string){
 exactVersion(version);await ensureManaged(dir);
 return updateLock(dir,async()=>{const before=readUpdateState(dir)!;if(before.activating)throw Error('UPDATE_ACTIVATING');const state=await selectCandidate(dir,version,true);if(state.failed===version)delete state.failed;writeUpdateState(dir,state);return state});
}
export async function setAutoUpdate(dir:string,enabled:boolean){
 if(!readUpdateState(dir))await ensureManaged(dir);
 if(!enabled)disableAutoUpdate(dir);
 try{return await updateLock(dir,async()=>{if(enabled)autoUpdateDisabled(dir,true);const state=readUpdateState(dir)!;state.enabled=enabled;if(!enabled&&!state.pendingManual)delete state.pending;writeUpdateState(dir,state);return state})}
 catch(error){if(!enabled&&error instanceof Error&&error.message==='UPDATE_BUSY')return readUpdateState(dir)!;throw error}
}
// Discovery candidates are stable; compare core numerics without coercing an
// active prerelease patch to NaN. Stable outranks prerelease at the same core.
function newer(candidate:string,active:string){
 const left=candidate.split('.'),right=active.split('-',1)[0].split('.');
 for(let i=0;i<3;i++){if(left[i].length!==right[i].length)return left[i].length>right[i].length;if(left[i]!==right[i])return left[i]>right[i]}
 return active.includes('-');
}
export async function checkForUpdate(dir:string,fetcher:typeof fetch=fetch,now=Date.now()){
 return updateLock(dir,async()=>{
 const state=readUpdateState(dir);if(!state)throw Error('MANAGED_INSTALL_REQUIRED');
 if(!state.enabled||state.activating||state.pending||state.nextCheck!==undefined&&now<state.nextCheck||state.lastCheck!==undefined&&now-state.lastCheck<CHECK_INTERVAL)return state;
 state.lastCheck=now;state.nextCheck=now+CHECK_INTERVAL;delete state.error;writeUpdateState(dir,state);
 try{
  const response=await fetcher('https://registry.npmjs.org/@moxuli%2fmoremote/latest',{signal:AbortSignal.timeout(20000),redirect:'error'});
  if([429,503].includes(response.status)){
   const raw=response.headers.get('retry-after');if(raw){const seconds=/^\d+$/.test(raw)?Number(raw):NaN;const at=Number.isFinite(seconds)?now+Math.min(seconds,86400)*1000:Date.parse(raw);
    if(Number.isFinite(at)&&at>now)state.nextCheck=Math.max(state.nextCheck!,Math.min(at,now+86400000));
   }
  }
  if(!response.ok)throw Error('UPDATE_REGISTRY_UNAVAILABLE');
  const reader=response.body?.getReader();if(!reader)throw Error('UPDATE_REGISTRY_INVALID');const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>262144)throw Error('UPDATE_REGISTRY_LIMIT');chunks.push(item.value)}}finally{await reader.cancel()}
  const pkg=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(pkg.name!==PACKAGE||typeof pkg.version!=='string'||!/^\d+\.\d+\.\d+$/.test(pkg.version))throw Error('UPDATE_IDENTITY_MISMATCH');exactVersion(pkg.version);
  if(newer(pkg.version,state.active)&&pkg.version!==state.failed){const selected=await selectCandidate(dir,pkg.version,false);Object.assign(state,selected)}
 }catch(error){state.error=error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'UPDATE_CHECK_FAILED'}
 if(autoUpdateDisabled(dir))state.enabled=false;writeUpdateState(dir,state);return state;
 });
}
export async function serviceEntry(dir:string){const state=await ensureManaged(dir);const entry=join(dirname(await managedEntry(dir,state.bootstrap)),'moremote-service.js');await command(process.execPath,[entry,'--probe'],true,10000);return entry}
