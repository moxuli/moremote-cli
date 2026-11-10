import { spawn } from 'node:child_process';
import { createHash,randomUUID } from 'node:crypto';
import { join,dirname } from 'node:path';
import { homedir,userInfo } from 'node:os';
import { constants } from 'node:fs';
import { mkdir,readFile,unlink,access,lstat,open,rename,link,mkdtemp,rm } from 'node:fs/promises';
import {privateManagedDirectory} from './config.js';
const taskName='\\MoRemoteCLI';
function xml(s:string){return s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;')}
function systemd(s:string){if(/[\r\n\0]/.test(s))throw Error('INVALID_SERVICE_PATH');return '"'+s.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('%','%%').replaceAll('$',()=> '$$')+'"'}
function windowsArg(s:string){return '"'+s.replace(/(\\*)"/g,'$1$1\\"').replace(/(\\+)$/,'$1$1')+'"'}
export interface ServiceDefinition{path:string;content:string;platform:string;entry:string}
export function serviceDefinition(platform:string,home:string,node:string,entry:string,data:string):ServiceDefinition{
 const marker='Managed by moremote-cli; per-user ownership v1; owner='+createHash('sha256').update(data).digest('hex');
 if(platform==='darwin')return {platform,entry,path:join(home,'Library','LaunchAgents','com.moremote.cli.plist'),content:'<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>com.moremote.cli</string><key>Description</key><string>'+marker+'</string><key>ProgramArguments</key><array>'+[node,entry,'run','--data-dir',data].map(s=>'<string>'+xml(s)+'</string>').join('')+'</array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ProcessType</key><string>Background</string></dict></plist>\n'};
 if(platform==='linux')return {platform,entry,path:join(process.env.XDG_CONFIG_HOME||join(home,'.config'),'systemd','user','moremote-cli.service'),content:'[Unit]\nDescription='+marker+'\n[Service]\nExecStart='+[node,entry,'run','--data-dir',data].map(systemd).join(' ')+'\nRestart=on-failure\nRestartSec=5\n[Install]\nWantedBy=default.target\n'};
 if(platform==='win32')return {platform,entry,path:join(data,'moremote-cli-task.xml'),content:'<?xml version="1.0" encoding="UTF-16"?><Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><RegistrationInfo><Description>'+marker+'</Description></RegistrationInfo><Triggers><LogonTrigger><UserId>'+xml(userInfo().username)+'</UserId><Enabled>true</Enabled></LogonTrigger></Triggers><Principals><Principal id="CurrentUser"><UserId>'+xml(userInfo().username)+'</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals><Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><Enabled>true</Enabled></Settings><Actions Context="CurrentUser"><Exec><Command>'+xml(node)+'</Command><Arguments>'+xml([entry,'run','--data-dir',data].map(windowsArg).join(' '))+'</Arguments></Exec></Actions></Task>'};
 throw Error('UNSUPPORTED_SERVICE_PLATFORM');
}
class CommandFailure extends Error{
 constructor(readonly program:string,readonly status:number|null,readonly output:string){super('COMMAND_FAILED_'+program+'_'+status)}
}
export function command(program:string,args:string[],capture=true):Promise<string>{
 const {promise,resolve,reject}=Promise.withResolvers<string>();
 const child=spawn(program,args,{stdio:capture?['ignore','pipe','pipe']:'inherit',shell:false,windowsHide:true});
 let output='',tooLarge=false;
 if(capture)for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>{
  output+=chunk;if(output.length>65536){tooLarge=true;child.kill()}
 });
 child.once('error',reject);
 child.once('close',code=>tooLarge?reject(Error('COMMAND_OUTPUT_LIMIT')):code===0?resolve(output):reject(new CommandFailure(program,code,output)));
 return promise;
}
function missing(error:unknown){return error instanceof Error&&'code' in error&&error.code==='ENOENT'}
function marker(def:ServiceDefinition){
 const value=def.content.match(/Managed by moremote-cli; per-user ownership v1; owner=[0-9a-f]{64}/)?.[0];
 if(!value)throw Error('INVALID_SERVICE_DEFINITION');return value;
}
async function ownedFile(def:ServiceDefinition){
 let stat;
 try{stat=await lstat(def.path)}catch(error){if(missing(error))return undefined;throw error}
 if(!stat.isFile()||stat.isSymbolicLink()||(process.getuid&&stat.uid!==process.getuid()))throw Error('FOREIGN_SERVICE_FILE');
 const handle=await open(def.path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const actual=await handle.stat();
  if(actual.dev!==stat.dev||actual.ino!==stat.ino)throw Error('FOREIGN_SERVICE_FILE');
  const content=await handle.readFile(def.platform==='win32'?'utf16le':'utf8');
  if(!content.includes(marker(def)))throw Error('FOREIGN_SERVICE_FILE');
  return {dev:stat.dev,ino:stat.ino,content};
 }finally{await handle.close()}
}
export interface ServiceStatus{owned:boolean;registration:'registered'|'absent'|'unknown';error?:string}
const windowsQuery="$ErrorActionPreference='Stop'; try { $task=Get-ScheduledTask -TaskName 'MoRemoteCLI' -TaskPath '\\' -ErrorAction Stop; Export-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath } catch { if ($_.CategoryInfo.Category -eq 'ObjectNotFound') { exit 3 }; exit 1 }";
function xmlValue(content:string,element:string){
 const value=content.match(new RegExp('<'+element+'(?:\\s[^>]*)?>([\\s\\S]*?)</'+element+'>'))?.[1];
 return value?.replaceAll('&quot;','"').replaceAll('&apos;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
}
async function registration(def:ServiceDefinition,content:string|undefined):Promise<'registered'|'absent'>{
 if(def.platform==='darwin'){
  let raw:string;
  try{raw=await command('launchctl',['print','gui/'+process.getuid!()+'/com.moremote.cli'],true)}
  catch(error){
   if(error instanceof CommandFailure&&error.status===113&&/Could not find service/.test(error.output))return 'absent';
   throw error;
  }
  const path=raw.match(/^\s*path = (.+)\s*$/m)?.[1]?.trim();
  if(path!==def.path)throw Error('FOREIGN_SERVICE_REGISTRATION');
 }else if(def.platform==='linux'){
  const raw=await command('systemctl',['--user','show','moremote-cli.service','--property=FragmentPath,LoadState,ActiveState'],true);
  const path=raw.match(/^FragmentPath=(.*)$/m)?.[1],load=raw.match(/^LoadState=(.*)$/m)?.[1];
  if(path===''&&load==='not-found')return 'absent';
  if(path!==def.path)throw Error(path?'FOREIGN_SERVICE_REGISTRATION':'SERVICE_MANAGER_INVALID_RESPONSE');
 }else if(def.platform==='win32'){
  let raw:string;
  try{raw=await command('powershell.exe',['-NoProfile','-NonInteractive','-Command',windowsQuery],true)}
  catch(error){if(error instanceof CommandFailure&&error.status===3)return 'absent';throw error}
  const expected=content??def.content;
  if(!raw.includes(marker(def))||!xmlValue(raw,'Command')||xmlValue(raw,'Command')!==xmlValue(expected,'Command')||xmlValue(raw,'Arguments')!==xmlValue(expected,'Arguments'))throw Error('FOREIGN_SERVICE_REGISTRATION');
 }else throw Error('UNSUPPORTED_SERVICE_PLATFORM');
 return 'registered';
}
export async function serviceStatus(def:ServiceDefinition):Promise<ServiceStatus>{
 const file=await ownedFile(def);
 try{return {owned:!!file,registration:await registration(def,file?.content)}}
 catch(error){
  if(error instanceof Error&&(error.message.startsWith('FOREIGN_')||error.message==='UNSUPPORTED_SERVICE_PLATFORM'))throw error;
  return {owned:!!file,registration:'unknown',error:missing(error)?'SERVICE_MANAGER_UNAVAILABLE':'SERVICE_MANAGER_FAILED'};
 }
}
function requireKnown(status:ServiceStatus){
 if(status.registration==='unknown')throw Error('SERVICE_MANAGER_UNKNOWN');
 if(status.registration==='registered'&&!status.owned)throw Error('FOREIGN_SERVICE_REGISTRATION');
}
async function writeDefinition(def:ServiceDefinition){
 const original=await ownedFile(def);
 await mkdir(dirname(def.path),{recursive:true,mode:0o700});
 const temp=def.path+'.'+randomUUID()+'.tmp';
 const handle=await open(temp,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
 try{
  try{await handle.writeFile(def.content,def.platform==='win32'?'utf16le':'utf8');await handle.sync()}finally{await handle.close()}
  const current=await ownedFile(def);
  if(original){
   if(!current||current.dev!==original.dev||current.ino!==original.ino||current.content!==original.content)throw Error('SERVICE_FILE_CHANGED');
   await rename(temp,def.path);
  }else{
   if(current)throw Error('SERVICE_FILE_CHANGED');
   // Atomic no-clobber publication for an absent destination; replacement above
   // uses rename only after checking the existing owned file.
   await link(temp,def.path);
  }
 }finally{await rm(temp,{force:true})}
}
export async function installService(def:ServiceDefinition){
 const status=await serviceStatus(def);requireKnown(status);
 await access(def.entry);
 if(status.registration==='registered')await stopService(def);
 await writeDefinition(def);
 if(def.platform==='darwin')await command('launchctl',['bootstrap','gui/'+process.getuid!(),def.path]);
 else if(def.platform==='linux'){
  await command('systemctl',['--user','daemon-reload']);
  await command('systemctl',['--user','enable','--now','moremote-cli.service']);
 }else await command('schtasks',['/Create','/TN',taskName,'/XML',def.path,'/F']);
}
export async function stopService(def:ServiceDefinition){
 const status=await serviceStatus(def);requireKnown(status);
 if(status.registration==='absent')return;
 if(def.platform==='darwin')await command('launchctl',['bootout','gui/'+process.getuid!()+'/com.moremote.cli']);
 else if(def.platform==='linux')await command('systemctl',['--user','stop','moremote-cli.service']);
 else await command('schtasks',['/End','/TN',taskName]);
}
export async function removeService(def:ServiceDefinition){
 const status=await serviceStatus(def);requireKnown(status);
 if(status.registration==='registered'){
  if(def.platform==='linux')await command('systemctl',['--user','disable','--now','moremote-cli.service']);
  else if(def.platform==='darwin')await stopService(def);
  else await command('schtasks',['/Delete','/TN',taskName,'/F']);
 }
 if(!status.owned)return;
 if(!await ownedFile(def))throw Error('SERVICE_FILE_CHANGED');
 await unlink(def.path);
 if(def.platform==='linux')await command('systemctl',['--user','daemon-reload']);
}
function exactVersion(version:string){
 if(!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(version))throw Error('EXACT_VERSION_REQUIRED');
}
async function directory(path:string){
 const stat=await lstat(path);
 if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('FOREIGN_MANAGED_DIRECTORY');
}
async function regular(path:string){
 const stat=await lstat(path);
 if(!stat.isFile()||stat.isSymbolicLink())throw Error('INVALID_MANAGED_INSTALL');
}
async function verifiedEntry(prefix:string,version:string){
 for(const path of [prefix,join(prefix,'node_modules'),join(prefix,'node_modules','moremote-cli')])await directory(path);
 const root=join(prefix,'node_modules','moremote-cli'),manifest=join(root,'package.json');
 await regular(manifest);
 const pkg:unknown=JSON.parse(await readFile(manifest,'utf8'));
 if(typeof pkg!=='object'||pkg===null||!('name' in pkg)||pkg.name!=='moremote-cli'||!('version' in pkg)||pkg.version!==version)throw Error('UPDATE_IDENTITY_MISMATCH');
 for(const path of [join(root,'bin'),join(root,'dist')])await directory(path);
 const entry=join(root,'bin','moremote-cli.js');
 await regular(entry);await regular(join(root,'dist','cli.js'));return entry;
}
export async function managedEntry(dir:string,version:string){
 exactVersion(version);
 await directory(join(dir,'managed'));await directory(join(dir,'managed','versions'));
 return verifiedEntry(join(dir,'managed','versions',version),version);
}
export async function updatePackage(dir:string,version:string){
 exactVersion(version);
 const managed=join(dir,'managed'),versions=join(managed,'versions'),destination=join(versions,version);
 await privateManagedDirectory(managed);await privateManagedDirectory(versions);
 let exists=true;
 try{await lstat(destination)}catch(error){if(missing(error))exists=false;else throw error}
 if(exists)return managedEntry(dir,version);
 const candidates=[process.env.npm_execpath,join(dirname(process.execPath),'node_modules','npm','bin','npm-cli.js'),join(dirname(process.execPath),'..','lib','node_modules','npm','bin','npm-cli.js')].filter((p):p is string=>!!p&&p.endsWith('npm-cli.js'));
 let npmCli:string|undefined;
 for(const path of candidates){try{await access(path);npmCli=path;break}catch{}}
 if(!npmCli)throw Error('NPM_CLI_NOT_FOUND');
 const staging=await mkdtemp(join(versions,'.install-'));
 try{
  await command(process.execPath,[npmCli,'install','--prefix',staging,'--ignore-scripts','--no-audit','--no-fund','--save-exact','--registry=https://registry.npmjs.org','moremote-cli@'+version]);
  await verifiedEntry(staging,version);
  await rename(staging,destination);
  return managedEntry(dir,version);
 }finally{await rm(staging,{recursive:true,force:true})}
}
export function currentDefinition(entry:string,dir:string){return serviceDefinition(process.platform,homedir(),process.execPath,entry,dir)}
