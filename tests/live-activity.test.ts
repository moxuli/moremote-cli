import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { webcrypto } from 'node:crypto';
import { OperationJournal } from '../src/journal.ts';
import { sealEnvelope, decode, presenceTopic } from '../src/crypto.ts';
import { LiveActivityPublisher, type LiveAgent } from '../src/live-activity.ts';

const pair = { pairId: '11111111-1111-4111-8111-111111111111', rootKey: Buffer.alloc(32, 7).toString('base64url'), active: true,
  hostToken: 'synthetic', daemonServerId: 'synthetic-daemon' };
const key = Buffer.alloc(32, 9);
const subscriptionId = '22222222-2222-4222-8222-222222222222';
const generation = '33333333-3333-4333-8333-333333333333';
const registrationId = '44444444-4444-4444-8444-444444444444';
const agent: LiveAgent = { id: 'synthetic-agent', title: '登录修复', status: 'running', pendingPermissions: [],
  createdAt: new Date(100).toISOString(), lastUserMessageAt: new Date(1000).toISOString(), activeTurn: { turnId: 'turn-one', startedAt: new Date(1000).toISOString() } };
async function interest(now = 1000, titleHints?: unknown) {
  return { registrationId, interest: await sealEnvelope(decode(pair.rootKey, 32), { version: 1, pairId: pair.pairId,
    id: subscriptionId, channel: 'activityInterest', issuedAt: now, expiresAt: now + 28_800_000 },
  { version: 2, subscriptionId, generation, hostID: 'saved-host', hostLifetime: '55555555-5555-4555-8555-555555555555',
    daemonServerId: pair.daemonServerId, displayKey: key.toString('base64url'), createdAt: now, deadline: now + 28_800_000,
    hostName: '工作站', ...(titleHints === undefined ? {} : { titleHints }) }) };
}
async function openDisplay(envelope: any) {
  const k = await webcrypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt']);
  const aad = Buffer.from(JSON.stringify([1, envelope.pairId, envelope.id, envelope.channel, envelope.issuedAt, envelope.expiresAt]));
  return JSON.parse(Buffer.from(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(envelope.nonce, 12), additionalData: aad }, k, decode(envelope.ciphertext))).toString());
}
async function fixture(body: (publisher: LiveActivityPublisher, path: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'moremote-live-')), path = join(root, 'journal.sqlite');
  const journal = new OperationJournal(path);
  try { await body(new LiveActivityPublisher(journal), path); }
  finally { journal.close(); await rm(root, { recursive: true, force: true }); }
}

test('activity-only key exposes a current private route to the phone, never labels or official IDs to cloud', async () => {
  await fixture(async publisher => {
    const info = await interest();
    const value = await publisher.prepare(pair, info, { daemonServerId: pair.daemonServerId, hostName: 'machine', agents: [agent, { ...agent, id: 'managed-child', labels: { 'paseo.parent-agent-id': agent.id } }] }, 1100);
    assert.ok(value); assert.equal(value.candidates.length, 1, 'managed child tasks never become separate conversations'); assert.equal(value.candidates[0].phase, 'running');
    assert.equal(value.candidates[0].topic, await presenceTopic(decode(pair.rootKey, 32), pair.pairId, agent.id));
    const text = JSON.stringify(value);
    for (const secret of ['登录修复', '工作站', 'saved-host', 'synthetic-agent', key.toString('base64url')]) assert.ok(!text.includes(secret));
    const decoded = await openDisplay(value.candidates[0].payload);
    assert.equal(decoded.generation, generation); assert.equal(decoded.hostID, 'saved-host');
    assert.equal(decoded.state.agentId, agent.id); assert.equal(decoded.state.title, agent.title);
    assert.equal(decoded.state.hostName, '工作站'); assert.equal(decoded.state.phase, 'running');
  });
});

