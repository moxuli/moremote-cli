import { createHmac, randomBytes, randomUUID, webcrypto } from 'node:crypto';
import type { Pair } from './config.js';
import { decode, openEnvelope, presenceTopic, validateEnvelope, type Envelope, type Metadata } from './crypto.js';
import { canonical, type OperationJournal } from './journal.js';
import { LIMITS, UUID, exact, object } from './limits.js';
import {liveIdentifier as identifier,liveTitle,parseLiveTitleHints,type LiveWorkspace} from './live-activity-titles.js';

export interface LiveAgent {
  id: string;
  title: string | null;
  workspaceId?: string;
  status: string;
  createdAt: string;
  lastUserMessageAt: string | null;
  activeTurn?: { turnId: string; startedAt: string | null } | null;
  pendingPermissions: readonly { id: string; kind?: string }[];
  requiresAttention?: boolean;
  attentionReason?: string | null;
  attentionTimestamp?: string | null;
  internal?: boolean;
  labels?: Record<string, string>;
  archivedAt?: string | null;
}
export interface LiveSnapshot { daemonServerId: string; hostName: string; agents: LiveAgent[];workspaces?:LiveWorkspace[];requestWorkspace?:(id:string)=>void }
export interface LiveInterest { registrationId: string; interest: Envelope }
interface Interest {
  version: 2;
  subscriptionId: string;
  generation: string;
  hostID: string;
  hostLifetime: string;
  daemonServerId: string;
  displayKey: string;
  createdAt: number;
  deadline: number;
  hostName?: string;
}
type Phase = 'running' | 'waiting' | 'finished' | 'error' | 'idle';
interface Candidate { topic: string; cycle: string; phase: Phase; lastUserAt: number; eventId?: string; payload: Envelope }
export interface LiveContribution {
  subscriptionId: string;
  generation: string;
  registrationId: string;
  sequence: number;
  measuredAt: number;
  expiresAt: number;
  candidates: Candidate[];
}
interface Cycle { lastUserAt: number; turnId: string | null; cycle: string }
interface Publication {
  registrationId: string;
  fingerprint: string;
  sequence: number;
  acknowledged: boolean;
  stopped?: boolean;
  deadline: number;
  contribution: LiveContribution;
  cycles: Record<string, Cycle>;
}

