import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

interface Query {program:string;args:string[];status:number;output:string;error:string}
const windowsQuery="$ErrorActionPreference='Stop'; try { $task=Get-ScheduledTask -TaskName 'MoRemoteCLI' -TaskPath '\\' -ErrorAction Stop; Export-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath } catch { if ($_.CategoryInfo.Category -eq 'ObjectNotFound') { exit 3 }; exit 1 }";

// A temporary HOME does not isolate the native manager's current-user domain.
// Redirect queries into an inert child process, and audit every manager call.
export async function absentServiceManager(home:string){
 const script=join(home,'service-manager.cjs'),preload=join(home,'service-manager-preload.mjs'),log=join(home,'service-manager.jsonl');
 const queries:Query[]=[
  {program:'launchctl',args:['print','gui/'+process.getuid?.()+'/com.moremote.cli'],status:113,output:'',error:'Could not find service\n'},
  {program:'systemctl',args:['--user','show','moremote-cli.service','--property=FragmentPath,LoadState,ActiveState'],status:0,output:'LoadState=not-found\nFragmentPath=\n',error:''},
  {program:'powershell.exe',args:['-NoProfile','-NonInteractive','-Command',windowsQuery],status:3,output:'',error:''}
 ];
 await writeFile(script,`const fs=require('node:fs');const [program,...args]=process.argv.slice(2);const queries=${JSON.stringify(queries)};
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({program,args})+'\\n');
const query=queries.find(candidate=>candidate.program===program&&JSON.stringify(candidate.args)===JSON.stringify(args));
if(!query)throw Error('UNEXPECTED_SERVICE_MUTATION');
process.stdout.write(query.output);process.stderr.write(query.error);process.exitCode=query.status;
`,{mode:0o600});
 await writeFile(preload,`import processes from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
const realSpawn=processes.spawn;processes.spawn=(program,args,options)=>['launchctl','systemctl','powershell.exe','schtasks'].includes(program)?realSpawn(process.execPath,[${JSON.stringify(script)},program,...args],options):realSpawn(program,args,options);syncBuiltinESMExports();
`,{mode:0o600});
 const verify=async()=>{
  let contents='';try{contents=await readFile(log,'utf8')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  for(const line of contents.trim().split('\n').filter(Boolean)){
   const call=JSON.parse(line);assert.ok(queries.some(query=>query.program===call.program&&JSON.stringify(query.args)===JSON.stringify(call.args)),'synthetic diagnostics must not mutate service registrations');
  }
 };
 return {preload:pathToFileURL(preload).href,verify};
}