test('semantic equality does not poll Worker; unknown retries survive a new publisher and keep exact bytes', async () => {
  await fixture(async (publisher, path) => {
    const info = await interest(), snapshot = { daemonServerId: pair.daemonServerId, hostName: 'machine', agents: [agent] };
    const first = await publisher.prepare(pair, info, snapshot, 1100); assert.ok(first);
    const secondConnection = new OperationJournal(path);
    try {
      const restarted = new LiveActivityPublisher(secondConnection);
      assert.deepEqual(await restarted.prepare(pair, info, { ...snapshot, agents: [{ ...agent, title: 'new title' }] }, 1200), first);
      restarted.acknowledge(pair.pairId, registrationId, first.sequence);
      const updated = await restarted.prepare(pair, info, { ...snapshot, agents: [{ ...agent, title: 'new title' }] }, 1300); assert.ok(updated);
      assert.ok(updated.sequence > first.sequence); restarted.acknowledge(pair.pairId, registrationId, updated.sequence);
      assert.equal(await restarted.prepare(pair, info, { ...snapshot, agents: [{ ...agent, title: 'new title' }] }, 1400), undefined);
    } finally { secondConnection.close(); }
  });
});

test('pending questions override running flags and retain the same turn on completion', async () => {
  await fixture(async publisher => {
    const info = await interest(), snapshot = { daemonServerId: pair.daemonServerId, hostName: 'machine', agents: [agent] };
    const running = await publisher.prepare(pair, info, snapshot, 1100); assert.ok(running);
    publisher.acknowledge(pair.pairId, registrationId, running.sequence);
    const waiting = await publisher.prepare(pair, info, { ...snapshot, agents: [{ ...agent, pendingPermissions: [{ id: 'q', kind: 'question' }] }] }, 1200); assert.ok(waiting);
    assert.equal(waiting.candidates[0].phase, 'waiting'); assert.ok(waiting.candidates[0].eventId);
    assert.equal(waiting.candidates[0].cycle, running.candidates[0].cycle);
    publisher.acknowledge(pair.pairId, registrationId, waiting.sequence);
    const finished = await publisher.prepare(pair, info, { ...snapshot, agents: [{ ...agent, status: 'idle', activeTurn: null,
      requiresAttention: true, attentionReason: 'finished', attentionTimestamp: new Date(1300).toISOString() }] }, 1400); assert.ok(finished);
    assert.equal(finished.candidates[0].phase, 'finished');
    assert.equal(finished.candidates[0].cycle, running.candidates[0].cycle);
  });
});

test('wrong daemon, expired interest and revoked pairing cannot produce activity updates', async () => {
  await fixture(async publisher => {
    const info = await interest(), snapshot = { daemonServerId: 'different', hostName: 'machine', agents: [agent] };
    await assert.rejects(publisher.prepare(pair, info, snapshot, 1100));
    await assert.rejects(publisher.prepare(pair, info, { ...snapshot, daemonServerId: pair.daemonServerId }, 28_801_000));
    await assert.rejects(publisher.prepare({ ...pair, active: false }, info, { ...snapshot, daemonServerId: pair.daemonServerId }, 1100));
  });
});

test('phone creation clocks use the same bounded skew tolerance as the authenticated envelope',async()=>{
 await fixture(async publisher=>{
  const value=await publisher.prepare(pair,await interest(2100),{daemonServerId:pair.daemonServerId,hostName:'machine',agents:[agent]},1100);
  assert.ok(value);
  await assert.rejects(publisher.prepare(pair,await interest(122000),{daemonServerId:pair.daemonServerId,hostName:'machine',agents:[agent]},1100));
 });
});

