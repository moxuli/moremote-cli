import { parseArgs } from 'node:util';
import { resolve,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rm } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import QRCode from 'qrcode';
import { dataDirectory,loadConfig,saveConfig,validateOrigin,privateDirectory,assertOwnedDirectory,pruneRetiredPairs } from './config.js';
import { OfficialClient } from './official-client.js';
import { CloudClient } from './cloud-client.js';
import { makeOffer,tokenHash,activatePending } from './pairing.js';
import { runRuntime } from './runtime.js';
import { requestControl,runtimeHasLiveOwner } from './control.js';
import { currentDefinition,installService,removeService,stopService,serviceStatus,type ServiceDefinition } from './service.js';
import {ensureManaged,packageManaged,packageVersion,queueUpdate,setAutoUpdate,readUpdateState,serviceEntry} from './updater.js';
import {runSupervisor,stopManagedRuntime} from './supervisor.js';
import {OperationJournal} from './journal.js';
const VERSION=await packageVersion();
import {setupEnrollment} from './setup.js';
import {setupServiceEntry} from './setup-upgrade.js';
import {DEFAULT_API_ORIGIN} from './local-enrollment.js';
const HELP=`MoRemote CLI ${VERSION} — optional Paseo 0.15.3 enhancement
Usage: moremote-cli <command> [options]
  setup --yes             Enable automatic enrollment and own background service
  configure --target <official-target> --api-origin <https-origin> [--cloud-on]
            [--paseo-home <directory>] [--allow-loopback-http]
  check [--connect]       Redacted local checks; --connect is read-only
  pair [--json]           Expert-only private one-phone offer and activation
  run                     Foreground observer and scoped command consumer
  status                  Redacted runtime/config/owned-service/update state
  service-install --yes   Explicit per-user managed CLI login registration
  auto-update --enable | --disable  Persistent managed-update policy
  unpair --pair-id <id>    Disable exact phone locally and relay-revoke it
  cloud-disable           Stop cloud/local execution; attempt relay revocation
  stop                    Stop only CLI runtime and owned service
  update --version X.Y.Z --yes   Queue exact verified scoped npm version
  uninstall [--purge] --yes      Remove own registration/install; purge deletes own keys/journal
  --data-dir <directory>   Override CLI-only state
  --help | --version
No command starts/stops/updates Paseo. Foreground run needs no installed service.
`;
const versionOnly=process.argv.length===3&&process.argv[2]==='--version';
const supportedNode=Number(process.versions.node.split('.')[0])===24&&Number(process.versions.node.split('.')[1])>=13;
const parsed=(()=>{try{return parseArgs({args:versionOnly?[]:process.argv.slice(2),allowPositionals:true,options:{help:{type:'boolean'},version:{type:'string'},'data-dir':{type:'string'},target:{type:'string'},'paseo-home':{type:'string'},'api-origin':{type:'string'},'cloud-on':{type:'boolean'},'allow-loopback-http':{type:'boolean'},connect:{type:'boolean'},json:{type:'boolean'},yes:{type:'boolean'},purge:{type:'boolean'},enable:{type:'boolean'},disable:{type:'boolean'},'pair-id':{type:'string'}}})}catch{console.error('INVALID_ARGUMENTS');process.exit(1)}})();
const args=parsed.values;const action=parsed.positionals[0];
async function stopped(dir:string){if(await requestControl(dir,'status'))throw Error('STOP_CLI_BEFORE_CONFIGURATION')}
async function stopOwned(dir:string,definition:ServiceDefinition){await stopService(definition);await stopManagedRuntime(dir)}
async function main(){
 if(args.help||!action){console.log(HELP);return}if(action==='version'){console.log(VERSION);return}
 if(action!=='check'&&!supportedNode)throw Error('NODE_24_13_REQUIRED');
 const dir=resolve(args['data-dir']||dataDirectory());const config=await loadConfig(dir);const definition=currentDefinition(fileURLToPath(new URL('../bin/moremote-cli.js',import.meta.url)),dir);
 const selected=readUpdateState(dir);
 if(action==='check'){const checks:{name:string;ok:boolean;code?:string}[]=[{name:'node24.13+',ok:supportedNode},{name:'configuration',ok:!!config.target||!!config.paseoHome},{name:'cloud-opt-in',ok:!config.cloudEnabled||!!config.apiOrigin}];if(args.connect){let official:OfficialClient|undefined;try{official=new OfficialClient(config);await official.connect();checks.push({name:'official-read-only-connection',ok:true});checks.push({name:'explicit-event-subscriptions',ok:official.info()?.features?.explicitEventSubscriptions===true})}catch{checks.push({name:'official-read-only-connection',ok:false,code:'OFFICIAL_CONNECTION_FAILED'})}finally{await official?.close()}}console.log(JSON.stringify({ok:checks.every(c=>c.ok),checks},null,2));if(checks.some(c=>!c.ok))process.exitCode=1;return}
 if(action==='status'){const installed=selected?false:await packageManaged();console.log(JSON.stringify({version:VERSION,configured:!!config.target,cloudEnabled:config.cloudEnabled,apiOrigin:config.apiOrigin||null,pairings:config.pairs.map(p=>({pairId:p.pairId,apiOrigin:p.apiOrigin||config.apiOrigin||null,active:p.active,revokedAt:p.revokedAt||null,expiresAt:p.expiresAt||null})),runtime:await requestControl(dir,'status'),service:await serviceStatus(definition),updates:selected??{enabled:installed,reason:installed?'MANAGED_BOOTSTRAP_REQUIRED':'SOURCE_CHECKOUT_MANUAL'}},null,2));return}
 if(action==='run'){if(runtimeHasLiveOwner(dir))throw Error('CLI_ALREADY_RUNNING');if(process.env.MOREMOTE_MANAGED_CHILD){try{await runRuntime(dir,VERSION)}finally{if(process.connected)process.disconnect()}return}if(selected||await packageManaged()){await ensureManaged(dir);try{process.exitCode=await runSupervisor(dir)}finally{if(process.connected)process.disconnect()}}else await runRuntime(dir,VERSION);return}
 if(action==='stop'){await stopOwned(dir,definition);console.log('MoRemote CLI stopped; official Paseo unchanged.');return}
 if(action==='setup'){
  let preparedEntry:string|undefined;
  await setupEnrollment(dir,{yes:!!args.yes,stopOwned:()=>stopOwned(dir,definition),authenticate:async current=>{
   const official=new OfficialClient(current);try{await official.connect();return {serverId:official.info()!.serverId}}finally{await official.close()}
  },prepare:async()=>{
   preparedEntry=await setupServiceEntry(dir,fileURLToPath(new URL('../bin/moremote-cli.js',import.meta.url)));
  },install:async()=>{
   if(!preparedEntry)throw Error('SETUP_CAPABILITY_REQUIRED');
   await installService(currentDefinition(preparedEntry,dir));
  }});
  console.log('MoRemote CLI automatic enrollment and owned per-user service enabled. Official Paseo unchanged.');return;
 }
 if(action==='configure'){await stopped(dir);pruneRetiredPairs(config);if(config.pairs.some(p=>p.revokedAt===undefined)&&((args.target&&args.target!==config.target)||(args['api-origin']&&args['api-origin']!==config.apiOrigin)||(args['paseo-home']&&resolve(args['paseo-home'])!==config.paseoHome)))throw Error('DISABLE_OR_UNPAIR_BEFORE_RETARGETING');for(const pair of config.pairs)if(!pair.apiOrigin&&config.apiOrigin)pair.apiOrigin=config.apiOrigin;if(args.target&&args.target!==config.target){config.target=args.target;delete config.daemonServerId}if(args['paseo-home']&&resolve(args['paseo-home'])!==config.paseoHome){config.paseoHome=resolve(args['paseo-home']);delete config.daemonServerId}if(args['allow-loopback-http'])config.allowLoopbackHttp=true;if(args['api-origin'])config.apiOrigin=validateOrigin(args['api-origin'],config.allowLoopbackHttp);if(args['cloud-on']){if(!config.apiOrigin)throw Error('API_ORIGIN_REQUIRED');config.cloudEnabled=true}await saveConfig(dir,config);console.log('Configuration saved. Foreground: moremote-cli run. No service installed.');return}
 if(action==='pair'){await stopped(dir);if(config.pairs.length>=16)throw Error('PAIRING_LIMIT');const origin=validateOrigin(config.apiOrigin??DEFAULT_API_ORIGIN,config.allowLoopbackHttp);const official=new OfficialClient(config);try{await official.connect();const info=official.info()!;config.apiOrigin=origin;config.cloudEnabled=true;config.daemonServerId=info.serverId;const {pair,offer}=makeOffer(origin);pair.daemonServerId=info.serverId;config.pairs.push(pair);await saveConfig(dir,config);const cloud=new CloudClient(origin,pair.pairId,pair.hostToken,config.allowLoopbackHttp);await cloud.create({pairId:pair.pairId,hostTokenHash:tokenHash(pair.hostToken),enrollmentTokenHash:tokenHash(pair.enrollmentToken!),expiresAt:pair.expiresAt});
 const offerJSON=JSON.stringify(offer);if(args.json)console.log(offerJSON);else{const link='moremote://enhance#'+Buffer.from(offerJSON).toString('base64url');console.log('Secret one-phone offer; scan privately. Expires in ten minutes.');console.log(await QRCode.toString(link,{type:'terminal',small:true}));console.log(link);}
 while(Date.now()<pair.expiresAt!){if(await activatePending(config,dir,pair,cloud,info.serverId,info.hostname??undefined)){console.error('Pairing activated. Run the CLI to deliver encrypted state/actions.');return}await sleep(3000)}throw Error('PAIRING_EXPIRED');}finally{await official.close()} }
 if(action==='cloud-disable'){await stopOwned(dir,definition);Object.assign(config,await loadConfig(dir));config.cloudEnabled=false;await saveConfig(dir,config);const journal=new OperationJournal(join(dir,'journal.sqlite'));const failures:string[]=[];try{for(const pair of config.pairs){journal.revokePair(pair.pairId);pair.active=false;pair.revokedAt??=Date.now()}await saveConfig(dir,config);for(const pair of config.pairs){try{const origin=pair.apiOrigin||config.apiOrigin;if(!origin)throw Error('MISSING_ORIGIN');await new CloudClient(origin,pair.pairId,pair.hostToken,config.allowLoopbackHttp).revoke()}catch{failures.push(pair.pairId)}}}finally{journal.close()}console.log(JSON.stringify({cloudEnabled:false,endpointExecution:'disabled-locally',relayRevocationPending:failures,officialData:'unchanged'}));if(failures.length)process.exitCode=1;return}
 if(action==='unpair'){await stopped(dir);const pair=config.pairs.find(p=>p.pairId===args['pair-id']);const origin=pair?.apiOrigin||config.apiOrigin;if(!pair||!origin)throw Error('EXACT_PAIR_REQUIRED');const journal=new OperationJournal(join(dir,'journal.sqlite'));try{journal.revokePair(pair.pairId)}finally{journal.close()}pair.active=false;pair.revokedAt??=Date.now();await saveConfig(dir,config);await new CloudClient(origin,pair.pairId,pair.hostToken,config.allowLoopbackHttp).revoke();console.log('Exact phone pairing disabled locally and relay-revoked; other pairings and official data unchanged. Protected keys retained for final control receipts.');return}
 if(action==='service-install'){if(!args.yes)throw Error('EXPLICIT_YES_REQUIRED');await stopped(dir);await saveConfig(dir,config);await installService(currentDefinition(await serviceEntry(dir),dir));console.log('MoRemote CLI per-user managed login registration installed; automatic updates enabled unless opted out. Official service unchanged.');return}
 if(action==='auto-update'){if(!!args.enable===!!args.disable)throw Error('SELECT_ENABLE_OR_DISABLE');console.log(JSON.stringify(await setAutoUpdate(dir,!!args.enable)));return}
 if(action==='update'){if(!args.yes||!args.version)throw Error('EXACT_VERSION_AND_YES_REQUIRED');const state=await queueUpdate(dir,args.version);console.log(JSON.stringify({installedVersion:args.version,activeVersion:state.active,activation:state.pending?'queued-for-supervisor-safe-boundary':'already-active',next:state.pending?'A running managed supervisor activates automatically; otherwise start run or service-install --yes.':null}));return}
 if(action==='uninstall'){if(!args.yes)throw Error('EXPLICIT_YES_REQUIRED');try{await assertOwnedDirectory(dir)}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}await removeService(definition);await stopManagedRuntime(dir);if(!args.purge)await saveConfig(dir,config);await rm(join(dir,'managed'),{recursive:true,force:true});if(args.purge)await rm(dir,{recursive:true,force:true});console.log(args.purge?'MoRemote CLI-owned registration, managed install and local keys/journal removed. Official data unchanged.':'MoRemote CLI registration and managed install removed; local pairing keys/journal retained. Source checkout/global package removal remains with its package manager.');return}
 throw Error('UNKNOWN_COMMAND');
}
if(process.argv.includes('--version')&&!action){console.log(VERSION)}else main().catch(error=>{const code=error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'CLI_COMMAND_FAILED';console.error(code);process.exitCode=1});
