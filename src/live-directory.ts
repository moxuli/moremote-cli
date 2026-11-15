import type {DaemonClient} from '@getpaseo/client/internal/daemon-client';
import type {AgentSnapshotPayload} from '@getpaseo/protocol/messages';
import {LiveWorkspaces} from './live-workspaces.js';

/** A separately owned read interest, acquired only for an active phone activity. */
export class LiveDirectory {
  private owner?: ReturnType<DaemonClient['observeAgents']>;
  private detach?: () => void;
  private agents = new Map<string, AgentSnapshotPayload>();
  private ready = false;
  private generation?: string;
  private head = -1;
  private workspaceDirectory:LiveWorkspaces;
  constructor(private sdk: DaemonClient) {this.workspaceDirectory=new LiveWorkspaces(sdk)}
  setEnabled(enabled: boolean) {
    if (!enabled) { this.stop(); return; }
    if (this.owner) {this.workspaceDirectory.setEnabled(true);return; }
    const owner = this.sdk.observeAgents({page:{limit:100},filter:{includeArchived:false,includeInternal:false},
      sort:[{key:'updated_at',direction:'desc'}],timeout:15000});
    this.owner = owner;
    this.detach = owner.subscribe({
      snapshot: value => {
        if (this.owner !== owner) return;
        this.agents.clear();
        this.generation = value.sync?.generation; this.head = value.sync?.headSeq ?? -1;
        for (const entry of value.entries.slice(0,100)) this.agents.set(entry.agent.id,entry.agent);
        this.ready = true;
      },
      update: message => {
        if (this.owner !== owner || !this.ready || message.type !== 'agent_update') return;
        const value = message.payload;
        if (this.generation && value.generation && value.generation !== this.generation) { this.stop(); return; }
        const id = value.kind === 'upsert' ? value.agent.id : value.agentId;
        if (value.seq !== undefined && value.seq <= this.head) return;
        if (value.seq !== undefined) this.head=value.seq;
        if (value.kind === 'remove') this.agents.delete(id);
        else if (value.agent.archivedAt || value.agent.internal) this.agents.delete(id);
        else this.agents.set(id,value.agent);
        // Keep active and waiting targets before older idle history within the bounded directory.
        if (this.agents.size > 100) {
          const ranked = [...this.agents.values()].sort((a,b) => Number(active(b))-Number(active(a)) || b.updatedAt.localeCompare(a.updatedAt));
          this.agents = new Map(ranked.slice(0,100).map(agent => [agent.id,agent]));
        }
      },
      error: () => { if (this.owner === owner) this.stop(); },
    });
    void owner.ready.catch(() => { if (this.owner === owner) this.stop(); });
    this.workspaceDirectory.setEnabled(true);
  }
  snapshot(): AgentSnapshotPayload[] | null { return this.ready ? structuredClone([...this.agents.values()]) : null; }
  workspaces(){return this.workspaceDirectory.snapshot()}
  requestWorkspace(id:string){this.workspaceDirectory.request(id)}
  stop() {
    this.workspaceDirectory.stop();
    const owner = this.owner; this.owner = undefined; this.detach?.(); this.detach = undefined;
    this.agents.clear(); this.ready = false; this.generation = undefined; this.head = -1;
    void owner?.release().catch(()=>{});
  }
}
function active(agent: AgentSnapshotPayload) { return !!agent.activeTurn || agent.pendingPermissions.length > 0 || ['running','initializing'].includes(agent.status); }
