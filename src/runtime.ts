import {randomUUID,createHash} from 'node:crypto';
import {join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {loadConfig,saveConfig,privateDirectory,pruneRetiredPairs,type Pair,type Config} from './config.js';
import {OfficialClient,type Attention} from './official-client.js';
import {CloudClient,CloudError,type CloudRetryState} from './cloud-client.js';
import {sealEnvelope,decode,presenceTopic,type Envelope} from './crypto.js';
import {OperationJournal,type Occurrence} from './journal.js';
import {executeOperation,reconcileJournal} from './operations.js';
import {activatePending} from './pairing.js';
import {processControl,retransmitControls} from './controls.js';
import {occurrenceBinding} from './bindings.js';
import {projectSnapshot} from './projection.js';
import {ownRuntime} from './control.js';
import {LIMITS,object} from './limits.js';
import {ActivityPublisher,ActivityWorkLane,widgetFingerprint} from './activity.js';
import {LocalEnrollment} from './local-enrollment.js';
import {inspectResource} from './resources.js';
function stableId(value:unknown){const h=createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,32);return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20)}
export async function queueAttention(journal:OperationJournal,pair:Pair,event:Attention&{sourceFingerprint?:string;occurrence?:Occurrence},now=Date.now()){
 if(event.timestamp+LIMITS.snapshotMs<=now||event.timestamp>now+LIMITS.futureMs)return;
 const payload:Attention={agentId:event.agentId,kind:event.kind,timestamp:event.timestamp,...(event.requestId?{requestId:event.requestId}:{}),...(event.requestBinding?{requestBinding:event.requestBinding}:{})};
 // A bound request notice belongs to its exact occurrence, not its snapshot clock.
 // Keep the legacy source identity for callers without authoritative occurrences.
 const id=event.requestId&&event.occurrence?stableId([pair.pairId,event.agentId,event.kind,event.requestId,'occurrence',event.occurrence.occurrenceId]):stableId([pair.pairId,event.agentId,event.kind,event.requestId||'',event.sourceFingerprint||'',event.requestId&&!event.sourceFingerprint?null:event.timestamp]);const issuedAt=event.timestamp;const envelope=await sealEnvelope(decode(pair.rootKey,32),{version:1,pairId:pair.pairId,id,channel:'attention',issuedAt,expiresAt:issuedAt+LIMITS.snapshotMs},payload);
 const topic=await presenceTopic(decode(pair.rootKey,32),pair.pairId,event.agentId);if(event.occurrence&&!journal.isCurrent(event.occurrence))return;
 journal.queueAttention(pair.pairId,id,envelope.expiresAt,{id,kind:event.kind,topic,envelope},payload);
}
async function boundAttention(journal:OperationJournal,pair:Pair,event:Attention,official:OfficialClient){if(!event.requestId)return event;const occurrence=journal.currentOccurrence(official.requestContext().serverId,event.agentId,event.requestId);if(!occurrence||occurrence.generation!==official.generation)return null;const requestBinding=await occurrenceBinding(pair,occurrence);if(!journal.isCurrent(occurrence))return null;return {...event,occurrence,sourceFingerprint:occurrence.fingerprint,requestBinding}}
async function publishResolutions(journal:OperationJournal,pair:Pair,cloud:CloudClient){for(const event of journal.attentionResolutions(pair.pairId)){try{await cloud.resolveAttention(event.id,event.resolvedAt)}catch(error){if(!(error instanceof CloudError&&error.status===404))throw error}journal.attentionResolutionSent(pair.pairId,event.id)}}
// Relay disappearance/retirement fences execution, but is not an authenticated
// endpoint revoke. Never manufacture a control receipt or reset its audit clock.
async function observeRelayRetirement(config:Config,dir:string,pair:Pair,cloud:CloudClient,error:unknown){
 if(pair.relayRetiredAt!==undefined)return true;
 if(!(error instanceof CloudError)||![404,409].includes(error.status))return false;
 let retired=false;try{const state=object((await cloud.pair()).pair).state;retired=state==='revoked'||state==='expired'}catch(probe){if(probe instanceof CloudError&&probe.status===404)retired=true}
 if(!retired)return false;pair.active=false;pair.relayRetiredAt=Date.now();await saveConfig(dir,config);return true;
}
// An elapsed deadline still fences the cycle that observed it.
function retryPaused(error:unknown){return error instanceof CloudError&&error.retryAt!==undefined}
export async function runRuntime(dir:string,version?:string){
 await privateDirectory(dir);let stopped=false,draining=false;let official:OfficialClient|undefined;let stage='starting';let lastError:string|null=null;let activePairs=0;
 const controller=new AbortController();const stop=()=>{stopped=true;controller.abort();void official?.sdk.close().catch(()=>{})};
 const drainWake=new AbortController();const parentMessage=(message:unknown)=>{if(message&&typeof message==='object'&&'kind' in message&&message.kind==='moremote-drain'){draining=true;drainWake.abort()}};
 const parentGone=()=>{draining=true;drainWake.abort()};
 let detach:(()=>void)|undefined,closeJournal:(()=>void)|undefined;
 const release=await ownRuntime(dir,()=>({stage,lastError,activePairs,version:version??null}),stop);
 const activityLane=new ActivityWorkLane();let activityFailure:unknown=null,activityPairCursor=0;
 const enrollment=new LocalEnrollment(dir);
 try{
 if(!inspectResource(join(dir,'config.json'),'file',true))await saveConfig(dir,await loadConfig(dir));
 const journal=new OperationJournal(join(dir,'journal.sqlite'));closeJournal=()=>journal.close();
 if(process.send){process.on('message',parentMessage);process.on('disconnect',parentGone);if(!process.connected)parentGone();else process.send({kind:'moremote-ready'},undefined,undefined,()=>{})}
 const attentionQueue:Attention[]=[];let backoff:number=LIMITS.pollMs;let measuredAt=0;let snapshot:Awaited<ReturnType<OfficialClient['snapshot']>>|undefined;
 const statePublications=new Map<string,{envelope:Envelope;widgetFingerprint:string;acknowledged:boolean}>();const activityPublisher=new ActivityPublisher();
 const retryStates=new Map<string,CloudRetryState>();const pollOrigins=new Set<string>();
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 while(!stopped&&!draining){try{
 const now=Date.now();journal.cleanup(now);const config=await loadConfig(dir);pollOrigins.clear();let failure:unknown=activityFailure;activityFailure=null;let acquisitionFailed=false;const clouds=new Map<string,CloudClient>();const cycleFences=new Map<string,CloudRetryState>();
 for(const pair of config.pairs){const revokedAt=journal.revocationTime(pair.pairId);if(revokedAt!==undefined&&pair.revokedAt===undefined){pair.active=false;pair.revokedAt=revokedAt;await saveConfig(dir,config)}if(pair.relayRetiredAt!==undefined)pair.active=false}
 try{await enrollment.cleanup(config)}catch(error){failure=error}
 // Prune before any request: a retained 404 must not extend automatic recovery.
 if(pruneRetiredPairs(config,now,journal))await saveConfig(dir,config);journal.cleanupRevocations(config.pairs.map(p=>p.pairId),now);
 for(const pairId of statePublications.keys())if(!config.pairs.some(pair=>pair.pairId===pairId))statePublications.delete(pairId);
 activityPublisher.retain(config.cloudEnabled?config.pairs.filter(pair=>pair.active&&pair.relayRetiredAt===undefined&&!journal.pairRevoked(pair.pairId)).map(pair=>pair.pairId):[]);
 for(const origin of retryStates.keys())if(!config.pairs.some(pair=>(pair.apiOrigin||config.apiOrigin)===origin))retryStates.delete(origin);
 // Endpoint revocation must work even when the official daemon is offline.
 if(config.cloudEnabled)for(const pair of config.pairs){if(stopped)break;const origin=pair.apiOrigin||config.apiOrigin;if(!origin||(!pair.active&&pair.revokedAt===undefined&&pair.relayRetiredAt===undefined&&pair.expiresAt!==undefined&&pair.expiresAt<=Date.now()))continue;
 if(config.enrollmentRequests?.some(record=>record.pairId===pair.pairId&&!record.created))continue;
 pollOrigins.add(origin);let retryState=retryStates.get(origin);if(!retryState){retryState={};retryStates.set(origin,retryState)}
 let cycleFence=cycleFences.get(origin);if(!cycleFence){cycleFence={};cycleFences.set(origin,cycleFence)}
 const cloud=new CloudClient(origin,pair.pairId,pair.hostToken,config.allowLoopbackHttp,fetch,controller.signal,retryState,cycleFence);let controlsVerified=true;
 try{for(const envelope of await cloud.controls()){try{const state=await processControl({pair,journal,cloud},envelope);if(state==='revoked'){pair.active=false;pair.revokedAt??=journal.revocationTime(pair.pairId)??Date.now();await saveConfig(dir,config)}}catch(error){failure=error;controlsVerified=false;if(!retryPaused(error))acquisitionFailed=true}}}
 catch(error){failure=error;if(!await observeRelayRetirement(config,dir,pair,cloud,error)){if(!retryPaused(error))acquisitionFailed=true;continue}}
 if(controlsVerified||journal.pairRevoked(pair.pairId)||pair.relayRetiredAt!==undefined)clouds.set(pair.pairId,cloud);
 try{await retransmitControls({pair,journal,cloud})}catch(error){failure=error}
 for(const record of journal.receipts(pair.pairId,Date.now())){try{await cloud.receipt(record.id,{state:record.state as 'accepted'|'resolved'|'rejected'|'unknown',revision:record.revision,envelope:record.receipt!});journal.receiptSent(pair.pairId,record.id,record.revision)}catch(error){failure=error}}
 if(pair.active&&!journal.pairRevoked(pair.pairId))try{await publishResolutions(journal,pair,cloud)}catch(error){failure=error}
 }
 if(stopped)break;
 if(!official||!official.sdk.isConnected){detach?.();await official?.close().catch(()=>{});stage='connecting';official=new OfficialClient(config,journal);await official.connect();const serverId=official.info()!.serverId;if(!config.daemonServerId){config.daemonServerId=serverId;await saveConfig(dir,config)}detach=official.onAttention(event=>{if(attentionQueue.length<500)attentionQueue.push(event);else lastError='ATTENTION_QUEUE_LIMIT'});measuredAt=0;}
 try{await enrollment.cycle(config,official.info()!.serverId,pair=>{
  const origin=pair.apiOrigin||config.apiOrigin!;pollOrigins.add(origin);
  let retry=retryStates.get(origin);if(!retry){retry={};retryStates.set(origin,retry)}
  let fence=cycleFences.get(origin);if(!fence){fence={};cycleFences.set(origin,fence)}
  return new CloudClient(origin,pair.pairId,pair.hostToken,config.allowLoopbackHttp,fetch,controller.signal,retry,fence);
 })}catch(error){failure=error}
 if(snapshot===undefined||Date.now()-measuredAt>=30000){snapshot=await official.snapshot();measuredAt=snapshot.measuredAt}
 stage=config.cloudEnabled?'cloud-enabled':'local-only';activePairs=config.pairs.filter(p=>p.active&&p.relayRetiredAt===undefined&&!journal.pairRevoked(p.pairId)).length;const events=attentionQueue.splice(0);
 // Persist every active phone's events before the first network send.
 if(config.cloudEnabled)for(const pair of config.pairs.filter(p=>p.active&&p.relayRetiredAt===undefined&&!journal.pairRevoked(p.pairId)))for(const event of events){const bound=await boundAttention(journal,pair,event,official);if(bound)await queueAttention(journal,pair,bound)}
 if(!stopped&&!draining){
  const candidates=config.pairs.filter(pair=>pair.active&&pair.relayRetiredAt===undefined&&!journal.pairRevoked(pair.pairId)&&clouds.has(pair.pairId));
  const ordered=[...candidates.slice(activityPairCursor),...candidates.slice(0,activityPairCursor)],activitySnapshot=snapshot,activityOfficial=official;
  // Schedule cached terminal recovery before any optional normal discovery.
  // The owned lane never delays command acquisition and is aborted/joined on drain.
  if(activityLane.start(async signal=>{
   let optionalFailure:unknown;
   for(const terminalOnly of [true,false])for(const pair of ordered){
    signal.throwIfAborted();if(!pair.active||journal.pairRevoked(pair.pairId))continue;
    const cloud=clouds.get(pair.pairId)!;
    try{await activityPublisher.publish(pair,cloud,activitySnapshot,Date.now(),(agentId,readSignal)=>activityOfficial.activityTask(agentId,readSignal),{signal,terminalOnly})}
    catch(error){if(signal.aborted)throw error;optionalFailure??=error}
   }
   if(optionalFailure)throw optionalFailure;
  },error=>{activityFailure=error},AbortSignal.any([controller.signal,drainWake.signal])))activityPairCursor=(activityPairCursor+1)%Math.max(1,candidates.length);
 }
 for(const pair of config.pairs){if(stopped)break;const cloud=clouds.get(pair.pairId);if(!cloud||cycleFences.get(cloud.origin)?.error)continue;try{
 if(pair.daemonServerId&&pair.daemonServerId!==official.info()!.serverId){if(journal.pairRevoked(pair.pairId)||pair.relayRetiredAt!==undefined)continue;throw Error('PAIR_DAEMON_MISMATCH')}
 // Read-only reconciliation remains available after revoke and original message expiry.
 if(await reconcileJournal({pair,journal,official,cloud,clock:Date.now}))failure=Error('RECEIPT_RECONCILIATION_FAILED');
 if(journal.pairRevoked(pair.pairId)||pair.relayRetiredAt!==undefined)continue;
 const active=await activatePending(config,dir,pair,cloud,official.info()!.serverId,snapshot.hostName);if(!active)continue;
 try{
 let publication=statePublications.get(pair.pairId);
 // A lost acknowledgement keeps the exact immutable envelope even across a
 // newer measurement. Expired display-only state can yield to a fresh sample.
 if(!publication||publication.envelope.expiresAt<=Date.now()||(publication.acknowledged&&publication.envelope.issuedAt!==snapshot.measuredAt)){
 const payload=await projectSnapshot(snapshot,pair,journal,official.generation);const envelope=await sealEnvelope(decode(pair.rootKey,32),{version:1,pairId:pair.pairId,id:randomUUID(),channel:'state',issuedAt:snapshot.measuredAt,expiresAt:snapshot.measuredAt+LIMITS.snapshotMs},payload);publication={envelope,widgetFingerprint:await widgetFingerprint(pair,payload),acknowledged:false};statePublications.set(pair.pairId,publication)}
 if(!publication.acknowledged){await cloud.state(publication.envelope,publication.widgetFingerprint);publication.acknowledged=true}
 }catch(error){failure=error;if(await observeRelayRetirement(config,dir,pair,cloud,error))continue}
 try{await publishResolutions(journal,pair,cloud)}catch(error){failure=error}
 for(const item of journal.attention(pair.pairId,Date.now())){try{await cloud.attention(item.body);journal.attentionSent(pair.pairId,item.id)}catch(error){failure=error}}
 // Publication failures are independent from acquisition. Preserve the normal
 // three-second command/control cadence while still surfacing degraded status.
 try{for(const envelope of await cloud.commands()){if(stopped||cycleFences.get(cloud.origin)?.error)break;try{await executeOperation({pair,journal,official,cloud,clock:Date.now},envelope)}catch(error){failure=error}}}
 catch(error){failure=error;if(!await observeRelayRetirement(config,dir,pair,cloud,error)&&!retryPaused(error))acquisitionFailed=true}
 }catch(error){failure=error;if(!await observeRelayRetirement(config,dir,pair,cloud,error)&&!retryPaused(error))acquisitionFailed=true}}
 try{await enrollment.cleanup(config)}catch(error){failure=error}
 if(failure){lastError=failure instanceof CloudError?failure.code:'CLI_CYCLE_FAILED';stage='degraded';backoff=acquisitionFailed?Math.min(backoff*2,LIMITS.maxBackoffMs):LIMITS.pollMs}else{lastError=null;backoff=LIMITS.pollMs}
 }catch(error){lastError=error instanceof CloudError?error.code:'CLI_CYCLE_FAILED';stage='degraded';backoff=retryPaused(error)?LIMITS.pollMs:Math.min(backoff*2,LIMITS.maxBackoffMs)}
 // Pauses are shared only by relay origin, never reset by a cached rejection.
 // Other relays retain ordinary control priority/cadence. If all are paused,
 // sleep to the first original deadline; stop still interrupts this wait.
 const wakeNow=Date.now();let retryWake=Infinity;
 for(const origin of pollOrigins){const retryAt=retryStates.get(origin)?.error?.retryAt;if(retryAt===undefined||retryAt<=wakeNow){retryWake=wakeNow;break}retryWake=Math.min(retryWake,retryAt)}
 if(Number.isFinite(retryWake)&&retryWake>wakeNow)backoff=Math.max(backoff,retryWake-wakeNow);
 if(draining)break;
 await sleep(backoff,undefined,{signal:AbortSignal.any([controller.signal,drainWake.signal])}).catch(()=>{});
 }}finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);process.removeListener('message',parentMessage);process.removeListener('disconnect',parentGone);try{await activityLane.close();detach?.();await official?.close().catch(()=>{})}finally{try{enrollment.close()}finally{try{closeJournal?.()}finally{await release()}}}}
}
