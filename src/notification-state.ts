import {randomUUID} from 'node:crypto';
import type {Pair} from './config.js';
import type {CloudClient} from './cloud-client.js';
import {decode,sealEnvelope,type Envelope} from './crypto.js';
import {canonical,digest} from './journal.js';
import {LIMITS} from './limits.js';
import type {projectSnapshot} from './projection.js';

type NotificationState=Awaited<ReturnType<typeof projectSnapshot>>;
type Publication={envelope:Envelope;fingerprint:string;acknowledged:boolean};

// State is encrypted notification hydration, never a general system-surface feed.
// Callers serialize publication per pair. Unknown acknowledgements retain bytes.
export class NotificationStatePublisher{
 private publications=new Map<string,Publication>();
 retain(ids:string[]){const keep=new Set(ids);for(const id of this.publications.keys())if(!keep.has(id))this.publications.delete(id)}
 async publish(pair:Pick<Pair,'pairId'|'rootKey'>,cloud:Pick<CloudClient,'state'>,payload:NotificationState,now=Date.now()){
  const fingerprint=digest(canonical(payload));
  let publication=this.publications.get(pair.pairId);
  if(!payload.tasks.length&&(!publication||publication.acknowledged&&publication.fingerprint===fingerprint))return true;
  // An earlier unknown attempt is retried before publishing a newer observation.
  for(let attempt=0;attempt<2;attempt++){
   const changed=!publication||publication.fingerprint!==fingerprint;
   const renewal=payload.tasks.length>0&&!!publication&&publication.envelope.expiresAt-now<=120000;
   if(!publication||publication.envelope.expiresAt<=now||publication.acknowledged&&(changed||renewal)){
    const issuedAt=Math.max(now,(publication?.envelope.issuedAt??-1)+1);
    const envelope=await sealEnvelope(decode(pair.rootKey,32),{version:1,pairId:pair.pairId,id:randomUUID(),channel:'state',issuedAt,expiresAt:issuedAt+LIMITS.snapshotMs},payload);
    publication={envelope,fingerprint,acknowledged:false};this.publications.set(pair.pairId,publication);
   }
   if(!publication.acknowledged){await cloud.state(publication.envelope);publication.acknowledged=true}
   if(publication.fingerprint===fingerprint)return true;
  }
  return false;
 }
}
