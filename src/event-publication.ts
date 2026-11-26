import type {Pair} from './config.js';
import {CloudClient} from './cloud-client.js';
import type {OperationJournal} from './journal.js';
import {LiveActivityPublisher,type LiveSnapshot} from './live-activity.js';
import {LIMITS} from './limits.js';

/** Independent durable acknowledgements sharing one transport request. */
export async function publishEvents(pair:Pair, cloud:CloudClient, journal:OperationJournal,
  publisher:LiveActivityPublisher, snapshot:LiveSnapshot|null, detailsCurrent:boolean, allowUngatedRequests=false) {
  const now=Date.now();
  // Never starve question/permission alerts forever when optional quick-reply
  // state hydration exceeds capacity or fails transiently.
  const pending=journal.attention(pair.pairId,now).filter(item=>
    detailsCurrent||allowUngatedRequests||!['question','permission'].includes(item.body.kind)
    ||(typeof item.body.envelope?.issuedAt==='number'&&now-item.body.envelope.issuedAt>=15000));
  if (!cloud.liveActivityV2) {
    for(const item of pending){await cloud.attention(item.body);journal.attentionSent(pair.pairId,item.id)}
    return;
  }
  let failure:unknown;
  let registrationChanged=false;
  const activity=cloud.liveActivityInterest&&snapshot
    ? await publisher.prepare(pair,cloud.liveActivityInterest,snapshot).catch(error=>{failure=error;return undefined}) : undefined;
  // Never let an oversize optional display update block the notification outbox.
  const live=activity&&Buffer.byteLength(JSON.stringify({attention:[],activity}))<=LIMITS.liveEventBytes?activity:undefined;
  if(activity&&!live)failure=Error('LIVE_ACTIVITY_BATCH_LIMIT');
  const batch:typeof pending=[];
  for(const item of pending.slice(0,8)){
    if(Buffer.byteLength(JSON.stringify({attention:[...batch.map(row=>row.body),item.body],...(live?{activity:live}:{})}))>LIMITS.liveEventBytes)break;
    batch.push(item);
  }
  if(batch.length||live){
    const result=await cloud.events(batch.map(item=>item.body),live);
    for(const item of batch)if(result.attention.has(item.id))journal.attentionSent(pair.pairId,item.id);else failure=Error('ATTENTION_NOT_ACCEPTED');
    if(live){
      if(result.activity)publisher.acknowledge(pair.pairId,live.registrationId,live.sequence);
      else if(['live_activity_not_registered','live_activity_retired','live_activity_generation_changed'].includes(result.activityCode??'')){
        publisher.stop(pair.pairId,live.registrationId,live.sequence);
        registrationChanged=true;
      }
      else failure=Error('LIVE_ACTIVITY_NOT_ACCEPTED');
    }
  }
  // A single large legacy notification can still use its original bounded route.
  if(pending.length&&!batch.length){await cloud.attention(pending[0].body);journal.attentionSent(pair.pairId,pending[0].id)}
  if(failure)throw failure;
  return registrationChanged;
}
