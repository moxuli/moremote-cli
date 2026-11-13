import { homedir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { mkdir, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { decode } from './crypto.js';
import { UUID,LIMITS } from './limits.js';
import type {OperationJournal} from './journal.js';
import {CONFIG_BYTES,assertStateRoot,assertStateResource,inspectResource,readPrivateText,createPrivateFile,writePrivateAtomic} from './resources.js';
import {validateEnrollmentRecords,requestFingerprint,type EnrollmentRecord} from './enrollment-protocol.js';
export interface Pair{pairId:string;rootKey:string;hostToken:string;apiOrigin?:string;enrollmentToken?:string;expiresAt?:number;active:boolean;claimId?:string;phoneTokenHash?:string;activationProof?:unknown;daemonServerId?:string;revokedAt?:number;relayRetiredAt?:number;automaticClientId?:string;automaticRequestId?:string}
export interface Config{version:1;clientId:string;target?:string;paseoHome:string;apiOrigin?:string;allowLoopbackHttp:boolean;cloudEnabled:boolean;daemonServerId?:string;pairs:Pair[];localEnrollment?:{home:string};enrollmentRequests?:EnrollmentRecord[]}
export function dataDirectory(env=process.env,platform=process.platform,home=homedir()){return resolve(env.MOREMOTE_CLI_HOME|| (platform==='win32'?join(env.LOCALAPPDATA||join(home,'AppData','Local'),'MoRemoteCLI'):platform==='darwin'?join(home,'Library','Application Support','MoRemoteCLI'):join(env.XDG_STATE_HOME||join(home,'.local','state'),'moremote-cli')))}
export function validateOrigin(value:string,allowLoopback:boolean){const u=new URL(value);if(u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('INVALID_API_ORIGIN');if(u.protocol!=='https:'&&!(allowLoopback&&u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw Error('HTTPS_REQUIRED');return u.origin}
const ownerFile='.moremote-cli-owner';
const ownerText='MoRemote CLI state v1\n';
const managedFile='.moremote-cli-managed-owner';
const managedText='MoRemote CLI managed package v1\n';
async function assertManagedDirectory(dir:string){inspectResource(dir,'directory');if(readPrivateText(join(dir,managedFile),128).text!==managedText)throw Error('FOREIGN_MANAGED_DIRECTORY')}
export async function privateManagedDirectory(dir:string){await mkdir(dir,{recursive:true,mode:0o700});inspectResource(dir,'directory');const names=await readdir(dir);if(!names.includes(managedFile)){if(names.length)throw Error('FOREIGN_MANAGED_DIRECTORY');createPrivateFile(join(dir,managedFile),managedText)}await assertManagedDirectory(dir)}
export async function assertOwnedDirectory(dir:string){inspectResource(dir,'directory');try{assertStateRoot(dir)}catch{throw Error('FOREIGN_DATA_DIRECTORY')}for(const name of await readdir(dir))assertStateResource(dir,name)}
export async function privateDirectory(dir:string){await mkdir(dir,{recursive:true,mode:0o700});inspectResource(dir,'directory');const names=await readdir(dir);if(!names.includes(ownerFile)){if(names.length)throw Error('FOREIGN_DATA_DIRECTORY');createPrivateFile(join(dir,ownerFile),ownerText)}await assertOwnedDirectory(dir)}
export async function atomicJson(path:string,value:unknown){writePrivateAtomic(path,value)}
export async function loadConfig(dir:string):Promise<Config>{
 let raw:string;try{assertStateRoot(dir);raw=readPrivateText(join(dir,'config.json'),CONFIG_BYTES).text}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;return {version:1,clientId:'moremote-cli-'+randomUUID(),paseoHome:process.env.PASEO_HOME||join(homedir(),'.paseo'),allowLoopbackHttp:false,cloudEnabled:false,pairs:[]}}
 if(Buffer.byteLength(raw)>CONFIG_BYTES)throw Error('CONFIG_LIMIT');const c=JSON.parse(raw) as Config;
 if(c.version!==1||typeof c.clientId!=='string'||!c.clientId.startsWith('moremote-cli-')||c.clientId.length>256||typeof c.paseoHome!=='string'||!c.paseoHome||c.paseoHome.length>4096||c.target!==undefined&&(typeof c.target!=='string'||!c.target||c.target.length>16384)||!Array.isArray(c.pairs)||c.pairs.length>16||typeof c.cloudEnabled!=='boolean'||typeof c.allowLoopbackHttp!=='boolean')throw Error('INVALID_CONFIG');
 if(c.apiOrigin)c.apiOrigin=validateOrigin(c.apiOrigin,c.allowLoopbackHttp);
 if(c.localEnrollment&&(typeof c.localEnrollment.home!=='string'||!c.localEnrollment.home||c.localEnrollment.home.length>4096||resolve(c.localEnrollment.home)!==c.localEnrollment.home))throw Error('INVALID_ENROLLMENT_HOME');
 if(c.enrollmentRequests!==undefined){
  validateEnrollmentRecords(c.enrollmentRequests);
  for(const record of c.enrollmentRequests){
   validateOrigin(record.offer.apiOrigin,false);const pair=c.pairs.find(pair=>pair.pairId===record.pairId);
   if(!pair||pair.automaticClientId!==record.request.clientId||pair.automaticRequestId!==record.request.id||pair.daemonServerId!==record.request.daemonServerId||pair.rootKey!==record.offer.rootKey||pair.apiOrigin!==record.offer.apiOrigin||pair.expiresAt!==record.offer.expiresAt||JSON.parse(record.createBytes).hostTokenHash!==requestFingerprint(pair.hostToken)||pair.enrollmentToken!==undefined&&pair.enrollmentToken!==record.offer.enrollmentToken)throw Error('INVALID_ENROLLMENT_RECORD');
  }
 }
 for(const pair of c.pairs)if(pair.automaticClientId!==undefined&&!UUID.test(pair.automaticClientId))throw Error('INVALID_AUTOMATIC_CLIENT');
 for(const pair of c.pairs)if(pair.automaticRequestId!==undefined&&!UUID.test(pair.automaticRequestId))throw Error('INVALID_AUTOMATIC_REQUEST');
 const identities=new Set<string>();for(const p of c.pairs){if(!UUID.test(p.pairId)||identities.has(p.pairId)||typeof p.active!=='boolean'||p.expiresAt!==undefined&&(!Number.isSafeInteger(p.expiresAt)||p.expiresAt<0)||p.revokedAt!==undefined&&(!Number.isSafeInteger(p.revokedAt)||p.revokedAt<0)||p.relayRetiredAt!==undefined&&(!Number.isSafeInteger(p.relayRetiredAt)||p.relayRetiredAt<0))throw Error('INVALID_PAIR');identities.add(p.pairId);decode(p.rootKey,32);decode(p.hostToken,32);if(p.apiOrigin)p.apiOrigin=validateOrigin(p.apiOrigin,c.allowLoopbackHttp)}return c;
}
export async function saveConfig(dir:string,config:Config){const a=resolve(dir),b=resolve(config.paseoHome);const left=process.platform==='win32'?a.toLowerCase():a,right=process.platform==='win32'?b.toLowerCase():b;if(left===right||left.startsWith(right+sep)||right.startsWith(left+sep))throw Error('OFFICIAL_DATA_OVERLAP');await privateDirectory(dir);await atomicJson(join(dir,'config.json'),config)}
export function pruneRetiredPairs(config:Config,now=Date.now(),journal?:OperationJournal){const before=config.pairs.length;config.pairs=config.pairs.filter(p=>{if(config.enrollmentRequests?.some(record=>record.pairId===p.pairId))return true;const retiredAt=p.revokedAt===undefined?p.relayRetiredAt:Math.max(p.revokedAt,p.relayRetiredAt??0);return retiredAt===undefined?!(p.active===false&&p.expiresAt!==undefined&&now>=p.expiresAt+LIMITS.retentionMs):!journal||now<journal.retirementDeadline(p.pairId,retiredAt)});return before!==config.pairs.length}
