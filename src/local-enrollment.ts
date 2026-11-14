import {saveConfig,validateOrigin,type Config,type Pair} from './config.js';
import {CloudClient} from './cloud-client.js';
import {makeOffer,tokenHash} from './pairing.js';
import {EnrollmentFiles,type DiscoveryOptions} from './enrollment-files.js';
import {parseEnrollmentRequest,requestFingerprint,type EnrollmentRecord,type EnrollmentResponse} from './enrollment-protocol.js';

export const DEFAULT_API_ORIGIN='https://api.moremote.moxuli.com';
export interface LocalEnrollmentOptions {clock?:()=>number;files?:(options:DiscoveryOptions)=>EnrollmentFiles;persist?:(directory:string,config:Config)=>Promise<void>}
export type EnrollmentCloudFactory=(pair:Pair)=>Pick<CloudClient,'create'>;
// The runtime's existing serialized cycle owns this consumer and its Config.
// No watcher, background config writer, listener or official mutation is added.
export class LocalEnrollment {
 private files:EnrollmentFiles|undefined;
 private config:Config|undefined;
 private cursor=0;
 private readonly clock:()=>number;
 private readonly persist:(directory:string,config:Config)=>Promise<void>;
 constructor(private directory:string,private options:LocalEnrollmentOptions={}){this.clock=options.clock??Date.now;this.persist=options.persist??saveConfig}
 private storage(config:Config){
  if(!config.localEnrollment||!config.daemonServerId)return;
  this.files??=(this.options.files??(options=>new EnrollmentFiles(options)))({home:config.localEnrollment.home,stateDirectory:this.directory,daemonServerId:config.daemonServerId});
  this.files.open(config.enrollmentRequests??[]);return this.files;
 }
 async cleanup(config:Config){
  this.config=config;const files=this.storage(config);if(!files)return;
  const now=this.clock(),records=config.enrollmentRequests??[];let changed=false;
  for(const record of records){
   const pair=config.pairs.find(pair=>pair.pairId===record.pairId);
   if(!config.cloudEnabled||pair?.active||pair?.revokedAt!==undefined||pair?.relayRetiredAt!==undefined||now>=record.offer.expiresAt)files.removeResponse(record);
   if(config.cloudEnabled&&now<record.offer.expiresAt&&(pair?.revokedAt!==undefined||pair?.relayRetiredAt!==undefined))files.writeResponse(record,this.response(record,'disabled'));
   if(pair?.active||now>=record.offer.expiresAt){
    const name=record.request.id+'.json';
    try{const file=files.readRequest(name);if(file.text===record.bytes)files.removeRequest(name,file.identity)}catch(error){if(!(error instanceof Error&&'code' in error&&error.code==='ENOENT'))throw error}
   }
  }
  const retained=records.filter(record=>now<record.offer.expiresAt);
  if(retained.length!==records.length){config.enrollmentRequests=retained;changed=true}
  if(changed)await this.persist(this.directory,config);
 }
 async cycle(config:Config,daemonServerId:string,cloud:EnrollmentCloudFactory){
  if(!config.localEnrollment)return;
  if(!config.daemonServerId||config.daemonServerId!==daemonServerId)throw Error('ENROLLMENT_DAEMON_MISMATCH');
  await this.cleanup(config);const files=this.storage(config)!;
  const origin=validateOrigin(config.apiOrigin??DEFAULT_API_ORIGIN,false),now=this.clock();
  files.publish(config.cloudEnabled,origin,now);
  if(!config.cloudEnabled)return;
  const names=files.requestNames();if(!names.length)return;
  const start=this.cursor%names.length,selected=[...names.slice(start),...names.slice(0,start)].slice(0,16);this.cursor=(start+selected.length)%names.length;
  let failure:unknown,creationAttempted=false;
  for(const name of selected){try{
   const file=files.readRequest(name),record=config.enrollmentRequests?.find(record=>record.request.id===name.slice(0,-5));
   if(record&&record.bytes!==file.text){files.removeResponse(record);throw Error('ENROLLMENT_REQUEST_CONFLICT')}
   if(file.text==='')continue; // Official create/write is a two-step transaction.
   const request=parseEnrollmentRequest(file.text);
   if(request.id+'.json'!==name||request.daemonServerId!==daemonServerId)throw Error('ENROLLMENT_DAEMON_MISMATCH');
   if(request.expiresAt<=this.clock()){files.removeRequest(name,file.identity);continue}
   files.assertResponseAvailable(request.id,record);
   if(request.issuedAt>this.clock())throw Error('ENROLLMENT_REQUEST_FROM_FUTURE');
   let owned=record;
   if(!owned){
    if(creationAttempted)continue;
    if(config.pairs.some(pair=>pair.automaticRequestId===request.id))throw Error('ENROLLMENT_REQUEST_CONFLICT');
    if(config.pairs.some(pair=>pair.automaticClientId===request.clientId&&pair.daemonServerId===daemonServerId&&pair.revokedAt===undefined&&pair.relayRetiredAt===undefined&&(pair.active||pair.expiresAt===undefined||pair.expiresAt>this.clock())))throw Error('ENROLLMENT_CLIENT_ALREADY_BOUND');
    if(config.pairs.length>=16||(config.enrollmentRequests?.length??0)>=16)throw Error('PAIRING_LIMIT');
    const generated=makeOffer(origin,this.clock());generated.pair.expiresAt=Math.min(generated.pair.expiresAt!,request.expiresAt);
    const pair:Pair={...generated.pair,daemonServerId,automaticClientId:request.clientId,automaticRequestId:request.id};
    const offer={...generated.offer,version:1 as const,enrollmentToken:pair.enrollmentToken!,expiresAt:pair.expiresAt!};
    const createBytes=JSON.stringify({pairId:pair.pairId,hostTokenHash:tokenHash(pair.hostToken),enrollmentTokenHash:tokenHash(offer.enrollmentToken!),expiresAt:offer.expiresAt});
    owned={request,bytes:file.text,fingerprint:requestFingerprint(file.text),pairId:pair.pairId,offer,createBytes,created:false};
    config.pairs.push(pair);(config.enrollmentRequests??=[]).push(owned);
    await this.persist(this.directory,config); // Original keys/request precede all cloud I/O.
   }
   const pair=config.pairs.find(pair=>pair.pairId===owned.pairId);if(!pair)throw Error('ENROLLMENT_PAIR_MISSING');
   if(pair.active){files.removeResponse(owned);files.removeRequest(name,file.identity);continue}
   if(pair.revokedAt!==undefined||pair.relayRetiredAt!==undefined){files.writeResponse(owned,this.response(owned,'disabled'));continue}
   if(!owned.created){
    if(creationAttempted)continue;creationAttempted=true;
    await cloud(pair).create(JSON.parse(owned.createBytes),AbortSignal.timeout(3000));
    owned.created=true;await this.persist(this.directory,config);
   }
   // An unknown create acknowledgement retries the same original body. Recheck
   // the immutable local request and deadline after network/persistence awaits.
   if(this.clock()>=owned.offer.expiresAt){files.removeResponse(owned);continue}
   if(files.readRequest(name).text!==owned.bytes){files.removeResponse(owned);throw Error('ENROLLMENT_REQUEST_CONFLICT')}
   files.writeResponse(owned,{...this.response(owned,'offer'),offer:owned.offer});
  }catch(error){failure??=error}}
  if(failure)throw failure;
 }
 private response(record:EnrollmentRecord,status:EnrollmentResponse['status']):EnrollmentResponse{return {version:1,id:record.request.id,clientId:record.request.clientId,daemonServerId:record.request.daemonServerId,expiresAt:record.offer.expiresAt,status}}
 close(){this.files?.close(this.config?.enrollmentRequests??[]);this.files=undefined}
}
