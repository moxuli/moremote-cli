import { homedir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { mkdir, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { decode } from './crypto.js';
import { UUID,LIMITS } from './limits.js';
import type {OperationJournal} from './journal.js';
import {assertStateRoot,assertStateResource,inspectResource,readPrivateText,createPrivateFile,writePrivateAtomic} from './resources.js';
export interface Pair{pairId:string;rootKey:string;hostToken:string;apiOrigin?:string;enrollmentToken?:string;expiresAt?:number;active:boolean;claimId?:string;phoneTokenHash?:string;activationProof?:unknown;daemonServerId?:string;revokedAt?:number}
export interface Config{version:1;clientId:string;target?:string;paseoHome:string;apiOrigin?:string;allowLoopbackHttp:boolean;cloudEnabled:boolean;daemonServerId?:string;managedVersion?:string;pairs:Pair[]}
export function dataDirectory(env=process.env,platform=process.platform,home=homedir()){return resolve(env.MOREMOTE_COMPANION_HOME|| (platform==='win32'?join(env.LOCALAPPDATA||join(home,'AppData','Local'),'MoRemoteCompanion'):platform==='darwin'?join(home,'Library','Application Support','MoRemoteCompanion'):join(env.XDG_STATE_HOME||join(home,'.local','state'),'moremote-companion')))}
export function validateOrigin(value:string,allowLoopback:boolean){const u=new URL(value);if(u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('INVALID_API_ORIGIN');if(u.protocol!=='https:'&&!(allowLoopback&&u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw Error('HTTPS_REQUIRED');return u.origin}
const ownerFile='.moremote-companion-owner';
const ownerText='MoRemote Companion state v1\n';
const managedFile='.moremote-companion-managed-owner';
const managedText='MoRemote Companion managed package v1\n';
async function assertManagedDirectory(dir:string){inspectResource(dir,'directory');if(readPrivateText(join(dir,managedFile),128).text!==managedText)throw Error('FOREIGN_MANAGED_DIRECTORY')}
export async function privateManagedDirectory(dir:string){await mkdir(dir,{recursive:true,mode:0o700});inspectResource(dir,'directory');const names=await readdir(dir);if(!names.includes(managedFile)){if(names.length)throw Error('FOREIGN_MANAGED_DIRECTORY');createPrivateFile(join(dir,managedFile),managedText)}await assertManagedDirectory(dir)}
export async function assertOwnedDirectory(dir:string){inspectResource(dir,'directory');try{assertStateRoot(dir)}catch{throw Error('FOREIGN_DATA_DIRECTORY')}for(const name of await readdir(dir))assertStateResource(dir,name)}
export async function privateDirectory(dir:string){await mkdir(dir,{recursive:true,mode:0o700});inspectResource(dir,'directory');const names=await readdir(dir);if(!names.includes(ownerFile)){if(names.length)throw Error('FOREIGN_DATA_DIRECTORY');createPrivateFile(join(dir,ownerFile),ownerText)}await assertOwnedDirectory(dir)}
export async function atomicJson(path:string,value:unknown){writePrivateAtomic(path,value)}
export async function loadConfig(dir:string):Promise<Config>{
 let raw:string;try{assertStateRoot(dir);raw=readPrivateText(join(dir,'config.json'),131072).text}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;return {version:1,clientId:'moremote-companion-'+randomUUID(),paseoHome:process.env.PASEO_HOME||join(homedir(),'.paseo'),allowLoopbackHttp:false,cloudEnabled:false,pairs:[]}}
 if(Buffer.byteLength(raw)>131072)throw Error('CONFIG_LIMIT');const c=JSON.parse(raw) as Config;
 if(c.version!==1||typeof c.clientId!=='string'||!c.clientId.startsWith('moremote-companion-')||c.clientId.length>256||typeof c.paseoHome!=='string'||!c.paseoHome||c.paseoHome.length>4096||c.target!==undefined&&(typeof c.target!=='string'||!c.target||c.target.length>16384)||!Array.isArray(c.pairs)||c.pairs.length>16||typeof c.cloudEnabled!=='boolean'||typeof c.allowLoopbackHttp!=='boolean')throw Error('INVALID_CONFIG');
 if(c.managedVersion!==undefined&&(typeof c.managedVersion!=='string'||!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(c.managedVersion)))throw Error('INVALID_MANAGED_VERSION');
 if(c.apiOrigin)c.apiOrigin=validateOrigin(c.apiOrigin,c.allowLoopbackHttp);
 const identities=new Set<string>();for(const p of c.pairs){if(!UUID.test(p.pairId)||identities.has(p.pairId)||typeof p.active!=='boolean'||p.expiresAt!==undefined&&(!Number.isSafeInteger(p.expiresAt)||p.expiresAt<0)||p.revokedAt!==undefined&&(!Number.isSafeInteger(p.revokedAt)||p.revokedAt<0))throw Error('INVALID_PAIR');identities.add(p.pairId);decode(p.rootKey,32);decode(p.hostToken,32);if(p.apiOrigin)p.apiOrigin=validateOrigin(p.apiOrigin,c.allowLoopbackHttp)}return c;
}
export async function saveConfig(dir:string,config:Config){const a=resolve(dir),b=resolve(config.paseoHome);const left=process.platform==='win32'?a.toLowerCase():a,right=process.platform==='win32'?b.toLowerCase():b;if(left===right||left.startsWith(right+sep)||right.startsWith(left+sep))throw Error('OFFICIAL_DATA_OVERLAP');await privateDirectory(dir);await atomicJson(join(dir,'config.json'),config)}
export function pruneRetiredPairs(config:Config,now=Date.now(),journal?:OperationJournal){const before=config.pairs.length;config.pairs=config.pairs.filter(p=>p.revokedAt===undefined?!(p.active===false&&p.expiresAt!==undefined&&now>=p.expiresAt+LIMITS.retentionMs):!journal||now<journal.retirementDeadline(p.pairId,p.revokedAt));return before!==config.pairs.length}