test('exact phone title provenance resolves fresh official names without freezing or guessing workspace ownership', async () => {
 await fixture(async publisher => {
  const hints = [{agentId:agent.id,workspaceId:'workspace-one',source:'workspace'}];
  const info = await interest(1000,hints);
  const snapshot = {daemonServerId:pair.daemonServerId,hostName:'machine',agents:[{...agent,workspaceId:'workspace-one'}],
   workspaces:[{id:'workspace-one',title:'Renamed workspace'}]};
  const first = await publisher.prepare(pair,info,snapshot,1100);assert.ok(first);
  assert.equal((await openDisplay(first.candidates[0].payload)).state.title,'Renamed workspace');
  publisher.acknowledge(pair.pairId,registrationId,first.sequence);
  const changed = await publisher.prepare(pair,info,{...snapshot,workspaces:[{id:'workspace-one',title:'New remote name'}]},1200);assert.ok(changed);
  assert.equal((await openDisplay(changed.candidates[0].payload)).state.title,'New remote name');
  publisher.acknowledge(pair.pairId,registrationId,changed.sequence);
  assert.equal(await publisher.prepare(pair,info,{...snapshot,workspaces:[{id:'workspace-one',title:'New remote name'}]},1300),undefined);
  for (const [caseHints,agents] of [
   [undefined,snapshot.agents],
   [[{...hints[0],source:'conversation'}],[{...snapshot.agents[0],title:'Fresh provider rename'}]],
   [[{...hints[0],workspaceId:'another-workspace'}],snapshot.agents],
   [hints,[...snapshot.agents,{...snapshot.agents[0],id:'sibling',archivedAt:'2026-01-01'}]],
  ] as const) {
   await fixture(async isolated => {
    const value = await isolated.prepare(pair,await interest(1000,caseHints),{...snapshot,agents:[...agents]},1400);assert.ok(value);
    const candidate = value.candidates.find(row=>row.topic===first.candidates[0].topic)!;
    assert.equal((await openDisplay(candidate.payload)).state.title,agents[0].title);
   });
  }
 });
});

test('title hints reject unknown fields, duplicates, invalid sources and count/UTF-8 overflow before publication', async () => {
 await fixture(async publisher => {
  const hint={agentId:agent.id,workspaceId:'workspace-one',source:'workspace'};
  const invalid:unknown[]=[null,{},[{...hint,title:'never accept cached text'}],[{...hint,source:'guess'}],[{...hint,source:['workspace']}],[hint,hint],
   [{...hint,agentId:''}],[{...hint,workspaceId:'bad/id'}],Array.from({length:33},(_,i)=>({...hint,agentId:'agent-'+i})),
   Array.from({length:16},(_,i)=>({...hint,agentId:'agent-'+i,workspaceId:'名'.repeat(100)}))];
  for(const titleHints of invalid) await assert.rejects(publisher.prepare(pair,await interest(1000,titleHints),
   {daemonServerId:pair.daemonServerId,hostName:'machine',agents:[agent]},1100));
 });
});

test('unknown workspace metadata waits without publishing the raw prompt or replacing exact unknown retries',async()=>{
 await fixture(async publisher=>{
  const info=await interest(1000,[{agentId:agent.id,workspaceId:'workspace-one',source:'workspace'}]);
  const requested:string[]=[];
  const snapshot={daemonServerId:pair.daemonServerId,hostName:'machine',agents:[{...agent,workspaceId:'workspace-one'}],
   workspaces:[],requestWorkspace:(id:string)=>{requested.push(id)}};
  assert.equal(await publisher.prepare(pair,info,snapshot,1100),undefined);
  assert.deepEqual(requested,['workspace-one']);
  const first=await publisher.prepare(pair,info,{...snapshot,workspaces:[{id:'workspace-one',title:'Confirmed name'}]},1200);assert.ok(first);
  assert.equal((await openDisplay(first.candidates[0].payload)).state.title,'Confirmed name');
  assert.deepEqual(await publisher.prepare(pair,info,snapshot,1300),first,'unacknowledged bytes remain immutable');
  publisher.acknowledge(pair.pairId,registrationId,first.sequence);
  assert.equal(await publisher.prepare(pair,info,snapshot,1400),undefined,'missing metadata never means a clear');
  const cleared=await publisher.prepare(pair,info,{...snapshot,workspaces:[{id:'workspace-one',title:null}]},1500);assert.ok(cleared);
  assert.equal((await openDisplay(cleared.candidates[0].payload)).state.title,agent.title);
 });
});
