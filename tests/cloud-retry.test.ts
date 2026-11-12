import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {CloudClient,CloudError} from '../src/cloud-client.ts';

const pairId='11111111-1111-4111-8111-111111111111',now=Date.UTC(2026,10,10,12),day=86400000;
async function fixture(status:number,header:string|null){let calls=0;const server=createServer((req,res)=>{calls++;req.resume();res.setHeader('Content-Type','application/json');if(header!==null)res.setHeader('Retry-After',header);res.writeHead(status);res.end(JSON.stringify({ok:false,error:{code:'cost_guard_closed',message:'Synthetic guard'}}))});server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');const client=new CloudClient('http://127.0.0.1:'+address.port,pairId,'synthetic',true);return {client,calls:()=>calls,close:async()=>{const closed=Promise.withResolvers<void>();server.closeAllConnections();server.close(()=>closed.resolve());await closed.promise}}}
async function rejection(client:CloudClient){try{await client.commands();assert.fail('expected relay rejection')}catch(error){assert.ok(error instanceof CloudError);return error}}

for(const status of [429,503])test(`HTTP ${status} Retry-After seconds become a fixed bounded deadline, never a renewed lease`,async()=>{
 const f=await fixture(status,'60');const original=Date.now;let clock=now;Date.now=()=>clock;
 try{const first=await rejection(f.client);assert.ok('retryAt' in first);assert.equal(first.retryAt,now+60000);clock+=10000;const second=await rejection(f.client);assert.ok('retryAt' in second);assert.equal(second.retryAt,now+60000);assert.equal(f.calls(),1,'a blocked client must not issue another HTTP request');clock=now+60000;await rejection(f.client);assert.equal(f.calls(),2,'the original deadline permits a fresh read, without replaying any mutation')}
 finally{Date.now=original;await f.close()}
});

const cases:[string|null,number,number|undefined][]=[
 ['120',429,now+120000],['0',503,now],
 [new Date(now+7200000).toUTCString(),503,now+7200000],
 ['999999999999999999999999999999999999999999999999',429,now+day],
 [new Date(now+2*day).toUTCString(),503,now+day],
 [new Date(now-1000).toUTCString(),429,undefined],
 ['9'.repeat(400),429,undefined],
 ['-1',429,undefined],['1.5',429,undefined],['Infinity',503,undefined],['NaN',429,undefined],['',503,undefined],['tomorrow',429,undefined],['2027-01-01',503,undefined],['Tue, 30 Feb 2027 12:00:00 GMT',429,undefined],[null,503,undefined],['120',409,undefined],['120',500,undefined]
];
for(const [header,status,expected] of cases)test(`Retry-After validates status and HTTP delay/date framing: ${status} ${JSON.stringify(header)}`,async()=>{
 const f=await fixture(status,header);const original=Date.now;Date.now=()=>now;
 try{const error=await rejection(f.client);const actual='retryAt' in error?error.retryAt:undefined;assert.equal(actual,expected)}finally{Date.now=original;await f.close()}
});

test('Retry-After never causes an automatic retry of a mutation whose dispatch response is uncertain',async()=>{
 const f=await fixture(503,'60');const original=Date.now;Date.now=()=>now;
 try{await assert.rejects(f.client.dispatch('22222222-2222-4222-8222-222222222222'));await assert.rejects(f.client.commands());assert.equal(f.calls(),1)}finally{Date.now=original;await f.close()}
});

test('origin cycle fences survive deadline expiry across clients, without blocking another relay origin',async()=>{
 const paused=await fixture(429,'60'),other=await fixture(409,null);const original=Date.now;let clock=now;Date.now=()=>clock;const retryState={},cycleFence={};
 try{
  const first=new CloudClient(paused.client.origin,pairId,'synthetic',true,fetch,undefined,retryState,cycleFence);await rejection(first);assert.equal(paused.calls(),1);
  clock+=61000;const sameCycle=new CloudClient(paused.client.origin,pairId,'synthetic',true,fetch,undefined,retryState,cycleFence);await rejection(sameCycle);assert.equal(paused.calls(),1,'expiry cannot unlock another client in the same origin/control cycle');
  const independent=new CloudClient(other.client.origin,pairId,'synthetic',true,fetch,undefined,{},{});const error=await rejection(independent);assert.equal(error.status,409);assert.equal(other.calls(),1,'an unrelated relay origin must still make progress');
  const nextCycle=new CloudClient(paused.client.origin,pairId,'synthetic',true,fetch,undefined,retryState,{});await assert.rejects(nextCycle.controls());assert.equal(paused.calls(),2,'only the next explicit control acquisition may resume HTTP after expiry');
 }finally{Date.now=original;await paused.close();await other.close()}
});
test('explicit normal-budget rejection pauses normal work but preserves recovery admission and original global-outage fences',async()=>{
 const calls:string[]=[];const reset=Date.now()+60000;
 const fetcher:typeof fetch=async(input)=>{const path=new URL(String(input)).pathname;calls.push(path);if(path.endsWith('/state'))return Response.json({ok:false,error:{code:'daily_work_limit'}},{status:429,headers:{'retry-after':'60','x-moremote-budget':'normal','x-moremote-reset':String(reset)}});return Response.json({ok:true,controls:[]})};
 const retryState={},cycleFence={};const client=new CloudClient('http://localhost:18787',pairId,'synthetic',true,fetcher,undefined,retryState,cycleFence);
 await assert.rejects(client.request('PUT','/pairs/'+pairId+'/state',{}));
 await client.controls();await client.request('PUT','/pairs/'+pairId+'/activities/22222222-2222-4222-8222-222222222222/end',{});
 await assert.rejects(client.commands());assert.equal(calls.length,3);
});
for(const invalid of [
 {status:503,budget:'normal',reset:true,code:'daily_work_limit'},
 {status:429,budget:'normal',reset:false,code:'daily_work_limit'},
 {status:429,budget:'normal',reset:true,code:'service_disabled'},
 {status:429,budget:'recovery',reset:true,code:'daily_work_limit'},
])test(`untrusted or origin-wide rejection cannot unlock terminal recovery: ${JSON.stringify(invalid)}`,async()=>{
 let calls=0;const fetcher:typeof fetch=async()=>{calls++;return Response.json({ok:false,error:{code:invalid.code}},{status:invalid.status,headers:{'retry-after':'60','x-moremote-budget':invalid.budget,...(invalid.reset?{'x-moremote-reset':String(Date.now()+60000)}:{})}})};
 const client=new CloudClient('http://localhost:18787',pairId,'synthetic',true,fetcher,undefined,{},{});
 await assert.rejects(client.commands());await assert.rejects(client.controls());assert.equal(calls,1);
});
