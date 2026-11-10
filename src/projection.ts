import type {OfficialClient} from './official-client.js';import type {Pair} from './config.js';import {canonical,digest,type OperationJournal} from './journal.js';import {occurrenceBinding} from './bindings.js';
export async function projectSnapshot(source:Awaited<ReturnType<OfficialClient['snapshot']>>,pair:Pair,journal:OperationJournal,generation:string){
 const tasks=[];let tasksTruncated=false;
 for(const task of source.tasks){if(Buffer.byteLength(task.agentId)>256){tasksTruncated=true;continue}const pendingRequests=[];
 for(const pending of task.pendingRequests){if(Buffer.byteLength(pending.requestId)>256||Buffer.byteLength(JSON.stringify(pending.request))>8192){tasksTruncated=true;continue}const occurrence=journal.currentOccurrence(source.daemonServerId,task.agentId,pending.requestId);if(!occurrence||occurrence.generation!==generation||occurrence.fingerprint!==digest(canonical(pending.request)))continue;const requestBinding=await occurrenceBinding(pair,occurrence);if(!journal.isCurrent(occurrence))continue;pendingRequests.push({requestId:pending.requestId,requestBinding,request:pending.request})}
 tasks.push({...task,pendingRequests});}
 const result={...source,tasks,tasksTruncated};while(Buffer.byteLength(JSON.stringify(result))>60000&&result.tasks.length){result.tasks.pop();result.tasksTruncated=true}if(Buffer.byteLength(JSON.stringify(result))>60000)throw Error('SNAPSHOT_LIMIT');return result;
}