/** Durable display publication only. No command execution or remote tracking authority. */
export class LiveActivityPublisher {
  constructor(private journal: OperationJournal) {}
  async prepare(pair: Pair, raw: LiveInterest, snapshot: LiveSnapshot, now = Date.now()): Promise<LiveContribution | undefined> {
    if (!pair.active || pair.revokedAt !== undefined || pair.relayRetiredAt !== undefined
      || this.journal.pairRevoked(pair.pairId) || !UUID.test(raw.registrationId)
      || raw.interest.channel !== 'activityInterest') throw Error('INVALID_LIVE_ACTIVITY_SOURCE');
    const value = object(await openEnvelope(decode(pair.rootKey, 32), raw.interest, now));
    exact(value, ['version', 'subscriptionId', 'generation', 'hostID', 'hostLifetime', 'daemonServerId', 'displayKey', 'createdAt', 'deadline', 'hostName', 'titleHints']);
    const titleHints=parseLiveTitleHints(value.titleHints);
    if (value.version !== 2 || value.subscriptionId !== raw.interest.id || !UUID.test(String(value.generation))
      || !UUID.test(String(value.hostLifetime)) || !identifier(value.hostID) || !identifier(value.daemonServerId)
      || value.daemonServerId !== snapshot.daemonServerId || pair.daemonServerId && value.daemonServerId !== pair.daemonServerId
      || !Number.isSafeInteger(value.createdAt) || Number(value.createdAt) < 0 || Number(value.createdAt) > now + LIMITS.futureMs
      || Number(value.deadline) <= Number(value.createdAt)
      || value.deadline !== raw.interest.expiresAt || Number(value.deadline) > Number(value.createdAt) + 28_800_000
      || value.hostName !== undefined && (typeof value.hostName !== 'string' || Buffer.byteLength(value.hostName) > 240)) throw Error('INVALID_LIVE_ACTIVITY_INTEREST');
    const interest = value as unknown as Interest, key = decode(interest.displayKey, 32);
    let old = this.journal.livePublication<Publication>(pair.pairId);
    if (old?.registrationId !== raw.registrationId || old.deadline <= now) old = undefined;
    if (old?.stopped) return;
    if (old && !old.acknowledged && old.contribution.expiresAt > now) return old.contribution;
    const agents = snapshot.agents.filter(agent => !agent.internal && !agent.archivedAt && !agent.labels?.['paseo.parent-agent-id']?.trim());
    if (new Set(agents.map(agent => agent.id)).size !== agents.length) throw Error('DUPLICATE_LIVE_ACTIVITY_TARGET');
    if (agents.length > 100) throw Error('LIVE_ACTIVITY_CANDIDATE_LIMIT');
    for(const hint of titleHints){
      if(hint.source==='workspace'&&agents.some(agent=>agent.id===hint.agentId&&agent.workspaceId===hint.workspaceId)){
        try{snapshot.requestWorkspace?.(hint.workspaceId)}catch{/* Display state can still publish without the title. */}
      }
    }
    const cycles: Record<string, Cycle> = {};
    const projected = await Promise.all(agents.map(async agent => {
      if (!identifier(agent.id) || (time(agent.lastUserMessageAt) ?? 0) > now) throw Error('INVALID_LIVE_ACTIVITY_TARGET');
      const lastUserAt = time(agent.lastUserMessageAt) ?? time(agent.createdAt) ?? 0;
      const previous = old?.cycles[agent.id], turnId = agent.activeTurn?.turnId ?? null;
      const cycle = !turnId && previous?.lastUserAt === lastUserAt ? previous.cycle
        : tag(key, [interest.hostLifetime, agent.id, lastUserAt, turnId ?? '']);
      cycles[agent.id] = { lastUserAt, turnId, cycle };
      const phase = phaseFor(agent, now);
      const title = liveTitle(agent, titleHints, snapshot.agents, snapshot.workspaces ?? []) ?? '会话';
      const topic = await presenceTopic(decode(pair.rootKey, 32), pair.pairId, agent.id);
      const eventId = ['waiting', 'finished', 'error'].includes(phase)
        ? tag(key, [cycle, phase, phase === 'waiting' ? canonical(agent.pendingPermissions) : agent.attentionTimestamp ?? '']) : undefined;
      return { topic, cycle, phase, lastUserAt, ...(eventId ? { eventId } : {}),
        state: { version: 1, subscriptionId: interest.subscriptionId, daemonServerId: snapshot.daemonServerId,
          agentId: agent.id, title: bounded(title, 160, 480),
          hostName: bounded(interest.hostName ?? snapshot.hostName, 80, 240), phase, startedAt: null,
          requiresAttention: phase === 'waiting', isTerminal: phase === 'finished' || phase === 'error' } };
    }));
    projected.sort((a, b) => a.topic.localeCompare(b.topic));
    const fingerprint = canonical(projected);
    if (old?.acknowledged && old.fingerprint === fingerprint && old.contribution.expiresAt - now > 120_000) return;
    const sequence = (old?.sequence ?? 0) + 1, measuredAt = Math.max(now, (old?.contribution.measuredAt ?? -1) + 1);
    const expiresAt = Math.min(interest.deadline, measuredAt + 600_000);
    const candidates = await Promise.all(projected.map(async candidate => {
      const { state, ...routing } = candidate;
      const plain = { version: 2, subscriptionId: interest.subscriptionId, generation: interest.generation,
        hostID: interest.hostID, hostLifetime: interest.hostLifetime, topic: candidate.topic,
        state: { ...state, measuredAt, expiresAt } };
      const payload = await sealDisplay(key, { version: 1, pairId: pair.pairId, id: randomUUID(), channel: 'activityState',
        issuedAt: measuredAt, expiresAt }, plain);
      if (Buffer.byteLength(JSON.stringify(payload)) > 2700) throw Error('LIVE_ACTIVITY_PAYLOAD_LIMIT');
      return { ...routing, payload };
    }));
    const contribution = { subscriptionId: interest.subscriptionId, generation: interest.generation,
      registrationId: raw.registrationId, sequence, measuredAt, expiresAt, candidates };
    this.journal.saveLivePublication(pair.pairId, interest.deadline, { registrationId: raw.registrationId, fingerprint,
      sequence, acknowledged: false, deadline: interest.deadline, contribution, cycles } satisfies Publication);
    return contribution;
  }
  stop(pairId: string, registrationId: string, sequence: number) {
    const publication = this.journal.livePublication<Publication>(pairId);
    if (!publication || publication.registrationId !== registrationId || publication.sequence !== sequence) return;
    publication.stopped = true;
    this.journal.saveLivePublication(pairId, publication.deadline, publication);
  }
  acknowledge(pairId: string, registrationId: string, sequence: number) {
    const publication = this.journal.livePublication<Publication>(pairId);
    if (!publication || publication.registrationId !== registrationId || publication.sequence !== sequence) return;
    publication.acknowledged = true;
    this.journal.saveLivePublication(pairId, publication.deadline, publication);
  }
}

function time(value: string | null | undefined) { const parsed = value ? Date.parse(value) : NaN; return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null; }
function tag(key: Uint8Array, value: unknown[]) { return createHmac('sha256', key).update(JSON.stringify(value)).digest('base64url'); }
function phaseFor(agent: LiveAgent, now: number): Phase {
  if (agent.status === 'error') return 'error';
  if (agent.status === 'closed') return 'finished';
  if (agent.pendingPermissions.length || agent.requiresAttention && agent.attentionReason === 'permission') return 'waiting';
  if (agent.activeTurn || ['running', 'initializing'].includes(agent.status)) return 'running';
  const event = time(agent.attentionTimestamp), user = time(agent.lastUserMessageAt);
  const current = event === null ? agent.requiresAttention : event <= now && (user === null || event >= user);
  if (current && agent.attentionReason === 'error') return 'error';
  if (current && agent.attentionReason === 'finished') return 'finished';
  return 'idle';
}
function bounded(value: string, characters: number, bytes: number) {
  let result = '', count = 0;
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)) {
    if (++count > characters || Buffer.byteLength(result) + Buffer.byteLength(segment) > bytes) break;
    result += segment;
  }
  return result;
}
async function sealDisplay(key: Uint8Array, metadata: Metadata & { channel: 'activityState' }, value: unknown): Promise<Envelope> {
  const nonce = randomBytes(12), cryptoKey = await webcrypto.subtle.importKey('raw', Uint8Array.from(key), 'AES-GCM', false, ['encrypt']);
  const aad = Buffer.from(JSON.stringify([1, metadata.pairId, metadata.id, metadata.channel, metadata.issuedAt, metadata.expiresAt]));
  const encrypted = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad }, cryptoKey, Buffer.from(JSON.stringify(value)));
  const envelope = { ...metadata, nonce: nonce.toString('base64url'), ciphertext: Buffer.from(encrypted).toString('base64url') };
  return validateEnvelope(envelope, metadata.issuedAt);
}
