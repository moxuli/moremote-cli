import {spawn,type ChildProcess} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import {managedEntry} from './service.js';
import {checkForUpdate,compatibleEntry} from './updater.js';
import {readUpdateState,writeUpdateState,updateLock,supervisorStopRequested} from './update-state.js';

export interface ManagedRuntime {child:ChildProcess;exit:Promise<number>;ready:()=>boolean;closed:()=>boolean}
export function launchRuntime(entry:string,dir:string,onReady:()=>void=()=>{}):ManagedRuntime{
 const child=spawn(process.execPath,[entry,'run','--data-dir',dir],{stdio:['ignore','inherit','inherit','ipc'],windowsHide:true,env:{...process.env,MOREMOTE_MANAGED_CHILD:'1'}});
 let ready=false,closed=false;const exit=Promise.withResolvers<number>();
 child.on('message',message=>{if(!ready&&message&&typeof message==='object'&&'kind' in message&&message.kind==='moremote-ready'){ready=true;onReady()}});
 child.once('error',()=>{closed=true;exit.resolve(1)});child.once('exit',code=>{closed=true;exit.resolve(code??1)});
 return {child,exit:exit.promise,ready:()=>ready,closed:()=>closed};
}
export async function drainRuntime(runtime:ManagedRuntime){
 if(!runtime.closed()&&runtime.child.connected)runtime.child.send({kind:'moremote-drain'},()=>{});
 // Never signal/kill during an uncertain write. Completion releases journal + ownership.
 return runtime.exit;
}
export async function startupHealthy(runtime:ManagedRuntime,signal?:AbortSignal,grace=10000,deadline=30000,cancel=()=>false){
 const start=Date.now();while(!runtime.closed()&&!signal?.aborted&&!cancel()){if(runtime.ready()&&Date.now()-start>=grace)return true;if(Date.now()-start>=deadline)return false;await sleep(100,undefined,{signal}).catch(()=>{})}return false;
}
export async function runSupervisor(dir:string,timing:{pollMs?:number;startupGraceMs?:number;startupDeadlineMs?:number}={}){
 return updateLock(dir,async()=>{
 let state=readUpdateState(dir);if(!state)throw Error('MANAGED_INSTALL_REQUIRED');
 supervisorStopRequested(dir,true);
 // Crash before commit must never turn a candidate into a last-known-good version.
 if(state.activating)await updateLock(dir,async()=>{state=readUpdateState(dir)!;state.failed=state.activating;state.error='UPDATE_INTERRUPTED';delete state.activating;delete state.pending;delete state.pendingManual;writeUpdateState(dir,state)});
 const publishReady=(version:string)=>{if(process.send&&process.connected)process.send({kind:'moremote-ready',version},undefined,undefined,()=>{})};
 const initialVersion=state.active;let runtime=launchRuntime(await managedEntry(dir,initialVersion),dir,()=>publishReady(initialVersion)),stopping=false;
 const controller=new AbortController();const stop=()=>{stopping=true;controller.abort();void drainRuntime(runtime)};
 const resumeActive=async(version:string)=>{const entry=await managedEntry(dir,version);if(supervisorStopRequested(dir))stop();if(!stopping)runtime=launchRuntime(entry,dir,()=>publishReady(version))};
 const parentMessage=(message:unknown)=>{if(message&&typeof message==='object'&&'kind' in message&&message.kind==='moremote-parent-stop')stop()};
 if(process.send){process.once('disconnect',stop);process.on('message',parentMessage);if(!process.connected)stop()}
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{
  while(!stopping&&!runtime.closed()){
   // Discovery/install happens alongside the old runtime, never in its polling loop.
   try{await checkForUpdate(dir)}catch(error){if(!(error instanceof Error&&error.message==='UPDATE_BUSY'))throw error}
   if(supervisorStopRequested(dir))stop();
   if(stopping||runtime.closed())break;
   state=readUpdateState(dir)!;
   if(state.pending&&state.enabled&&!state.manualRequired){
    try{await updateLock(dir,async()=>{
     state=readUpdateState(dir)!;if(!state.pending||!state.enabled||state.manualRequired)return;
     const candidate=state.pending;const entry=await managedEntry(dir,candidate);
     if(!await compatibleEntry(entry)){state.manualRequired=candidate;state.error='UPDATE_MANUAL_COMPATIBILITY_REQUIRED';writeUpdateState(dir,state);return}
     state.activating=candidate;writeUpdateState(dir,state);
     await drainRuntime(runtime);if(supervisorStopRequested(dir))stop();if(stopping){delete state.activating;writeUpdateState(dir,state);return}
     state=readUpdateState(dir)!;if(!state.enabled){delete state.activating;writeUpdateState(dir,state);await resumeActive(state.active);return}
     runtime=launchRuntime(entry,dir,()=>publishReady(candidate));
     const healthy=await startupHealthy(runtime,controller.signal,timing.startupGraceMs,timing.startupDeadlineMs,()=>!readUpdateState(dir)!.enabled);
     if(supervisorStopRequested(dir))stop();
     if(stopping){await drainRuntime(runtime);state=readUpdateState(dir)!;delete state.activating;writeUpdateState(dir,state);return}
     state=readUpdateState(dir)!;if(!state.enabled){await drainRuntime(runtime);delete state.activating;writeUpdateState(dir,state);await resumeActive(state.active);return}
     state=readUpdateState(dir)!;
     if(healthy){state.previous=state.active;state.active=candidate;delete state.error;delete state.failed}
     else{
      state.failed=candidate;state.error='UPDATE_START_FAILED';
      await drainRuntime(runtime);await resumeActive(state.active);
     }
     delete state.activating;delete state.pending;delete state.pendingManual;writeUpdateState(dir,state);
    });}catch(error){if(!(error instanceof Error&&error.message==='UPDATE_BUSY'))throw error}
   }
   if(supervisorStopRequested(dir))stop();
   if(stopping||runtime.closed())break;
   const wake=new AbortController();
   try{await Promise.race([sleep(timing.pollMs??60000,undefined,{signal:AbortSignal.any([controller.signal,wake.signal])}).catch(()=>{}),runtime.exit])}finally{wake.abort()}
  }
  return await runtime.exit;
 }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);process.removeListener('disconnect',stop);process.removeListener('message',parentMessage);if(!runtime.closed())await drainRuntime(runtime)}
 },'supervisor');
}
