import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {privateManagedDirectory,loadConfig} from '../src/config.ts';
import {initialUpdateState,writeUpdateState,disableAutoUpdate,readUpdateState} from '../src/update-state.ts';
import {serviceDefinition} from '../src/service.ts';
import {enrollmentFixture,origin} from './enrollment-fixture.ts';

const nativeFixture={skip:process.platform==='win32'?'POSIX executable manager fixture; Windows lifecycle has separate adapter consumers':false,timeout:20000};
for(const managed of [false,true])test('actual setup command uses '+(managed?'retained managed runtime without changing update policy':'current source runtime without installing the older public package'),nativeFixture,async t=>{
 const f=await enrollmentFixture(t),tools=join(f.home,'tools'),log=join(f.home,'manager.jsonl');await mkdir(tools,{mode:0o700});
 const script=`#!${process.execPath}
const fs=require('node:fs');const args=process.argv.slice(2);fs.appendFileSync(process.env.SETUP_LOG,JSON.stringify(args)+'\\n');
if(args[0]==='print'){console.error('Could not find service');process.exit(113)}
if(args.includes('show'))console.log('LoadState=not-found\\nFragmentPath=');
`;
 for(const program of ['launchctl','systemctl'])await writeFile(join(tools,program),script,{mode:0o700});
 const npm=join(tools,'npm-cli.js');await writeFile(npm,"throw Error('UNEXPECTED_NPM_INSTALL');\n",{mode:0o600});
 let expected=fileURLToPath(new URL('../bin/moremote-cli.js',import.meta.url)),updateBefore:string|undefined;
 if(managed){
  const root=join(f.state,'managed'),versions=join(root,'versions');await privateManagedDirectory(root);await privateManagedDirectory(versions);
  const packageRoot=join(versions,'0.1.3','node_modules','@moxuli','moremote');
  await mkdir(join(packageRoot,'bin'),{recursive:true,mode:0o700});await mkdir(join(packageRoot,'dist'),{mode:0o700});
  await writeFile(join(packageRoot,'package.json'),JSON.stringify({name:'@moxuli/moremote',version:'0.1.3',moremote:{updateProtocol:1,journalSchema:1,wireProtocol:1,localEnrollment:1,configBytes:524288}}),{mode:0o600});
  await writeFile(join(packageRoot,'bin','moremote-cli.js'),'// Synthetic retained frontend.\n',{mode:0o600});
  await writeFile(join(packageRoot,'dist','cli.js'),'// Synthetic retained runtime.\n',{mode:0o600});
  expected=join(packageRoot,'bin','moremote-service.js');await writeFile(expected,"if(!process.argv.includes('--probe'))throw Error('UNEXPECTED_SERVICE_START');\n",{mode:0o600});
  writeUpdateState(f.state,initialUpdateState('0.1.3'));disableAutoUpdate(f.state);updateBefore=await readFile(join(root,'update.json'),'utf8');
 }
 const child=spawn(process.execPath,['--import','tsx','src/cli.ts','setup','--yes','--data-dir',f.state],{cwd:new URL('..',import.meta.url),env:{...process.env,HOME:f.home,USERPROFILE:f.home,XDG_CONFIG_HOME:join(f.home,'config'),PATH:tools,npm_execpath:npm,PASEO_HOME:f.paseoHome,PASEO_PASSWORD:'',SETUP_LOG:log},stdio:['ignore','pipe','pipe']});
 let output='',error='';child.stdout.on('data',chunk=>{output+=chunk});child.stderr.on('data',chunk=>{error+=chunk});const [code]=await once(child,'exit');assert.equal(code,0,error);
 const definition=serviceDefinition(process.platform,f.home,process.execPath,expected,f.state),content=await readFile(definition.path,'utf8');assert.equal(content,definition.content);
 const commands=(await readFile(log,'utf8')).trim().split('\n').map(line=>JSON.parse(line) as unknown);
 assert.ok(commands.some(command=>Array.isArray(command)&&(command.includes('bootstrap')||command.includes('enable'))));
 const config=await loadConfig(f.state);assert.equal(config.apiOrigin,origin);assert.equal(config.cloudEnabled,true);assert.deepEqual(config.localEnrollment,{home:f.home});assert.equal(config.pairs.length,0);assert.equal(f.cloudRequests.length,0);
 if(managed){assert.equal(readUpdateState(f.state)?.enabled,false);assert.equal(await readFile(join(f.state,'managed','update.json'),'utf8'),updateBefore)}
 assert.doesNotMatch(output,/rootKey|enrollmentToken|hostToken/);assert.doesNotMatch(error,/rootKey|enrollmentToken|hostToken/);
 await f.verifyOfficial();
});
