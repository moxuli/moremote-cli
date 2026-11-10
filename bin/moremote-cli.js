#!/usr/bin/env node
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {realpath} from 'node:fs/promises';
async function main(){
 const {dataDirectory}=await import('../dist/config.js');
 const {readUpdateState}=await import('../dist/update-state.js');
 const {managedEntry}=await import('../dist/service.js');
 // Dispatch before parsing: an old global frontend must accept a newer
 // selected CLI's flags, including --version. Never overwrite that frontend.
 let dir=dataDirectory();const args=process.argv.slice(2);
 for(let i=0;i<args.length&&args[i]!=='--';i++){
  if(args[i]==='--data-dir'&&args[i+1])dir=args[++i];
  else if(args[i].startsWith('--data-dir='))dir=args[i].slice(11);
 }
 const state=readUpdateState(resolve(dir));
 if(state&&!process.env.MOREMOTE_MANAGED_CHILD){
  const entry=await managedEntry(resolve(dir),state.active);
  if(await realpath(entry)!==await realpath(fileURLToPath(import.meta.url))){
   const child=spawn(process.execPath,[entry,...args],{stdio:['inherit','inherit','inherit','ipc'],shell:false,windowsHide:true});
   const result=Promise.withResolvers();child.once('error',result.reject);child.once('exit',code=>result.resolve(code??1));
   const ready=message=>{if(message&&typeof message==='object'&&message.kind==='moremote-ready'&&typeof message.version==='string'&&process.send&&process.connected)process.send({kind:'moremote-ready',version:message.version},undefined,undefined,()=>{})};
   child.on('message',ready);
   const forward=signal=>{if(child.exitCode!==null||child.signalCode!==null)return;if(process.platform==='win32'&&child.connected)child.send({kind:'moremote-parent-stop'},()=>{});else child.kill(signal)};
   const interrupt=()=>forward('SIGINT'),terminate=()=>forward('SIGTERM');
   process.once('SIGINT',interrupt);process.once('SIGTERM',terminate);
   if(process.send){process.once('disconnect',terminate);if(!process.connected)terminate()}
   try{process.exitCode=await result.promise}finally{child.removeListener('message',ready);process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',terminate);process.removeListener('disconnect',terminate);if(process.connected)process.disconnect()}return;
  }
 }
 await import('../dist/cli.js');
}
main().catch(error=>{console.error(error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'CLI_BOOTSTRAP_FAILED');process.exitCode=1;});
