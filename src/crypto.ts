import { webcrypto, randomBytes } from 'node:crypto';
import { LIMITS, UUID, object, exact } from './limits.js';
const subtle=webcrypto.subtle;
export type Channel='enrollment'|'activation'|'command'|'receipt'|'state'|'attention'|'control'|'controlReceipt'|'activityInterest'|'activityState';
export interface Metadata{version:1;pairId:string;id:string;channel:Channel;issuedAt:number;expiresAt:number}
export interface Envelope extends Metadata{nonce:string;ciphertext:string}
const channels=['enrollment','activation','command','receipt','state','attention','control','controlReceipt','activityInterest','activityState'];
function bytes(v:Uint8Array){return Uint8Array.from(v)}
export function decode(value:unknown,length?:number){if(typeof value!=='string'||!/^[A-Za-z0-9_-]+$/.test(value))throw Error('INVALID_BASE64URL');const b=Buffer.from(value,'base64url');if(b.toString('base64url')!==value||(length!==undefined&&b.length!==length))throw Error('INVALID_BASE64URL');return b}
export function validateEnvelope(input:unknown,now:number,allowExpired=false):Envelope{
 const e=object(input);exact(e,['version','pairId','id','channel','issuedAt','expiresAt','nonce','ciphertext']);
 if(Buffer.byteLength(JSON.stringify(e))>LIMITS.envelopeBytes||e.version!==1||typeof e.pairId!=='string'||!UUID.test(e.pairId)||typeof e.id!=='string'||!UUID.test(e.id)||!channels.includes(String(e.channel)))throw Error('INVALID_ENVELOPE');
 if((e.channel==='receipt'||e.channel==='controlReceipt')&&Buffer.byteLength(JSON.stringify(e))>LIMITS.receiptBytes)throw Error('RECEIPT_LIMIT');
 if(!Number.isSafeInteger(e.issuedAt)||!Number.isSafeInteger(e.expiresAt)||Number(e.issuedAt)<0||Number(e.expiresAt)<=Number(e.issuedAt))throw Error('INVALID_TIME');
 const ttl=e.channel==='activityInterest'?8*60*60*1000:e.channel==='command'||e.channel==='control'?LIMITS.commandMs:LIMITS.enrollmentMs;
 if(Number(e.expiresAt)-Number(e.issuedAt)>ttl||Number(e.issuedAt)>now+LIMITS.futureMs||(!allowExpired&&Number(e.expiresAt)<=now))throw Error('EXPIRED_OR_FUTURE');
 decode(e.nonce,12);const c=decode(e.ciphertext);if(c.length<16||c.length>LIMITS.plainBytes+16)throw Error('INVALID_CIPHERTEXT');return e as unknown as Envelope;
}
export async function deriveKey(root:Uint8Array,pairId:string,channel:Channel|'presence'|'requestBinding'){
 if(root.length!==32||!UUID.test(pairId))throw Error('INVALID_KEY_CONTEXT');
 const key=await subtle.importKey('raw',bytes(root),'HKDF',false,['deriveBits']);
 return new Uint8Array(await subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt:Buffer.from('MoRemote pairing v1'),info:Buffer.from(JSON.stringify([1,pairId,channel]))},key,256));
}
function aad(m:Metadata){return Buffer.from(JSON.stringify([1,m.pairId,m.id,m.channel,m.issuedAt,m.expiresAt]))}
export async function sealEnvelope(root:Uint8Array,metadata:Metadata,payload:unknown,nonce:Uint8Array=randomBytes(12)):Promise<Envelope>{
 const plain=Buffer.from(JSON.stringify(payload));if(plain.length>LIMITS.plainBytes||nonce.length!==12)throw Error('PAYLOAD_LIMIT');
 const key=await subtle.importKey('raw',bytes(await deriveKey(root,metadata.pairId,metadata.channel)),'AES-GCM',false,['encrypt']);
 const encrypted=await subtle.encrypt({name:'AES-GCM',iv:bytes(nonce),additionalData:aad(metadata),tagLength:128},key,plain);
 const envelope={...metadata,nonce:Buffer.from(nonce).toString('base64url'),ciphertext:Buffer.from(encrypted).toString('base64url')};
 validateEnvelope(envelope,metadata.issuedAt);return envelope;
}
async function decryptEnvelope(root:Uint8Array,e:Envelope):Promise<unknown>{
 const key=await subtle.importKey('raw',bytes(await deriveKey(root,e.pairId,e.channel)),'AES-GCM',false,['decrypt']);
 const plain=await subtle.decrypt({name:'AES-GCM',iv:decode(e.nonce,12),additionalData:aad(e),tagLength:128},key,decode(e.ciphertext));
 if(plain.byteLength>LIMITS.plainBytes)throw Error('PAYLOAD_LIMIT');return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain));
}
export async function openEnvelope(root:Uint8Array,input:unknown,now=Date.now()):Promise<unknown>{
 return decryptEnvelope(root,validateEnvelope(input,now));
}
/** Display only: historical state/attention never authorizes any operation. */
export async function openHistoricalSnapshot(root:Uint8Array,input:unknown,now=Date.now()):Promise<unknown>{
 const e=validateEnvelope(input,now,true);
 if(e.channel!=='state'&&e.channel!=='attention')throw Error('HISTORICAL_AUTHORITY_REFUSED');
 return decryptEnvelope(root,e);
}
/** Read-only outcome audit. This API can never decode a command or enrollment. */
export async function openHistoricalReceipt(root:Uint8Array,input:unknown,now=Date.now()):Promise<unknown>{
 const e=validateEnvelope(input,now,true);if(e.channel!=='receipt'&&e.channel!=='controlReceipt')throw Error('HISTORICAL_AUTHORITY_REFUSED');return decryptEnvelope(root,e);
}
export async function presenceTopic(root:Uint8Array,pairId:string,agentId:string){const key=await subtle.importKey('raw',bytes(await deriveKey(root,pairId,'presence')),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Buffer.from(await subtle.sign('HMAC',key,Buffer.from(agentId))).toString('base64url')}
