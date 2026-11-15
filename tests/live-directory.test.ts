import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveDirectory} from '../src/live-directory.ts';

test('live observation is opt-in; released/older snapshots cannot resurrect display targets',async()=>{
 let observer:any, released=0, observed=0;
 const subscription={ready:Promise.resolve({}),subscribe(value:any){observer=value;return()=>{}},async release(){released++}};
 const sdk={observeAgents(){observed++;return subscription},observeWorkspaces(){return {ready:Promise.resolve({}),subscribe(){return()=>{}},async release(){}}}} as any;
 const directory=new LiveDirectory(sdk);
 assert.equal(directory.snapshot(),null);assert.equal(observed,0);
 directory.setEnabled(true);assert.equal(observed,1);
 const agent={id:'a',status:'running',updatedAt:'2026-01-01T00:00:00Z'};
 observer.snapshot({entries:[{agent}],sync:{generation:'one',headSeq:3}});
 assert.equal(directory.snapshot()?.[0].status,'running');
 observer.update({type:'agent_update',payload:{kind:'upsert',agent:{...agent,status:'idle'},generation:'one',seq:4}});
 observer.update({type:'agent_update',payload:{kind:'upsert',agent,generation:'one',seq:3}});
 assert.equal(directory.snapshot()?.[0].status,'idle');
 directory.setEnabled(false);observer.update({type:'agent_update',payload:{kind:'upsert',agent,generation:'one',seq:5}});
 assert.equal(directory.snapshot(),null);await Promise.resolve();assert.equal(released,1);
 directory.setEnabled(true);observer.snapshot({entries:[{agent}],sync:{generation:'two',headSeq:9}});
 observer.update({type:'agent_update',payload:{kind:'remove',agentId:'a',generation:'one',seq:99}});
 assert.equal(directory.snapshot(),null,'a changed source generation requires a new authoritative snapshot');
});

test('an authoritative workspace without a title clears its name; removal remains unknown',()=>{
 const reads:any[]=[];
 const sdk={getLastServerInfoMessage(){return {features:{ownedSubscriptions:true}}},
  observeAgents(){return {ready:Promise.resolve({}),subscribe(){return()=>{}},async release(){}}},
  observeWorkspaces(){return {ready:Promise.resolve({}),subscribe(observer:any){reads.push(observer);return()=>{}},async release(){}}}} as any;
 const directory=new LiveDirectory(sdk);directory.setEnabled(true);
 reads[0].snapshot({entries:[{id:'w'}]});assert.deepEqual(directory.workspaces(),[{id:'w',title:null}]);
 reads[0].update({type:'workspace_update',payload:{kind:'remove',id:'w'}});assert.deepEqual(directory.workspaces(),[]);
 directory.requestWorkspace('w');assert.equal(reads.length,2);
 reads[1].snapshot({entries:[]});assert.deepEqual(directory.workspaces(),[],'missing records never imply a cleared name');
 reads[1].snapshot({entries:[{id:'w'}]});assert.deepEqual(directory.workspaces(),[{id:'w',title:null}]);directory.stop();
});

