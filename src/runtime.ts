import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {loadConfig,saveConfig,privateDirectory,pruneRetiredPairs,type Pair,type Config} from './config.js';
import {OfficialClient,type Attention} from './official-client.js';
import {CloudClient,CloudError,type CloudRetryState} from './cloud-client.js';
import {sealEnvelope,decode,presenceTopic} from './crypto.js';
import {OperationJournal,type Occurrence} from './journal.js';
import {reconcileJournal} from './operations.js';
import {activatePending} from './pairing.js';
import {retransmitControls} from './controls.js';
import {occurrenceBinding} from './bindings.js';
import {projectSnapshot} from './projection.js';
import {ownRuntime} from './control.js';
import {LIMITS,object} from './limits.js';
import {NotificationStatePublisher} from './notification-state.js';
import {LocalEnrollment} from './local-enrollment.js';
import {inspectResource} from './resources.js';
import {LiveActivityPublisher,liveObservation,type LiveInterest} from './live-activity.js';
import {publishEvents} from './event-publication.js';
import {encryptNotificationPreview} from './notification-preview.js';
import {PaseoWatchdog} from './paseo-watchdog.js';
import {currentDefinition,migrateWindowsLoginRecovery} from './service.js';
import {recoverCatalogRetirements} from './retired-pair-recovery.js';
function stableId(value:unknown){const h=createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,32);return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20)}
export async function queueAttention(journal:OperationJournal,pair:Pair,event:Attention&{sourceFingerprint?:string;occurrence?:Occurrence},now=Date.now(),includePreview=true){
 if(event.timestamp+LIMITS.snapshotMs<=now||event.timestamp>now+LIMITS.futureMs)return;
 const payload:Attention={agentId:event.agentId,kind:event.kind,timestamp:event.timestamp,...(event.requestId?{requestId:event.requestId}:{}),...(event.requestBinding?{requestBinding:event.requestBinding}:{})};
 // A bound request notice belongs to its exact occurrence, not its snapshot clock.
 // Keep the legacy source identity for callers without authoritative occurrences.
 const id=event.requestId&&event.occurrence?stableId([pair.pairId,event.agentId,event.kind,event.requestId,'occurrence',event.occurrence.occurrenceId]):stableId([pair.pairId,event.agentId,event.kind,event.requestId||'',event.sourceFingerprint||'',event.requestId&&!event.sourceFingerprint?null:event.timestamp]);const issuedAt=event.timestamp;const envelope=await sealEnvelope(decode(pair.rootKey,32),{version:1,pairId:pair.pairId,id,channel:'attention',issuedAt,expiresAt:issuedAt+LIMITS.snapshotMs},payload);
 const preview=includePreview&&event.preview?await encryptNotificationPreview(pair,envelope,{agentId:event.agentId,kind:event.kind,timestamp:event.timestamp},event.preview):undefined;
 const topic=await presenceTopic(decode(pair.rootKey,32),pair.pairId,event.agentId);if(event.occurrence&&!journal.isCurrent(event.occurrence))return;
 journal.queueAttention(pair.pairId,id,envelope.expiresAt,{id,kind:event.kind,topic,envelope,...(preview?{preview}:{})},payload);
}
export async function boundAttention(journal:OperationJournal,pair:Pair,event:Attention,official:Pick<OfficialClient,'requestContext'|'generation'>){
 if(!event.requestId)return event;
 // Bind the occurrence captured when this event was observed. Looking up a
 // replacement here could give its identity an older cached event's clock.
 const occurrence=event.occurrence;
 if(!occurrence||occurrence.serverId!==official.requestContext().serverId||occurrence.agentId!==event.agentId||occurrence.requestId!==event.requestId||occurrence.generation!==official.generation||occurrence.createdAt!==event.timestamp||!journal.isCurrent(occurrence))return null;
 const requestBinding=await occurrenceBinding(pair,occurrence);if(!journal.isCurrent(occurrence))return null;
 return {...event,occurrence,sourceFingerprint:occurrence.fingerprint,requestBinding};
}
async function publishResolutions(journal:OperationJournal,pair:Pair,cloud:CloudClient){for(const event of journal.attentionResolutions(pair.pairId)){try{await cloud.resolveAttention(event.id,event.resolvedAt)}catch(error){if(!(error instanceof CloudError&&error.status===404))throw error}journal.attentionResolutionSent(pair.pairId,event.id)}}
// Relay disappearance/retirement fences execution, but is not an authenticated
// endpoint revoke. Never manufacture a control receipt or reset its audit clock.
async function observeRelayRetirement(config:Config,dir:string,pair:Pair,cloud:CloudClient,error:unknown){
 if(pair.relayRetiredAt!==undefined)return true;
 if(!(error instanceof CloudError)||![404,409].includes(error.status))return false;
 let retired=false;try{const state=object((await cloud.pair()).pair).state;retired=state==='revoked'||state==='expired'}catch(probe){if(probe instanceof CloudError&&probe.status===404&&probe.relayCode==='pair_not_found')retired=true}
 if(!retired)return false;pair.active=false;pair.relayRetiredAt=Date.now();await saveConfig(dir,config);return true;
}
// An elapsed deadline still fences the cycle that observed it.
function retryPaused(error:unknown){return error instanceof CloudError&&error.retryAt!==undefined}
export async function runRuntime(dir:string,version?:string){
 await privateDirectory(dir);let stopped=false,draining=false;let official:OfficialClient|undefined;let stage='starting';let lastError:string|null=null;let activePairs=0;
 const controller=new AbortController();const stop=()=>{stopped=true;controller.abort();void official?.sdk.close().catch(()=>{})};
 const drainWake=new AbortController();const parentMessage=(message:unknown)=>{if(message&&typeof message==='object'&&'kind' in message&&message.kind==='moremote-drain'){draining=true;drainWake.abort()}};
 const parentGone=()=>{draining=true;drainWake.abort()};
 let detach:(()=>void)|undefined,closeJournal:(()=>void)|undefined,watchdogTask:Promise<void>|undefined;
 const watchdog=new PaseoWatchdog();
 let displayRevision=0,recoveryRevision=0,localRetryWake:AbortController|undefined,eventWake:AbortController|undefined;
 const release=await ownRuntime(dir,()=>({stage,lastError,activePairs,version:version??null,paseoWatchdog:watchdog.status()}),stop);
 const enrollment=new LocalEnrollment(dir);
 try{
 if(!inspectResource(join(dir,'config.json'),'file',true))await saveConfig(dir,await loadConfig(dir));
 const journal=new OperationJournal(join(dir,'journal.sqlite'));closeJournal=()=>journal.close();
 if(process.send){process.on('message',parentMessage);process.on('disconnect',parentGone);if(!process.connected)parentGone();else process.send({kind:'moremote-ready'},undefined,undefined,()=>{})}
 const attentionQueue:Attention[]=[];let backoff:number=LIMITS.pollMs;let measuredAt=0;let snapshot:Awaited<ReturnType<OfficialClient['snapshot']>>|undefined;
 const statePublisher=new NotificationStatePublisher();const livePublisher=new LiveActivityPublisher(journal);
 let checkedCatalogRetirements=false;
 const historicalRecoveryAt=new Map<string,number>();
 const displays=new Map<string,{key:string|undefined;sent:string|undefined;interest:LiveInterest|undefined;previews:boolean;v2:boolean}>();
 const retryStates=new Map<string,CloudRetryState>(),pairRetries=new Map<string,CloudRetryState>();const pollOrigins=new Set<string>();
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 // This lane only starts the local daemon. Relay control and mutation admission
 // stay in the existing ordered cycle, even if the relay is offline or paused.
 const runtimeSignal=AbortSignal.any([controller.signal,drainWake.signal]);
 watchdogTask=watchdog.monitor(()=>loadConfig(dir),runtimeSignal,()=>{recoveryRevision++;localRetryWake?.abort()});
 if(process.platform==='win32'){
  const definition=currentDefinition(fileURLToPath(new URL('../bin/moremote-cli.js',import.meta.url)),dir);
  void migrateWindowsLoginRecovery(definition).catch(()=>{});
 }

 while(!stopped&&!draining){
 const issuedRecovery=recoveryRevision;let observedDisplayRevision=displayRevision;
 let openingOfficial=false;
 try{
 const now=Date.now();journal.cleanup(now);const config=await loadConfig(dir);pollOrigins.clear();let failure:unknown;let acquisitionFailed=false;const clouds=new Map<string,CloudClient>();const cycleFences=new Map<string,CloudRetryState>();
 for(const pair of config.pairs){const revokedAt=journal.revocationTime(pair.pairId);if(revokedAt!==undefined&&pair.revokedAt===undefined){pair.active=false;pair.revokedAt=revokedAt;await saveConfig(dir,config)}if(pair.relayRetiredAt!==undefined)pair.active=false}
 try{await enrollment.cleanup(config)}catch(error){failure=error}
 // Prune before any request: a retained 404 must not extend automatic recovery.
 if(pruneRetiredPairs(config,now,journal))await saveConfig(dir,config);journal.cleanupRevocations(config.pairs.map(p=>p.pairId),now);
 statePublisher.retain(config.cloudEnabled?config.pairs.filter(pair=>pair.active&&pair.relayRetiredAt===undefined&&!journal.pairRevoked(pair.pairId)).map(pair=>pair.pairId):[]);
 for(const origin of retryStates.keys())if(!config.pairs.some(pair=>(pair.apiOrigin||config.apiOrigin)===origin))retryStates.delete(origin);
 // Construct authenticated clients without reading empty command/control queues.
 if(config.cloudEnabled)for(const pair of config.pairs){
  const origin=pair.apiOrigin||config.apiOrigin;
  if(!origin)continue;
  const retired=pair.relayRetiredAt!==undefined||pair.revokedAt!==undefined||journal.pairRevoked(pair.pairId);
  const receipts=journal.receipts(pair.pairId,now);
  if(retired&&((historicalRecoveryAt.get(pair.pairId)??0)>now||
   !receipts.length&&!journal.controlReceipts(pair.pairId,now).length&&
   !journal.pending(pair.pairId).some(record=>record.state!=='prepared')))continue;
  if(!retired&&!pair.active&&pair.expiresAt!==undefined&&pair.expiresAt<=now)continue;
  if(config.enrollmentRequests?.some(record=>record.pairId===pair.pairId&&!record.created))continue;
  pollOrigins.add(origin);let retryState=retryStates.get(origin);if(!retryState){retryState={};retryStates.set(origin,retryState)}
  let cycleFence=cycleFences.get(origin);if(!cycleFence){cycleFence={};cycleFences.set(origin,cycleFence)}
  let pairRetry=pairRetries.get(pair.pairId);if(!pairRetry){pairRetry={};pairRetries.set(pair.pairId,pairRetry)}
  const cloud=new CloudClient(origin,pair.pairId,pair.hostToken,config.allowLoopbackHttp,fetch,controller.signal,retryState,cycleFence,pairRetry);
  clouds.set(pair.pairId,cloud);
  try{await retransmitControls({pair,journal,cloud})}catch(error){failure=error}
  for(const record of receipts){
   try{
    await cloud.receipt(record.id,{state:record.state as 'accepted'|'resolved'|'rejected'|'unknown',revision:record.revision,envelope:record.receipt!});
    journal.receiptSent(pair.pairId,record.id,record.revision);
   }catch(error){failure=error;if(await observeRelayRetirement(config,dir,pair,cloud,error))break;}
  }
  if(retired||pair.relayRetiredAt!==undefined)historicalRecoveryAt.set(pair.pairId,now+60000);
 }
 for(const id of historicalRecoveryAt.keys())if(!config.pairs.some(pair=>pair.pairId===id))historicalRecoveryAt.delete(id);
 for(const id of displays.keys())if(!clouds.has(id))displays.delete(id);
 for(const id of pairRetries.keys())if(!clouds.has(id))pairRetries.delete(id);
 if(stopped)break;
 if(!official||!official.sdk.isConnected){openingOfficial=true;detach?.();await official?.close().catch(()=>{});stage='connecting';const client=new OfficialClient(config,journal,()=>{displayRevision++;eventWake?.abort()});try{await client.connect();official=client}catch(error){await client.close().catch(()=>{});throw error}openingOfficial=false;watchdog.onConnected();const serverId=official.info()!.serverId;if(!config.daemonServerId){config.daemonServerId=serverId;await saveConfig(dir,config)}detach=official.onAttention(event=>{if(attentionQueue.length<500){attentionQueue.push(event);eventWake?.abort()}else lastError='ATTENTION_QUEUE_LIMIT'});measuredAt=0;}
 if(!checkedCatalogRetirements&&config.cloudEnabled){
  const restored=await recoverCatalogRetirements(config,journal,official.info()!.serverId,(origin,pair)=>
   new CloudClient(origin,pair.pairId,pair.hostToken,false,fetch,runtimeSignal).pair());
  if(restored)await saveConfig(dir,config);
  checkedCatalogRetirements=true;
  if(restored)continue;
 }
 official.setLiveActivityEnabled(config.cloudEnabled&&config.pairs.some(pair=>pair.active&&!journal.pairRevoked(pair.pairId)&&clouds.has(pair.pairId)),
  [...displays.values()].some(display=>!!display.interest&&display.interest.interest.expiresAt>now));
 try{await enrollment.cycle(config,official.info()!.serverId,pair=>{
  const origin=pair.apiOrigin||config.apiOrigin!;pollOrigins.add(origin);
  let retry=retryStates.get(origin);if(!retry){retry={};retryStates.set(origin,retry)}
  let fence=cycleFences.get(origin);if(!fence){fence={};cycleFences.set(origin,fence)}
  return new CloudClient(origin,pair.pairId,pair.hostToken,config.allowLoopbackHttp,fetch,controller.signal,retry,fence,pairRetries.get(pair.pairId));
 })}catch(error){failure=error}
 if(snapshot===undefined||Date.now()-measuredAt>=30000){snapshot=await official.snapshot();measuredAt=snapshot.measuredAt}
 stage=config.cloudEnabled?'cloud-enabled':'local-only';activePairs=config.pairs.filter(p=>p.active&&p.relayRetiredAt===undefined&&!journal.pairRevoked(p.pairId)).length;const events=attentionQueue.splice(0);
 observedDisplayRevision=displayRevision;
 const liveSnapshot=official.liveActivitySnapshot(), observation=liveObservation(liveSnapshot,Date.now());
 // Persist every active phone's events before the first network send.
 if(config.cloudEnabled)for(const pair of config.pairs.filter(p=>p.active&&p.relayRetiredAt===undefined&&!journal.pairRevoked(p.pairId)))for(const event of events){const bound=await boundAttention(journal,pair,event,official);if(bound)await queueAttention(journal,pair,bound,Date.now(),displays.get(pair.pairId)?.previews!==false)}
 for(const pair of config.pairs){if(stopped)break;const cloud=clouds.get(pair.pairId);if(!cloud||cycleFences.get(cloud.origin)?.error)continue;try{
 if(pair.daemonServerId&&pair.daemonServerId!==official.info()!.serverId){if(journal.pairRevoked(pair.pairId)||pair.relayRetiredAt!==undefined)continue;throw Error('PAIR_DAEMON_MISMATCH')}
 // Pairing and recovery concern explicit pending work. Neither can dispatch a new cloud command.
 if(!pair.active&&pair.revokedAt===undefined&&pair.relayRetiredAt===undefined&&!journal.pairRevoked(pair.pairId)){
  await activatePending(config,dir,pair,cloud,official.info()!.serverId,snapshot.hostName);continue;
 }
 if(await reconcileJournal({pair,journal,official,cloud,clock:Date.now}))failure=Error('RECEIPT_RECONCILIATION_FAILED');
 if(pair.relayRetiredAt!==undefined||journal.pairRevoked(pair.pairId)||!pair.active)continue;
 const pending=journal.attention(pair.pairId,now).length>0;
 let display=displays.get(pair.pairId);
 const known=display?.interest, expired=known!==undefined&&known.interest.expiresAt<=now;
 if((pending&&!display)||(observation&&(observation.present||known)&&observation.key!==display?.key)){
  try{
   await cloud.discoverLiveActivity();
   display={key:observation?.key,sent:undefined,interest:cloud.liveActivityInterest,previews:cloud.notificationPreviews,v2:cloud.liveActivityV2};
   displays.set(pair.pairId,display);
  }catch(error){
   // Prior Workers return a route-level 404. Continue sending ordinary alerts
   // during a rollback, without reviving the periodic acquisition paths.
   if(error instanceof CloudError&&error.status===404&&error.relayCode==='route_not_found'){
    display={key:observation?.key,sent:undefined,interest:undefined,previews:false,v2:false};
    displays.set(pair.pairId,display);
   }else{
    failure=error;if(await observeRelayRetirement(config,dir,pair,cloud,error))continue;
    if(!retryPaused(error))acquisitionFailed=true;
   }
  }
 }else if(expired&&display){display.interest=undefined;}
 if(display){
  cloud.notificationPreviews=display.previews;cloud.liveActivityV2=display.v2;cloud.liveActivityInterest=display.interest;
 }
 let detailsCurrent=false;let allowUngatedRequests=false;
 try{
  const payload=await projectSnapshot({...official.notificationSnapshot(),hostName:snapshot.hostName,measuredAt:snapshot.measuredAt},pair,journal,official.generation);
  detailsCurrent=await statePublisher.publish(pair,cloud,payload);
 }catch(error){
  if(error instanceof Error&&(error.message==='NOTIFICATION_REQUEST_LIMIT'||error.message==='NOTIFICATION_STATE_LIMIT'))allowUngatedRequests=true;
  failure=error;if(await observeRelayRetirement(config,dir,pair,cloud,error))continue;
 }
 try{await publishResolutions(journal,pair,cloud)}catch(error){failure=error}
 const interest=cloud.liveActivityInterest;
 const update=display&&observation&&interest&&(observation.key!==display.sent||
   observation.active&&livePublisher.needsRenewal(pair.pairId,interest.registrationId))?liveSnapshot:null;
 if(pending||update)try{
  const recovering=!!update&&!!interest&&livePublisher.hasUnacknowledged(pair.pairId,interest.registrationId);
  const registrationChanged=await publishEvents(pair,cloud,journal,livePublisher,update,detailsCurrent,allowUngatedRequests);
  if(update&&display){
   if(registrationChanged){
    // The only terminal event may race an iPhone token rotation. Re-read
    // once for this update, after committing any separate attention ACKs.
    display.key=undefined;
    await cloud.discoverLiveActivity();
    display.key=observation?.key;
    display.interest=cloud.liveActivityInterest;
    if(display.interest&&display.interest.registrationId!==interest?.registrationId){
     if(await publishEvents(pair,cloud,journal,livePublisher,update,detailsCurrent,allowUngatedRequests))display.interest=undefined;
    }else display.interest=undefined;
   }
   // An immutable retry may have acknowledged the preceding observation.
   // Run the current observation again after the durable retry is acknowledged.
   if(!recovering||registrationChanged)display.sent=observation?.key;
  }
 }catch(error){
  // A rejected alert must not hide an independently retired activity result.
  if(update&&display&&interest&&livePublisher.isStopped(pair.pairId,interest.registrationId))display.key=undefined;
  failure=error;if(await observeRelayRetirement(config,dir,pair,cloud,error))continue;
 }
 }catch(error){failure=error;if(!await observeRelayRetirement(config,dir,pair,cloud,error)&&!retryPaused(error))acquisitionFailed=true}}
 try{await enrollment.cleanup(config)}catch(error){failure=error}
 if(failure){lastError=failure instanceof CloudError?failure.code:'CLI_CYCLE_FAILED';stage='degraded';backoff=acquisitionFailed?Math.min(backoff*2,LIMITS.maxBackoffMs):LIMITS.pollMs}else{lastError=null;backoff=LIMITS.pollMs}
 }catch(error){lastError=error instanceof CloudError?error.code:'CLI_CYCLE_FAILED';stage='degraded';backoff=retryPaused(error)?LIMITS.pollMs:Math.min(backoff*2,LIMITS.maxBackoffMs)}
 // Pauses are shared only by relay origin, never reset by a cached rejection.
 // Other relays retain their normal local processing. If all are paused,
 // sleep to the first original deadline; stop still interrupts this wait.
 const wakeNow=Date.now();let retryWake=Infinity;
 for(const origin of pollOrigins){const retryAt=retryStates.get(origin)?.error?.retryAt;if(retryAt===undefined||retryAt<=wakeNow){retryWake=wakeNow;break}retryWake=Math.min(retryWake,retryAt)}
 const relayPaused=Number.isFinite(retryWake)&&retryWake>wakeNow;
 if(relayPaused)backoff=Math.max(backoff,retryWake-wakeNow);
 if(draining)break;
 // A successful local launch can wake this connection-specific wait, but
 // must never advance an existing relay pause or wake ordinary polling.
 if(openingOfficial&&!relayPaused){
  if(issuedRecovery!==recoveryRevision)continue;
  localRetryWake=new AbortController();
 }
 if(attentionQueue.length||observedDisplayRevision!==displayRevision)continue;
 eventWake=new AbortController();
 const wake=AbortSignal.any([runtimeSignal,eventWake.signal,...(localRetryWake?[localRetryWake.signal]:[])]);
 try{await sleep(backoff,undefined,{signal:wake})}catch{}finally{localRetryWake=undefined;eventWake=undefined}
 }}finally{controller.abort();await watchdogTask;process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);process.removeListener('message',parentMessage);process.removeListener('disconnect',parentGone);try{detach?.();await official?.close().catch(()=>{})}finally{try{enrollment.close()}finally{try{closeJournal?.()}finally{await release()}}}}
}
