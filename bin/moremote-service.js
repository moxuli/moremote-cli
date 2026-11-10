#!/usr/bin/env node
// Retained with its immutable bootstrap package; never points at the global install.
import('../dist/supervisor.js').then(async ({runSupervisor})=>{
 if(process.argv[2]==='--probe')return;
 const index=process.argv.indexOf('--data-dir');if(index<0||!process.argv[index+1])throw Error('DATA_DIRECTORY_REQUIRED');
 process.exitCode=await runSupervisor(process.argv[index+1]);
}).catch(()=>{console.error('MANAGED_SUPERVISOR_FAILED');process.exitCode=1;});
