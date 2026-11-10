import {webcrypto} from 'node:crypto';
import {deriveKey,decode} from './crypto.js';
import type {Pair} from './config.js';
import type {OperationJournal,Occurrence} from './journal.js';
export async function occurrenceBinding(pair:Pick<Pair,'pairId'|'rootKey'>,o:Occurrence){const key=await webcrypto.subtle.importKey('raw',Uint8Array.from(await deriveKey(decode(pair.rootKey,32),pair.pairId,'requestBinding')),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Buffer.from(await webcrypto.subtle.sign('HMAC',key,Buffer.from(JSON.stringify([1,o.serverId,o.agentId,o.requestId,o.occurrenceId,o.fingerprint])))).toString('base64url')}
export async function bindRequest(journal:OperationJournal,pair:Pick<Pair,'pairId'|'rootKey'>,serverId:string,agentId:string,generation:string,request:{id:string}){return occurrenceBinding(pair,journal.observe(serverId,agentId,generation,request as unknown as Record<string,unknown>))}
