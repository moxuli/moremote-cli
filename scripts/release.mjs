import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const [mode,providedTag]=process.argv.slice(2);
const pkg=JSON.parse(readFileSync('package.json','utf8'));
const tag=providedTag||process.env.RELEASE_TAG||(process.env.GITHUB_REF_TYPE==='tag'?process.env.GITHUB_REF_NAME:'v'+pkg.version);
function identity(value){
 assert.equal(value.name,'@moxuli/moremote');assert.equal(value.version,pkg.version);assert.equal(value.private,undefined);
 assert.equal(value.repository.url,'git+https://github.com/moxuli/moremote-cli.git');
 assert.deepEqual(value.bin,{'moremote-cli':'bin/moremote-cli.js'});assert.equal(value.engines.node,'>=24.13.0 <25');
 assert.equal(value.publishConfig.registry,'https://registry.npmjs.org');assert.equal(value.publishConfig.access,'public');
 assert.deepEqual(value.moremote,{updateProtocol:1,journalSchema:1,wireProtocol:1},'Automatic release requires rollback-compatible storage/wire protocol');
}
assert.match(tag??'',/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/,'Only stable exact vX.Y.Z tags are released');
assert.equal(tag,'v'+pkg.version);identity(pkg);
const lock=JSON.parse(readFileSync('package-lock.json','utf8'));assert.equal(lock.name,pkg.name);assert.equal(lock.version,pkg.version);assert.equal(lock.packages[''].name,pkg.name);assert.equal(lock.packages[''].version,pkg.version);
if(process.env.GITHUB_REPOSITORY)assert.equal(process.env.GITHUB_REPOSITORY,'moxuli/moremote-cli');
const npm=process.env.npm_execpath;
function pack(destination){
 const args=['pack','--ignore-scripts','--json','--pack-destination',destination];
 const result=npm?execFileSync(process.execPath,[npm,...args],{encoding:'utf8'}):execFileSync(process.platform==='win32'?'npm.cmd':'npm',args,{encoding:'utf8',shell:process.platform==='win32'});
 return JSON.parse(result)[0];
}
if(mode==='pack'){
 const temp=mkdtempSync(join(tmpdir(),'moremote-release-'));
 try{
  const first=pack(temp),bytes=readFileSync(join(temp,first.filename)),second=pack(temp);
  assert.deepEqual(bytes,readFileSync(join(temp,second.filename)),'npm tarball must be byte-deterministic');
  const archived=JSON.parse(execFileSync('tar',['-xOf',join(temp,first.filename),'package/package.json'],{encoding:'utf8'}));identity(archived);
  const files=new Set(first.files.map(file=>file.path));
  for(const file of ['bin/moremote-cli.js','bin/moremote-service.js','dist/cli.js','dist/runtime.js','dist/supervisor.js','dist/updater.js','dist/update-state.js','LICENSE','NOTICE'])assert(files.has(file),'Missing '+file);
  for(const file of files)assert(!/(^|\/)(node_modules|\.git|\.env)(\/|$)/.test(file),'Private/unwanted path '+file);
  const output='moxuli-moremote-'+pkg.version+'.tgz';writeFileSync(output,bytes);writeFileSync('SHA256SUMS',createHash('sha256').update(bytes).digest('hex')+'  '+output+'\n');
  console.log(output);
 }finally{rmSync(temp,{recursive:true,force:true})}
}else if(mode!=='validate')throw Error('Expected validate or pack');