test('one workspace version fences stale snapshots across broad and exact owners',()=>{
 const reads:any[]=[];
 const sdk={getLastServerInfoMessage(){return {features:{ownedSubscriptions:true}}},
  observeAgents(){return {ready:Promise.resolve({}),subscribe(){return()=>{}},async release(){}}},
  observeWorkspaces(options:any){return {ready:Promise.resolve({}),subscribe(observer:any){reads.push({options,observer});return()=>{}},async release(){}}}} as any;
 const directory=new LiveDirectory(sdk);directory.setEnabled(true);directory.requestWorkspace('w');
 reads[1].observer.snapshot({entries:[{id:'w',title:'Fresh exact'}],sync:{generation:'G',headSeq:10}});
 reads[0].observer.snapshot({entries:[{id:'w',title:'Stale broad'}],sync:{generation:'G',headSeq:9}});
 assert.equal(directory.workspaces()[0].title,'Fresh exact');
 reads[0].observer.update({type:'workspace_update',payload:{kind:'upsert',workspace:{id:'w',title:'Fresh stream'},generation:'G',seq:11}});
 reads[1].observer.update({type:'workspace_update',payload:{kind:'upsert',workspace:{id:'w',title:'Stale exact stream'},generation:'G',seq:10}});
 assert.equal(directory.workspaces()[0].title,'Fresh stream');
 reads[0].observer.error();directory.setEnabled(true);
 reads[2].observer.snapshot({entries:[{id:'w',title:'New generation'}],sync:{generation:'H',headSeq:0}});
 reads[1].observer.update({type:'workspace_update',payload:{kind:'upsert',workspace:{id:'w',title:'Old generation'},generation:'G',seq:99}});
 assert.equal(directory.workspaces()[0].title,'New generation');directory.stop();
});

test('unversioned exact ownership conservatively outranks broad cache rows until a new exact observation',()=>{
 const observers:any[]=[];
 const sdk={getLastServerInfoMessage(){return {features:{ownedSubscriptions:true}}},
  observeAgents(){return {ready:Promise.resolve({}),subscribe(){return()=>{}},async release(){}}},
  observeWorkspaces(){return {ready:Promise.resolve({}),subscribe(observer:any){observers.push(observer);return()=>{}},async release(){}}}} as any;
 const directory=new LiveDirectory(sdk);directory.setEnabled(true);directory.requestWorkspace('w');
 observers[1].snapshot({entries:[{id:'w',title:'Exact current'}]});observers[0].snapshot({entries:[{id:'w',title:'Unproven broad'}]});
 assert.equal(directory.workspaces()[0].title,'Exact current');
 observers[0].update({type:'workspace_update',payload:{kind:'upsert',workspace:{id:'w',title:'Broad without order'}}});
 assert.equal(directory.workspaces()[0].title,'Exact current');
 observers[1].update({type:'workspace_update',payload:{kind:'upsert',workspace:{id:'w',title:null}}});
 assert.equal(directory.workspaces()[0].title,null);directory.stop();
});

test('the first versioned update after an unversioned snapshot establishes a generation fence',()=>{
 const reads:any[]=[];
 const sdk={getLastServerInfoMessage(){return {features:{ownedSubscriptions:true}}},
  observeAgents(){return {ready:Promise.resolve({}),subscribe(){return()=>{}},async release(){}}},
  observeWorkspaces(){return {ready:Promise.resolve({}),subscribe(observer:any){reads.push(observer);return()=>{}},async release(){}}}} as any;
 const directory=new LiveDirectory(sdk);directory.setEnabled(true);directory.requestWorkspace('w');
 reads[1].snapshot({entries:[{id:'w',title:'Initial'}]});
 reads[1].update({type:'workspace_update',payload:{kind:'upsert',workspace:{id:'w',title:'Generation G'},generation:'G',seq:1}});
 reads[1].update({type:'workspace_update',payload:{kind:'upsert',workspace:{id:'w',title:'Unadmitted H'},generation:'H',seq:0}});
 directory.setEnabled(true);assert.equal(reads.length,3,'a changed generation requires a new owner snapshot');
 reads[2].snapshot({entries:[{id:'w',title:'Admitted H'}],sync:{generation:'H',headSeq:0}});
 assert.equal(directory.workspaces()[0].title,'Admitted H');directory.stop();
});

