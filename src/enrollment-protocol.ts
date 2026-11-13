import {createHash} from 'node:crypto';
import {decode} from './crypto.js';
import {exact,object,UUID,LIMITS} from './limits.js';

export interface EnrollmentRequest {version:1;id:string;clientId:string;daemonServerId:string;issuedAt:number;expiresAt:number}
export interface EnrollmentOffer {version:1;apiOrigin:string;pairId:string;enrollmentToken:string;rootKey:string;expiresAt:number}
export interface EnrollmentRecord {request:EnrollmentRequest;bytes:string;fingerprint:string;pairId:string;offer:EnrollmentOffer;createBytes:string;created:boolean}
export interface EnrollmentDescriptor {version:1;daemonServerId:string;instanceId:string;apiOrigin:string;enabled:boolean;measuredAt:number;expiresAt:number}
export interface EnrollmentResponse {version:1;id:string;clientId:string;daemonServerId:string;expiresAt:number;status:'pending'|'offer'|'active'|'disabled'|'error';offer?:EnrollmentOffer;code?:string}
export const DISCOVERY_NAME='.moremote-cli-connect';
export const descriptorLifetime=90000;
export const descriptorRenewal=30000;
export function requestFingerprint(bytes:string){return createHash('sha256').update(bytes,'utf8').digest('hex')}
export function parseEnrollmentRequest(bytes:string):EnrollmentRequest {
 if(Buffer.byteLength(bytes)>4096)throw Error('ENROLLMENT_REQUEST_LIMIT');
 const request=object(JSON.parse(bytes));exact(request,['version','id','clientId','daemonServerId','issuedAt','expiresAt']);
 if(request.version!==1||typeof request.id!=='string'||!UUID.test(request.id)||typeof request.clientId!=='string'||!UUID.test(request.clientId)||typeof request.daemonServerId!=='string'||!request.daemonServerId||Buffer.byteLength(request.daemonServerId)>512||!Number.isSafeInteger(request.issuedAt)||Number(request.issuedAt)<0||!Number.isSafeInteger(request.expiresAt)||Number(request.expiresAt)<=Number(request.issuedAt)||Number(request.expiresAt)-Number(request.issuedAt)>LIMITS.enrollmentMs)throw Error('INVALID_ENROLLMENT_REQUEST');
 return request as unknown as EnrollmentRequest;
}
export function validateEnrollmentRecords(value:unknown):asserts value is EnrollmentRecord[] {
 if(!Array.isArray(value)||value.length>16)throw Error('INVALID_ENROLLMENT_RECORDS');
 const ids=new Set<string>(),pairs=new Set<string>();
 for(const item of value){
  const record=object(item);exact(record,['request','bytes','fingerprint','pairId','offer','createBytes','created']);
  if(typeof record.bytes!=='string'||record.fingerprint!==requestFingerprint(record.bytes)||typeof record.created!=='boolean'||typeof record.pairId!=='string'||!UUID.test(record.pairId))throw Error('INVALID_ENROLLMENT_RECORD');
  const request=parseEnrollmentRequest(record.bytes);
  if(JSON.stringify(record.request)!==JSON.stringify(request)||ids.has(request.id)||pairs.has(record.pairId))throw Error('INVALID_ENROLLMENT_RECORD');
  ids.add(request.id);pairs.add(record.pairId);
  const offer=object(record.offer);exact(offer,['version','apiOrigin','pairId','enrollmentToken','rootKey','expiresAt']);
  if(offer.version!==1||offer.pairId!==record.pairId||typeof offer.apiOrigin!=='string'||!Number.isSafeInteger(offer.expiresAt)||Number(offer.expiresAt)<=request.issuedAt||Number(offer.expiresAt)>request.expiresAt||typeof offer.rootKey!=='string'||typeof offer.enrollmentToken!=='string')throw Error('INVALID_ENROLLMENT_OFFER');
  decode(offer.rootKey,32);decode(offer.enrollmentToken,32);
  if(typeof record.createBytes!=='string'||Buffer.byteLength(record.createBytes)>1024)throw Error('INVALID_ENROLLMENT_CREATE');
  const body=object(JSON.parse(record.createBytes));exact(body,['pairId','hostTokenHash','enrollmentTokenHash','expiresAt']);
  if(body.pairId!==record.pairId||body.expiresAt!==offer.expiresAt||typeof body.hostTokenHash!=='string'||!/^[a-f0-9]{64}$/.test(body.hostTokenHash)||body.enrollmentTokenHash!==requestFingerprint(offer.enrollmentToken))throw Error('INVALID_ENROLLMENT_CREATE');
 }
}
