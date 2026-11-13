import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {access,cp,mkdir,readdir,readFile,writeFile,symlink} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {privateManagedDirectory,loadConfig,saveConfig} from '../src/config.ts';
import {initialUpdateState,writeUpdateState,readUpdateState,disableAutoUpdate} from '../src/update-state.ts';
import {makeOffer} from '../src/pairing.ts';
import {serviceDefinition} from '../src/service.ts';
import {enrollmentFixture,daemon,origin} from './enrollment-fixture.ts';

const exec=promisify(execFile),repo=fileURLToPath(new URL('..',import.meta.url));
const options={skip:process.platform==='win32'?'POSIX native-manager fixture; protocol/ownership coverage is portable':false,timeout:45000};

for(const outcome of ['available','unavailable','missing-capability'])test('public 0.1.2 retained installation setup migration: '+outcome,options,async t=>{
 const f=await enrollmentFixture(t),tools=join(f.home,'tools'),registryRequests:string[]=[];await mkdir(tools,{mode:0o700});
 const managed=join(f.state,'managed'),versions=join(managed,'versions');await privateManagedDirectory(managed);await privateManagedDirectory(versions);
 const oldPrefix=join(versions,'0.1.2');await mkdir(oldPrefix,{mode:0o700});
 const extracted=join(f.home,'published');await mkdir(extracted);
 await exec('/usr/bin/tar',['-xf',join(repo,'tests','fixtures','moxuli-moremote-0.1.2.tar.gz'),'-C',extracted]);
 const oldRoot=join(oldPrefix,'node_modules','@moxuli','moremote');await mkdir(dirname(oldRoot),{recursive:true,mode:0o700});await cp(join(extracted,'package'),oldRoot,{recursive:true});
 assert.equal(JSON.parse(await readFile(join(oldRoot,'package.json'),'utf8')).version,'0.1.2');
 const state=initialUpdateState('0.1.2');state.lastCheck=Date.now();state.nextCheck=Date.now()+21600000;writeUpdateState(f.state,state);disableAutoUpdate(f.state);
 const policy=await readFile(join(managed,'auto-disabled'));
 const config=await loadConfig(f.state),active=makeOffer(origin).pair,revoked=makeOffer('https://synthetic-former-relay.example.test').pair;
 active.active=true;active.daemonServerId=daemon;revoked.revokedAt=1;revoked.daemonServerId='retired-daemon';config.pairs=[active,revoked];await saveConfig(f.state,config);
 const originalConfig=await readFile(join(f.state,'config.json'));

 // Compile the unchanged production source into disposable package bytes, not a
 // handler stub and not the potentially stale checkout dist. Runtime dependencies
 // are supplied from the already installed isolated consumer dependency tree.
 const build=join(f.home,'build','package');await mkdir(join(build,'dist'),{recursive:true,mode:0o700});await cp(join(repo,'bin'),join(build,'bin'),{recursive:true});
 for(const name of await readdir(join(repo,'src')))if(name.endsWith('.ts')){
  const source=await readFile(join(repo,'src',name),'utf8');const result=ts.transpileModule(source,{fileName:name,compilerOptions:{target:ts.ScriptTarget.ES2024,module:ts.ModuleKind.ESNext}});
  await writeFile(join(build,'dist',name.replace(/\.ts$/,'.js')),result.outputText,{mode:0o600});
 }
 const manifest=JSON.parse(await readFile(join(repo,'package.json'),'utf8'));assert.equal(manifest.version,'0.1.3');manifest.dependencies={};delete manifest.devDependencies;delete manifest.scripts;
 await writeFile(join(build,'package.json'),JSON.stringify(manifest),{mode:0o600});
 const globalRoot=join(f.home,'global','node_modules','@moxuli','moremote');await mkdir(dirname(globalRoot),{recursive:true,mode:0o700});await cp(build,globalRoot,{recursive:true});
 if(outcome==='missing-capability'){delete manifest.moremote.localEnrollment;await writeFile(join(build,'package.json'),JSON.stringify(manifest))}
 const archive=join(f.home,'current.tgz');await exec('/usr/bin/tar',['-czf',archive,'-C',join(f.home,'build'),'package']);const bytes=await readFile(archive);
 const dependencyNames=(await readdir(join(repo,'node_modules'))).filter(name=>!name.startsWith('.')&&name!=='@moxuli');
 for(const modules of [join(f.home,'global','node_modules'),join(oldPrefix,'node_modules')])for(const name of dependencyNames)await symlink(join(repo,'node_modules',name),join(modules,name),'dir');

 const registry=createServer((request,response)=>{
  registryRequests.push(request.url!);
  if(outcome==='unavailable'){response.writeHead(404);response.end('{"error":"synthetic unavailable version"}');return}
  if(request.url==='/current.tgz'){response.writeHead(200,{'content-type':'application/octet-stream'});response.end(bytes);return}
  if(decodeURIComponent(request.url!.split('?')[0])==='/@moxuli/moremote'){
   response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({name:manifest.name,'dist-tags':{latest:manifest.version},versions:{[manifest.version]:{...manifest,dist:{tarball:registryOrigin+'/current.tgz',shasum:createHash('sha1').update(bytes).digest('hex'),integrity:'sha512-'+createHash('sha512').update(bytes).digest('base64')}}}}));return;
  }
  response.writeHead(404);response.end('{"error":"unexpected fixture request"}');
 });
 registry.listen(0,'127.0.0.1');await once(registry,'listening');const address=registry.address();assert.ok(address&&typeof address!=='string');const registryOrigin='http://127.0.0.1:'+address.port;
 t.after(async()=>{const closed=once(registry,'close');registry.closeAllConnections();registry.close();await closed});
 const npmCandidates=[process.env.npm_execpath,join(dirname(process.execPath),'node_modules','npm','bin','npm-cli.js'),join(dirname(process.execPath),'..','lib','node_modules','npm','bin','npm-cli.js')].filter((path):path is string=>!!path&&path.endsWith('npm-cli.js'));
 let actualNpm:string|undefined;for(const candidate of npmCandidates)try{await access(candidate);actualNpm=candidate;break}catch{}
 assert.ok(actualNpm,'The consumer needs the existing npm CLI; it never installs a tool.');
 const wrapper=join(tools,'npm-cli.js');
 await writeFile(wrapper,`const {spawnSync}=require('node:child_process');const fs=require('node:fs'),path=require('node:path');const args=process.argv.slice(2).map(arg=>arg.startsWith('--registry=')?'--registry='+process.env.SETUP_REGISTRY:arg.startsWith('--@moxuli:registry=')?'--@moxuli:registry='+process.env.SETUP_REGISTRY:arg);args.push('--cache',process.env.SETUP_CACHE);const result=spawnSync(process.execPath,[${JSON.stringify(actualNpm)},...args],{stdio:'inherit',env:{...process.env,npm_config_registry:process.env.SETUP_REGISTRY}});if(result.status!==0)process.exit(result.status||1);const modules=path.join(args[args.indexOf('--prefix')+1],'node_modules');for(const name of ${JSON.stringify(dependencyNames)}){const target=path.join(modules,name);if(!fs.existsSync(target))fs.symlinkSync(path.join(${JSON.stringify(join(repo,'node_modules'))},name),target,'dir')}`,{mode:0o600});
 const log=join(f.home,'manager.jsonl'),manager=`#!${process.execPath}\nconst fs=require('node:fs'),args=process.argv.slice(2);fs.appendFileSync(process.env.SETUP_LOG,JSON.stringify(args)+'\\n');if(args[0]==='print'){console.error('Could not find service');process.exit(113)}if(args.includes('show'))console.log('LoadState=not-found\\nFragmentPath=');\n`;
 for(const name of ['launchctl','systemctl'])await writeFile(join(tools,name),manager,{mode:0o700});
 const frontend=join(globalRoot,'bin','moremote-cli.js');
 const childEnvironment={...process.env,HOME:f.home,USERPROFILE:f.home,XDG_CONFIG_HOME:join(f.home,'config'),PASEO_PASSWORD:'',PATH:tools,npm_execpath:wrapper,SETUP_REGISTRY:registryOrigin,SETUP_CACHE:join(f.home,'cache'),SETUP_LOG:log,HTTP_PROXY:'',HTTPS_PROXY:'',ALL_PROXY:'',NO_PROXY:'*'};
 const child=spawn(process.execPath,[frontend,'--data-dir',f.state,'setup','--yes'],{env:childEnvironment,detached:true,stdio:['ignore','pipe','pipe']});
 t.after(()=>{if(child.exitCode===null&&child.signalCode===null&&child.pid)try{process.kill(-child.pid,'SIGKILL')}catch(error){if(!(error instanceof Error&&'code' in error&&error.code==='ESRCH'))throw error}});
 let output='',error='';child.stdout.on('data',chunk=>{output+=chunk});child.stderr.on('data',chunk=>{error+=chunk});const [code]=await once(child,'exit');
 assert.ok(registryRequests.some(path=>decodeURIComponent(path.split('?')[0])==='/@moxuli/moremote'),'real npm must request the exact candidate from the isolated registry');
 if(outcome==='available'){
  assert.equal(code,0,error);assert.match(output,/automatic enrollment.*enabled/);const selected=readUpdateState(f.state)!;
  assert.equal(selected.active,'0.1.3');assert.equal(selected.bootstrap,'0.1.3');assert.equal(selected.previous,'0.1.2');assert.equal(selected.enabled,false);
  const saved=await loadConfig(f.state);assert.deepEqual(saved.pairs,[active,revoked]);assert.equal(saved.apiOrigin,origin);assert.equal(saved.target,config.target);assert.equal(saved.cloudEnabled,true);assert.deepEqual(saved.localEnrollment,{home:f.home});
  const entry=join(versions,'0.1.3','node_modules','@moxuli','moremote','bin','moremote-service.js'),definition=serviceDefinition(process.platform,f.home,process.execPath,entry,f.state);
  const servicePath=process.platform==='linux'?join(childEnvironment.XDG_CONFIG_HOME,'systemd','user','moremote-cli.service'):definition.path;
  assert.equal(await readFile(servicePath,'utf8'),definition.content);
  const downloads=registryRequests.length,retained=await exec(process.execPath,[join(oldRoot,'bin','moremote-cli.js'),'setup','--yes','--data-dir',f.state],{env:childEnvironment,timeout:15000});
  assert.match(retained.stdout,/automatic enrollment.*enabled/);assert.equal(registryRequests.length,downloads);assert.equal(readUpdateState(f.state)?.active,'0.1.3');assert.equal(readUpdateState(f.state)?.enabled,false);
 }else{
  assert.notEqual(code,0);assert.match(error,outcome==='unavailable'?/SETUP_CURRENT_PACKAGE_UNAVAILABLE/:/SETUP_CAPABILITY_REQUIRED/);assert.doesNotMatch(output,/enabled/);
  assert.equal(readUpdateState(f.state)?.active,'0.1.2');assert.deepEqual(await readFile(join(f.state,'config.json')),originalConfig);
 }
 assert.deepEqual(await readFile(join(managed,'auto-disabled')),policy);assert.equal(f.cloudRequests.length,0);assert.doesNotMatch(output,/rootKey|enrollmentToken|hostToken/);await f.verifyOfficial();
});
