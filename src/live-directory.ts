import {isDeepStrictEqual} from 'node:util';
import type {DaemonClient} from '@getpaseo/client/internal/daemon-client';
import type {AgentSnapshotPayload} from '@getpaseo/protocol/messages';
import {LiveWorkspaces} from './live-workspaces.js';
import {LIMITS} from './limits.js';

type TurnAnchor = Pick<AgentSnapshotPayload, 'lastUserMessageAt' | 'workspaceId'>;
interface ConfirmedTerminal extends TurnAnchor {
  turnId: string;
  updatedAt: number;
}
interface LiveRow {
  agent: AgentSnapshotPayload;
  terminal?: ConfirmedTerminal;
}

/** A separately owned local directory. Workspace decoration follows an active phone activity. */
export class LiveDirectory {
  private owner?: ReturnType<DaemonClient['observeAgents']>;
  private detach?: () => void;
  private rows = new Map<string, LiveRow>();
  private ready = false;
  private generation?: string;
  private head = -1;
  private workspaceDirectory:LiveWorkspaces;
  constructor(private sdk: DaemonClient, private changed:()=>void=()=>{}) {this.workspaceDirectory=new LiveWorkspaces(sdk)}
  setEnabled(enabled: boolean, enrich: boolean = enabled) {
    if (!enabled) { this.stop(); return; }
    if (this.owner) {this.workspaceDirectory.setEnabled(enrich);return; }
    const owner = this.sdk.observeAgents({page:{limit:100},filter:{includeArchived:false,includeInternal:false},
      sort:[{key:'updated_at',direction:'desc'}],timeout:15000});
    this.owner = owner;
    this.detach = owner.subscribe({
      snapshot: value => {
        if (this.owner !== owner) return;
        this.rows.clear();
        this.generation = value.sync?.generation; this.head = value.sync?.headSeq ?? -1;
        for (const {agent} of value.entries.slice(0,100)) this.rows.set(agent.id, {agent});
        this.ready = true;
        this.changed();
      },
      update: message => {
        if (this.owner !== owner || !this.ready || message.type !== 'agent_update') return;
        const value = message.payload;
        if (this.generation && value.generation && value.generation !== this.generation) { this.stop(); return; }
        const id = value.kind === 'upsert' ? value.agent.id : value.agentId;
        if (value.seq !== undefined && value.seq <= this.head) return;
        if (value.seq !== undefined) this.head=value.seq;
        if (value.kind === 'remove' || value.agent.archivedAt || value.agent.internal) {
          if(this.rows.delete(id))this.changed();
          return;
        }
        const agent = value.agent, row = this.rows.get(id), confirmed = row?.terminal;
        if (confirmed && precedesCompletion(agent, confirmed)) return;
        const needsUpdate=!row||!isDeepStrictEqual(displayState(row.agent),displayState(agent));
        const terminal = confirmed && sameAnchor(agent, confirmed) && !active(agent) ? confirmed : undefined;
        if (row && sameAnchor(row.agent, agent) && row.agent.activeTurn?.turnId === agent.activeTurn?.turnId) {
          row.agent = agent;
          row.terminal = terminal;
        } else {
          this.rows.set(id, {agent, terminal});
        }
        // Keep active and waiting targets before older idle history within the bounded directory.
        if (this.rows.size > 100) {
          const ranked = [...this.rows.values()].sort((a,b) =>
            Number(active(b.agent))-Number(active(a.agent)) || b.agent.updatedAt.localeCompare(a.agent.updatedAt));
          this.rows = new Map(ranked.slice(0,100).map(row => [row.agent.id, row]));
        }
        if(needsUpdate)this.changed();
      },
      error: () => { if (this.owner === owner) this.stop(); },
    });
    void owner.ready.catch(() => { if (this.owner === owner) this.stop(); });
    this.workspaceDirectory.setEnabled(enrich);
  }
  // The notification path already verifies an exact terminal snapshot. Use it
  // only while the same live subscription still holds the turn it observed
  // before the read. A replacement, removal or resubscribe wins the race.
  captureTerminalRecovery(agentId:string) {
    const owner = this.owner, row = this.rows.get(agentId), turnId = row?.agent.activeTurn?.turnId;
    if (!owner || !this.ready || !row || !turnId) return;
    return (completed:AgentSnapshotPayload, kind:'finished'|'error', timestamp:number) => {
      const now = Date.now();
      if (this.owner !== owner || this.rows.get(agentId) !== row
        || completed.id !== agentId || completed.archivedAt || completed.internal || completed.pendingPermissions.length
        || timestamp > now || timestamp + LIMITS.snapshotMs <= now) return;
      const {agent} = row;
      // Compare snapshot versions to each other. Paseo stamps attention separately.
      const evidence = {turnId, updatedAt:Date.parse(completed.updatedAt),
        lastUserMessageAt:completed.lastUserMessageAt, workspaceId:completed.workspaceId};
      const startedAt = agent.activeTurn?.startedAt, lastUserAt = agent.lastUserMessageAt;
      if (!precedesCompletion(agent, evidence) || startedAt && !(Date.parse(startedAt) < timestamp)
        || lastUserAt && !(Date.parse(lastUserAt) < timestamp)) return;
      row.terminal = evidence;
      row.agent = {...agent, status:completed.status, activeTurn:null, pendingPermissions:completed.pendingPermissions,
        requiresAttention:true, attentionReason:kind, attentionTimestamp:completed.attentionTimestamp, updatedAt:completed.updatedAt};
      this.changed();
    };
  }
  snapshot(): AgentSnapshotPayload[] | null { return this.ready ? structuredClone([...this.rows.values()].map(row => row.agent)) : null; }
  workspaces(){return this.workspaceDirectory.snapshot()}
  requestWorkspace(id:string){this.workspaceDirectory.request(id)}
  stop() {
    this.workspaceDirectory.stop();
    const owner = this.owner; this.owner = undefined; this.detach?.(); this.detach = undefined;
    this.rows.clear(); this.ready = false; this.generation = undefined; this.head = -1;
    void owner?.release().catch(()=>{});
  }
}
function displayState(agent:AgentSnapshotPayload){
  return [agent.status,agent.title,agent.workspaceId,agent.lastUserMessageAt,agent.activeTurn?.turnId,
    agent.requiresAttention,agent.attentionReason,agent.attentionTimestamp,
    (agent.pendingPermissions??[]).map(request=>[request.id,request.kind])];
}
function active(agent: AgentSnapshotPayload) { return !!agent.activeTurn || agent.pendingPermissions.length > 0 || ['running','initializing'].includes(agent.status); }

function sameAnchor(left:TurnAnchor, right:TurnAnchor) {
  return left.lastUserMessageAt === right.lastUserMessageAt && left.workspaceId === right.workspaceId;
}

function precedesCompletion(agent:AgentSnapshotPayload, evidence:ConfirmedTerminal) {
  return agent.activeTurn?.turnId === evidence.turnId && sameAnchor(agent, evidence)
    && Date.parse(agent.updatedAt) < evidence.updatedAt;
}
