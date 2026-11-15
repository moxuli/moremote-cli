import type {DaemonClient,FetchWorkspacesEntry} from '@getpaseo/client/internal/daemon-client';
import {liveIdentifier,type LiveWorkspace} from './live-activity-titles.js';

type Owner=ReturnType<DaemonClient['observeWorkspaces']>;
interface Read {order:number;priority:number;owner?:Owner;detach?:()=>void;ready:boolean;generation?:string;head:number;pending?:boolean;complete?:boolean;abort?:AbortController}
interface Row {value:LiveWorkspace;read:Read;generation?:string;head:number}

/** Unknown metadata is distinct from an authoritative empty title. */
export class LiveWorkspaces {
 private enabled=false;
 private page?:Read;
 private exact=new Map<string,Read>();
 private pageIDs=new Set<string>();
 private titles=new Map<string,Row>();
 private readOrder=0;
 private generation?:string;
 private generationOrder=-1;
 private retiredGenerations=new Set<string>();
 constructor(private sdk:DaemonClient){}
 setEnabled(enabled:boolean){
  if(!enabled){this.stop();return}
  this.enabled=true;
  if(!this.page?.owner)this.observe();
  for(const [id,read] of this.exact)if(!read.owner&&!read.pending&&!read.complete)this.observeExact(id);
 }
 snapshot():LiveWorkspace[]{return structuredClone([...this.titles.values()].map(row=>row.value).filter(value=>value.title!==undefined))}
 request(id:string){
  if(!this.enabled||!liveIdentifier(id))return;
  if(this.pageIDs.has(id)&&this.titles.get(id)?.value.title!==undefined)return;
  const previous=this.exact.get(id);
  if(previous){this.exact.delete(id);this.exact.set(id,previous);return}
  if(this.exact.size>=32){
   const oldest=this.exact.keys().next().value!;
   this.release(this.exact.get(oldest)!);this.exact.delete(oldest);
  }
  this.observeExact(id);
 }
 private observeExact(id:string){
  if(this.sdk.getLastServerInfoMessage()?.features?.ownedSubscriptions===true){this.observe(id);return}
  // Legacy directory subscriptions share one last-query-wins server slot.
  // A non-subscribing seed preserves the broad stream for every target.
  const read:Read={order:++this.readOrder,priority:0,ready:false,head:-1,pending:true,abort:new AbortController()},page=this.page,previous=this.titles.get(id);
  this.exact.set(id,read);
  void this.sdk.fetchWorkspaces({page:{limit:1},filter:{idPrefix:id,includeInternal:false,includeBackground:false},signal:read.abort!.signal})
   .then(value=>{
    if(!this.enabled||this.exact.get(id)!==read||this.page!==page)return;
    read.generation=value.sync?.generation;read.head=value.sync?.headSeq??-1;
    if(this.titles.get(id)===previous&&this.acceptGeneration(read)){
     for(const workspace of value.entries.slice(0,1))if(workspace.id===id)this.remember(workspace,read,read.head,true);
    }
    read.complete=true;
   }).catch(()=>{}).finally(()=>{read.pending=false});
 }
 private observe(id?:string):Read {
  const owner=this.sdk.observeWorkspaces({page:{limit:id?1:100},filter:{includeInternal:false,includeBackground:false,...(id?{idPrefix:id}:{})}});
  const read:Read={order:++this.readOrder,priority:id?2:1,owner,ready:false,head:-1};
  if(id)this.exact.set(id,read);else this.page=read;
  const current=()=>this.enabled&&read.owner===owner&&(id?this.exact.get(id)===read:this.page===read);
  // Subscription snapshots arrive asynchronously; publishing never awaits their RPC.
  read.detach=owner.subscribe({
   snapshot:value=>{
    if(!current())return;
    read.generation=value.sync?.generation;read.head=value.sync?.headSeq??-1;read.ready=true;
    if(!this.acceptGeneration(read)){this.release(read);if(!id)this.pageIDs.clear();return}
    const entries=value.entries.slice(0,id?1:100).filter(workspace=>!id||workspace.id===id);
    if(!id){
     this.pageIDs=new Set(entries.map(workspace=>workspace.id));
     for(const exact of this.exact.values())exact.complete=false;
    }
    for(const workspace of entries)this.remember(workspace,read,read.head);
   },
   update:message=>{
    if(!current()||!read.ready||message.type!=='workspace_update')return;
    const value=message.payload;
    if(read.generation&&value.generation&&read.generation!==value.generation){this.release(read);if(!id)this.pageIDs.clear();return}
    if(value.generation)read.generation=value.generation;
    if(value.seq!==undefined&&value.seq<=read.head)return;
    if(value.seq!==undefined)read.head=value.seq;
    if(!this.acceptGeneration(read)){this.release(read);if(!id)this.pageIDs.clear();return}
    const workspaceID=value.kind==='remove'?value.id:value.workspace.id;
    if(id&&workspaceID!==id)return;
    if(value.kind==='remove'){this.store({id:workspaceID},read,value.seq??-1);this.pageIDs.delete(workspaceID)}
    else this.remember(value.workspace,read,value.seq??-1);
   },
   error:()=>{if(current()){this.release(read);if(!id)this.pageIDs.clear()}},
  });
  void owner.ready.catch(()=>{if(current()){this.release(read);if(!id)this.pageIDs.clear()}});
  return read;
 }
 private acceptGeneration(read:Read){
  if(!read.generation)return true;
  if(read.generation===this.generation){this.generationOrder=Math.max(this.generationOrder,read.order);return true}
  if(this.retiredGenerations.has(read.generation)||read.order<this.generationOrder)return false;
  if(this.generation)this.retiredGenerations.add(this.generation);
  while(this.retiredGenerations.size>32)this.retiredGenerations.delete(this.retiredGenerations.values().next().value!);
  this.generation=read.generation;this.generationOrder=read.order;return true;
 }
 private remember(workspace:FetchWorkspacesEntry,read:Read,head:number,seed=false){
  const value:LiveWorkspace=workspace.internal||workspace.background?{id:workspace.id}:{id:workspace.id,title:workspace.title??null};
  this.store(value,read,head,seed);
 }
 private store(value:LiveWorkspace,read:Read,head:number,seed=false){
  const previous=this.titles.get(value.id);
  if(previous){
   if(previous.generation&&!read.generation)return;
   const sameGeneration=previous.generation===read.generation;
   if(sameGeneration&&head>=0&&previous.head>=0){if(head<=previous.head)return}
   else if(sameGeneration&&!seed&&previous.read!==read){
    if(previous.read.priority>read.priority&&(previous.read.owner||previous.read.order>=read.order)
     ||previous.read.priority===read.priority&&previous.read.order>read.order)return;
   }
  }
  this.titles.delete(value.id);this.titles.set(value.id,{value,read,generation:read.generation,head});
  // Retained recovery rows and exact targets share a fixed memory budget.
  while(this.titles.size>132){
   const oldest=[...this.titles.keys()].find(id=>!this.exact.has(id));
   if(oldest===undefined)break;
   this.titles.delete(oldest);
  }
 }
 private release(read:Read){
  const owner=read.owner;read.owner=undefined;read.detach?.();read.detach=undefined;read.ready=false;
  read.abort?.abort();
  void owner?.release().catch(()=>{});
 }
 stop(){
  this.enabled=false;if(this.page)this.release(this.page);this.page=undefined;
  for(const read of this.exact.values())this.release(read);
  this.exact.clear();this.pageIDs.clear();this.titles.clear();this.generation=undefined;this.generationOrder=-1;this.retiredGenerations.clear();
 }
}