test('legacy exact seeds never replace the broad subscription or overwrite a newer rename',async()=>{
 let observer:any;const seeds:{options:any;resolve:(value:any)=>void}[]=[];
 const sdk={getLastServerInfoMessage(){return {features:{ownedSubscriptions:false}}},
  observeAgents(){return {ready:Promise.resolve({}),subscribe(){return()=>{}},async release(){}}},
  observeWorkspaces(){return {ready:Promise.resolve({}),subscribe(value:any){observer=value;return()=>{}},async release(){}}},
  fetchWorkspaces(options:any){const seed=Promise.withResolvers<any>();seeds.push({options,resolve:seed.resolve});return seed.promise}} as any;
 const directory=new LiveDirectory(sdk);directory.setEnabled(true);observer.snapshot({entries:[]});
 directory.requestWorkspace('w');assert.equal(seeds.length,1);assert.equal(seeds[0].options.subscribe,undefined);
 observer.update({type:'workspace_update',payload:{kind:'upsert',workspace:{id:'w',title:'New rename'}}});
 seeds[0].resolve({entries:[{id:'w',title:'Old seed'}]});await Promise.resolve();await Promise.resolve();
 assert.equal(directory.workspaces()[0].title,'New rename');
 directory.requestWorkspace('later');directory.stop();seeds[1].resolve({entries:[{id:'later',title:'Late result'}]});await Promise.resolve();
 assert.deepEqual(directory.workspaces(),[]);
});

test('workspace read recovery retains confirmed names until an authoritative rename or explicit clear',()=>{
 const observers:any[]=[];
 const sdk={observeAgents(){return {ready:Promise.resolve({}),subscribe(observer:any){observers.push(observer);return()=>{}},async release(){}}},
  observeWorkspaces(){return {ready:Promise.resolve({}),subscribe(observer:any){observers.push(observer);return()=>{}},async release(){}}}} as any;
 const directory=new LiveDirectory(sdk);directory.setEnabled(true);
 observers[1].snapshot({entries:[{id:'w',title:'Confirmed'}],sync:{generation:'one',headSeq:0}});
 observers[1].error();assert.equal(directory.workspaces()[0].title,'Confirmed');
 directory.setEnabled(true);assert.equal(directory.workspaces()[0].title,'Confirmed');
 observers[2].snapshot({entries:[],sync:{generation:'two',headSeq:0}});
 assert.equal(directory.workspaces()[0].title,'Confirmed','a bounded page omitting the target cannot clear it');
 observers[2].update({type:'workspace_update',payload:{kind:'upsert',workspace:{id:'w',title:'Fresh'},generation:'two',seq:1}});
 assert.equal(directory.workspaces()[0].title,'Fresh');
 observers[2].update({type:'workspace_update',payload:{kind:'upsert',workspace:{id:'w',title:null},generation:'two',seq:2}});
 assert.equal(directory.workspaces()[0].title,null);directory.stop();
});

