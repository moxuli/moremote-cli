import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveDirectory} from '../src/live-directory.ts';

test('live observation is opt-in; released/older snapshots cannot resurrect display targets',async()=>{
 let observer:any, released=0, observed=0;
 const subscription={ready:Promise.resolve({}),subscribe(value:any){observer=value;return()=>{}},async release(){released++}};
 const sdk={observeAgents(){observed++;return subscription}} as any;
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
