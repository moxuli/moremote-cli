import {exact,object} from './limits.js';

export interface LiveTitleHint {agentId:string;workspaceId:string;source:'conversation'|'workspace'}
export interface LiveWorkspace {id:string;title?:string|null}
interface TitleAgent {id:string;title:string|null;workspaceId?:string;labels?:Record<string,string>}

export function liveIdentifier(value:unknown):value is string {
 return typeof value==='string'&&value.length>0&&Buffer.byteLength(value)<=512&&!/[\s/\\\x00-\x1f]/u.test(value);
}
export function parseLiveTitleHints(value:unknown):LiveTitleHint[] {
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length>32||Buffer.byteLength(JSON.stringify(value))>4000)throw Error('INVALID_LIVE_ACTIVITY_TITLE_HINTS');
 const seen=new Set<string>();
 return value.map(raw=>{
  const hint=object(raw);exact(hint,['agentId','workspaceId','source']);
  if(!liveIdentifier(hint.agentId)||!liveIdentifier(hint.workspaceId)||(hint.source!=='conversation'&&hint.source!=='workspace')||seen.has(hint.agentId))throw Error('INVALID_LIVE_ACTIVITY_TITLE_HINTS');
  seen.add(hint.agentId);return hint as unknown as LiveTitleHint;
 });
}

/** A partial directory may disprove a workspace hint, never manufacture one. */
export function liveTitle(agent:TitleAgent,hints:readonly LiveTitleHint[],agents:readonly TitleAgent[],workspaces:readonly LiveWorkspace[]):string|undefined {
 const hint=hints.find(value=>value.agentId===agent.id&&value.workspaceId===agent.workspaceId);
 if(hint?.source==='workspace'){
  const roots=new Set(agents.filter(value=>value.workspaceId===hint.workspaceId&&!value.labels?.['paseo.parent-agent-id']?.trim()).map(value=>value.id));
  const workspace=workspaces.find(value=>value.id===hint.workspaceId);
  if(roots.size<=1){
   if(!workspace||workspace.title===undefined)return;
   if(workspace.title?.trim())return workspace.title.trim();
  }
 }
 return agent.title||'会话';
}
