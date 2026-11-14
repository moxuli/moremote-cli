import type {OfficialClient} from './official-client.js';
import type {Pair} from './config.js';
import {canonical,digest,type OperationJournal} from './journal.js';
import {occurrenceBinding} from './bindings.js';

// Cloud state exists only to hydrate notification replies and approvals.
export async function projectSnapshot(source:Awaited<ReturnType<OfficialClient['snapshot']>>,pair:Pair,journal:OperationJournal,generation:string){
 const tasks=[];
 for(const task of [...source.tasks].sort((a,b)=>a.agentId.localeCompare(b.agentId))){
  const pendingRequests=[];
  for(const pending of [...task.pendingRequests].sort((a,b)=>a.requestId.localeCompare(b.requestId))){
   const occurrence=journal.currentOccurrence(source.daemonServerId,task.agentId,pending.requestId);
   if(!occurrence||occurrence.generation!==generation||occurrence.fingerprint!==digest(canonical(pending.request)))continue;
   if(Buffer.byteLength(task.agentId)>256||Buffer.byteLength(pending.requestId)>256||Buffer.byteLength(JSON.stringify(pending.request))>8192)throw Error('NOTIFICATION_REQUEST_LIMIT');
   const requestBinding=await occurrenceBinding(pair,occurrence);
   if(journal.isCurrent(occurrence))pendingRequests.push({requestId:pending.requestId,requestBinding,request:pending.request});
  }
  if(pendingRequests.length)tasks.push({agentId:task.agentId,pendingRequests});
 }
 const result={version:1,daemonServerId:source.daemonServerId,tasks};
 if(Buffer.byteLength(JSON.stringify(result))>60000)throw Error('NOTIFICATION_STATE_LIMIT');
 return result;
}
