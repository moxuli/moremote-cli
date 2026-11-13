import {homedir} from 'node:os';
import {resolve} from 'node:path';
import {loadConfig,saveConfig,privateDirectory,validateOrigin,type Config} from './config.js';
import {DEFAULT_API_ORIGIN} from './local-enrollment.js';
import {ownRuntime} from './control.js';

export interface SetupDependencies {
 yes:boolean;home?:string;
 stopOwned:()=>Promise<void>;
 authenticate:(config:Config)=>Promise<{serverId:string}>;
 prepare?:()=>Promise<void>;
 install:()=>Promise<void>;
}
// Lifecycle and identity I/O are injectable: consumer tests never register a
// service or touch the real home. Callers must use the owned lifecycle adapters.
export async function setupEnrollment(directory:string,dependencies:SetupDependencies){
 if(!dependencies.yes)throw Error('EXPLICIT_YES_REQUIRED');
 await dependencies.stopOwned();
 // Preparation can stage an owned managed version, but never reads or writes
 // enrollment configuration. A concurrent run wins safely before we claim it.
 await dependencies.prepare?.();
 await privateDirectory(directory);
 let cancelled=false;
 const release=await ownRuntime(directory,()=>({stage:'setup'}),()=>{cancelled=true});
 let config:Config;
 try{
  config=await loadConfig(directory);
  const origin=validateOrigin(config.apiOrigin??DEFAULT_API_ORIGIN,false);
  const identity=await dependencies.authenticate(config);
  if(cancelled)throw Error('SETUP_CANCELLED');
  if(!identity.serverId||Buffer.byteLength(identity.serverId)>512||config.daemonServerId&&config.daemonServerId!==identity.serverId||config.pairs.some(pair=>pair.revokedAt===undefined&&pair.relayRetiredAt===undefined&&pair.daemonServerId&&pair.daemonServerId!==identity.serverId))throw Error('DAEMON_IDENTITY_CHANGED');
  config.apiOrigin=origin;config.cloudEnabled=true;config.daemonServerId=identity.serverId;
  config.localEnrollment={home:resolve(dependencies.home??homedir())};
  await saveConfig(directory,config);
 }finally{await release()}
 await dependencies.install();
 return config;
}
