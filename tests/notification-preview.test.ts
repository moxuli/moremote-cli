import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {AgentSnapshotPayloadSchema} from '@getpaseo/protocol/messages';
import {buildNotificationPreview} from '../src/notification-preview.ts';
import {queueAttention} from '../src/runtime.ts';
import {OperationJournal} from '../src/journal.ts';
import {openEnvelope} from '../src/crypto.ts';

const agent=AgentSnapshotPayloadSchema.parse({id:'synthetic-agent',provider:'claude',cwd:'/synthetic/project',model:null,createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z',lastUserMessageAt:'2026-01-01T00:00:00Z',status:'idle',capabilities:{supportsStreaming:true,supportsSessionPersistence:true,supportsDynamicModes:false,supportsMcpServers:false,supportsReasoningStream:false,supportsToolInvocations:true},currentModeId:null,availableModes:[],pendingPermissions:[],persistence:null,title:'修复登录问题'});

test('completion contains exact session, computer and current answer instead of reasoning/older results',()=>{
 const entries=[{timestamp:'2025-12-31T23:59:59Z',item:{type:'assistant_message',text:'Old answer'}},{timestamp:'2026-01-01T00:00:01Z',item:{type:'reasoning',text:'PRIVATE REASONING'}},{timestamp:'2026-01-01T00:00:02Z',item:{type:'assistant_message',text:'**已修复登录问题**，三项测试通过。'}}];
 assert.deepEqual(buildNotificationPreview(agent,'测试电脑','finished',undefined,entries),{title:'修复登录问题',hostName:'测试电脑',body:'已修复登录问题，三项测试通过。'});
 assert.equal(buildNotificationPreview(agent,'测试电脑','finished',undefined,entries.slice(0,2)).body,'');
});

test('questions and approvals expose the actual request; failures expose the concrete error',()=>{
 const question={id:'q',provider:'codex',name:'Question',kind:'question' as const,title:'Question 1',input:{questions:[{question:'选择哪种布局？',options:[{label:'紧凑概况'},{label:'全部列表'}]}]}};
 assert.match(buildNotificationPreview(agent,'电脑','question',question).body,/选择哪种布局/);
 assert.match(buildNotificationPreview(agent,'电脑','question',question).body,/紧凑概况/);
 const plan={id:'p',provider:'codex',name:'Plan',kind:'plan' as const,input:{plan:'升级客户端，然后验证通知。'}};
 assert.match(buildNotificationPreview(agent,'电脑','permission',plan).body,/升级客户端/);
 assert.equal(buildNotificationPreview({...agent,lastError:'Connection timed out'},'电脑','error').body,'Connection timed out');
});

test('large Unicode and rich code are bounded and never expose raw generated UI or control characters',()=>{
 const preview=buildNotificationPreview({...agent,title:'😀'.repeat(300)},'主机'.repeat(300),'finished',undefined,[{timestamp:'2026-01-01T00:00:01Z',item:{type:'assistant_message',text:'已完成\u202e。\n```paseo-openui\nroot = Card([PRIVATE_PROGRAM])\n```\n'+ '👩‍💻'.repeat(500)}}]);
 assert.ok(Buffer.byteLength(preview.title)<=256);assert.ok(Buffer.byteLength(preview.hostName)<=128);assert.ok(Buffer.byteLength(preview.body)<=960);
 assert.ok(!preview.body.includes('PRIVATE_PROGRAM'));assert.ok(!preview.body.includes('\u202e'));assert.ok(!preview.body.includes('\ufffd'));
});

test('display preview is separately encrypted; legacy navigation and exact retry bytes remain unchanged',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'moremote-preview-'));const j=new OperationJournal(join(dir,'j.sqlite'));
 const pair={pairId:'11111111-1111-4111-8111-111111111111',rootKey:Buffer.alloc(32,7).toString('base64url'),hostToken:'synthetic',active:true};
 try{
  const event={agentId:agent.id,kind:'finished' as const,timestamp:1000,preview:{title:agent.title!,hostName:'测试电脑',body:'已完成登录修复。'}};
  await queueAttention(j,pair,event,1001);const first=j.attention(pair.pairId,1001)[0];
  assert.deepEqual(await openEnvelope(Buffer.alloc(32,7),first.body.envelope,1001),{agentId:agent.id,kind:'finished',timestamp:1000});
  assert.ok(first.body.preview,'encrypted presentation must reach durable publication');
  const display=await openEnvelope(Buffer.alloc(32,7),first.body.preview,1001);
  assert.deepEqual(display,{type:'notificationPreview',version:1,agentId:agent.id,kind:'finished',timestamp:1000,...event.preview});
  assert.ok(!JSON.stringify(first).includes('登录'));assert.ok(!JSON.stringify(first).includes('测试电脑'));
  await queueAttention(j,pair,{...event,preview:{...event.preview,body:'changed'}},1002);assert.deepEqual(j.attention(pair.pairId,1002)[0],first);
 }finally{j.close();await rm(dir,{recursive:true,force:true})}
});


test('old relays get immutable legacy events without the new field; maximum multibyte previews fit APNs',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'moremote-preview-rollout-'));const j=new OperationJournal(join(dir,'j.sqlite'));
 const pair={pairId:'11111111-1111-4111-8111-111111111111',rootKey:Buffer.alloc(32,7).toString('base64url'),hostToken:'synthetic',active:true};
 try{
  const event={agentId:'a',kind:'finished' as const,timestamp:1000,preview:{title:'标题'.repeat(200),hostName:'主机'.repeat(200),body:'😀'.repeat(1000)}};
  await queueAttention(j,pair,event,1001,false);assert.equal(j.attention(pair.pairId,1001)[0].body.preview,undefined);
  await queueAttention(j,pair,{...event,timestamp:2000},2001,true);
  const item=j.attention(pair.pairId,2001).find(r=>r.body.preview)!;assert.ok(item);
  const payload={aps:{alert:{title:'MoRemote',body:'一项任务需要你的回复。'},sound:'default',category:'moremote.enhancement.permission','mutable-content':1},pairId:pair.pairId,eventId:item.id,kind:'finished',route:item.body.envelope,preview:item.body.preview};
  assert.ok(Buffer.byteLength(JSON.stringify(payload))<=4096);
  assert.equal((await openEnvelope(Buffer.alloc(32,7),item.body.preview,2001) as {title:string}).title.startsWith('标题'),true);
 }finally{j.close();await rm(dir,{recursive:true,force:true})}
});
