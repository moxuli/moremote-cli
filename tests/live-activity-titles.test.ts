import test from 'node:test';
import assert from 'node:assert/strict';
import {liveTitle,parseLiveTitleHints} from '../src/live-activity-titles.ts';

const agent={id:'agent',workspaceId:'workspace',title:'Fresh provider title'};
const hint={agentId:'agent',workspaceId:'workspace',source:'workspace' as const};
test('source hints authorize only the exact workspace; partial directory uniqueness grants nothing',()=>{
 const workspaces=[{id:'workspace',title:'Workspace title'},{id:'another',title:'Unrelated title'}];
 assert.equal(liveTitle(agent,[],[agent],workspaces),agent.title);
 assert.equal(liveTitle(agent,[hint],[agent],workspaces),'Workspace title');
 assert.equal(liveTitle(agent,[{...hint,source:'conversation'}],[agent],workspaces),agent.title);
 assert.equal(liveTitle(agent,[{...hint,workspaceId:'another'}],[agent],workspaces),agent.title);
 assert.equal(liveTitle({...agent,workspaceId:'moved'},[hint],[agent],workspaces),agent.title);
 assert.equal(liveTitle(agent,[hint],[agent],[]),undefined);
 assert.equal(liveTitle(agent,[hint],[agent],[{id:'workspace',title:null}]),agent.title);
 assert.equal(liveTitle(agent,[hint],[agent],[{id:'workspace'}]),undefined);
 assert.equal(liveTitle(agent,[hint],[agent],[{id:'workspace',title:'  '}]),agent.title);
 assert.equal(liveTitle(agent,[hint],[agent,{...agent,id:'child',labels:{'paseo.parent-agent-id':'agent'}}],workspaces),'Workspace title');
 assert.equal(liveTitle(agent,[hint],[agent,{...agent,id:'sibling'}],workspaces),agent.title);
});
test('title hint count, UTF-8 budget and exact value types remain independently bounded',()=>{
 assert.equal(parseLiveTitleHints(Array.from({length:32},(_,index)=>({...hint,agentId:'agent-'+index}))).length,32);
 assert.deepEqual(parseLiveTitleHints(undefined),[]);
 const maximum=Array.from({length:4},(_,index)=>({...hint,agentId:String(index)+'a'.repeat(511),workspaceId:'w'.repeat(512)}));
 maximum[3].workspaceId=maximum[3].workspaceId.slice(Buffer.byteLength(JSON.stringify(maximum))-4000);
 assert.equal(Buffer.byteLength(JSON.stringify(maximum)),4000);
 assert.equal(parseLiveTitleHints(maximum).length,4);
 maximum[3].workspaceId+='w';assert.throws(()=>parseLiveTitleHints(maximum));
 for(const value of [[{...hint,agentId:42}],[{...hint,workspaceId:null}],[{...hint,source:['workspace']}],[{...hint,source:'workspace',title:'cached'}]])assert.throws(()=>parseLiveTitleHints(value));
});