test('truncated workspace targets acquire bounded exact owners and reject prefix collisions or late release data',async()=>{
 const reads:{options:any;observer:any;released:boolean}[]=[];
 const sdk={observeAgents(){return {ready:Promise.resolve({}),subscribe(){return()=>{}},async release(){}}},
  getLastServerInfoMessage(){return {features:{ownedSubscriptions:true}}},
  observeWorkspaces(options:any){const read={options,observer:undefined as any,released:false};reads.push(read);
   return {ready:Promise.resolve({}),subscribe(observer:any){read.observer=observer;return()=>{}},async release(){read.released=true}}}} as any;
 const directory=new LiveDirectory(sdk);directory.setEnabled(true);
 reads[0].observer.snapshot({entries:Array.from({length:100},(_,i)=>({id:'page-'+i,title:'Other'}))});
 directory.requestWorkspace('target');directory.requestWorkspace('target');assert.equal(reads.length,2);
 assert.equal(reads[1].options.filter.idPrefix,'target');assert.equal(reads[1].options.page.limit,1);
 reads[1].observer.snapshot({entries:[{id:'target-prefix-collision',title:'Wrong'}]});
 assert.equal(directory.workspaces().find(value=>value.id==='target'),undefined);
 reads[1].observer.update({type:'workspace_update',payload:{kind:'upsert',workspace:{id:'target',title:'Exact name'}}});
 assert.equal(directory.workspaces().find(value=>value.id==='target')?.title,'Exact name');
 reads[1].observer.error();directory.setEnabled(true);
 const recovered=reads.at(-1)!;assert.equal(recovered.options.filter.idPrefix,'target');
 assert.equal(directory.workspaces().find(value=>value.id==='target')?.title,'Exact name');
 recovered.observer.snapshot({entries:[{id:'target',title:null}]});assert.equal(directory.workspaces().find(value=>value.id==='target')?.title,null);
 for(let i=0;i<40;i++)directory.requestWorkspace('missing-'+i);
 assert.equal(reads.filter(read=>!read.released).length,33,'at most 32 exact read owners plus one bounded page');
 directory.stop();await Promise.resolve();assert.ok(reads.every(value=>value.released));
 recovered.observer.snapshot({entries:[{id:'target',title:'Too late'}]});assert.deepEqual(directory.workspaces(),[]);
 directory.setEnabled(true);recovered.observer.snapshot({entries:[{id:'target',title:'Previous owner'}]});assert.deepEqual(directory.workspaces(),[]);
 const page=reads.at(-1)!;page.observer.snapshot({entries:[{id:'evicted',title:'Initial'}]});
 for(let i=0;i<140;i++)page.observer.update({type:'workspace_update',payload:{kind:'upsert',workspace:{id:'new-'+i,title:'Other'}}});
 assert.equal(directory.workspaces().find(value=>value.id==='evicted'),undefined);
 const before=reads.length;directory.requestWorkspace('evicted');
 assert.equal(reads.length,before+1,'stale page membership cannot hide an evicted cache row');
 directory.stop();
});

test('workspace ownership is active-only, exact and fenced against late snapshots or renamed releases',async()=>{
 const observers:any[]=[];let acquired=0,released=0;
 const sdk={
  observeAgents(){return {ready:Promise.resolve({}),subscribe(observer:any){observers.push(observer);return()=>{}},async release(){released++}}},
  observeWorkspaces(){acquired++;return {ready:Promise.resolve({}),subscribe(observer:any){observers.push(observer);return()=>{}},async release(){released++}}},
 } as any;
 const directory=new LiveDirectory(sdk);
 assert.equal(acquired,0);directory.setEnabled(true);assert.equal(acquired,1);
 const [agents,workspaces]=observers;
 agents.snapshot({entries:[{agent:{id:'a',title:'Raw provider',workspaceId:'w',status:'running'}}]});
 workspaces.snapshot({entries:[{id:'w',title:'Workspace name'},{id:'other',title:'Unrelated'}],sync:{generation:'one',headSeq:3}});
 assert.deepEqual(directory.workspaces(),[{id:'w',title:'Workspace name'},{id:'other',title:'Unrelated'}]);
 workspaces.update({type:'workspace_update',payload:{kind:'upsert',workspace:{id:'w',title:'New workspace name'},generation:'one',seq:4}});
 workspaces.update({type:'workspace_update',payload:{kind:'upsert',workspace:{id:'w',title:'Stale name'},generation:'one',seq:3}});
 assert.equal(directory.workspaces().find(value=>value.id==='w')?.title,'New workspace name');
 directory.setEnabled(false);assert.deepEqual(directory.workspaces(),[]);
 workspaces.snapshot({entries:[{id:'w',title:'Late stale name'}]});assert.deepEqual(directory.workspaces(),[]);
 await Promise.resolve();assert.equal(released,2);
 directory.setEnabled(true);const fresh=observers[3];
 fresh.snapshot({entries:[{id:'w',title:'New owner'}],sync:{generation:'two',headSeq:0}});
 workspaces.error();assert.equal(directory.workspaces()[0].title,'New owner');
 fresh.update({type:'workspace_update',payload:{kind:'remove',id:'w',generation:'two',seq:1}});
 assert.deepEqual(directory.workspaces(),[]);directory.stop();
});
