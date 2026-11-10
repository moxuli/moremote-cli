import test from 'node:test';
import assert from 'node:assert/strict';
import {createConnection} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {privateDirectory} from '../src/config.ts';
import {controlEndpoint,ownRuntime,requestControl} from '../src/control.ts';
import {readRuntimeOwner} from '../src/resources.ts';

async function fixture(){
 const dir=await mkdtemp(join(process.platform==='win32'?tmpdir():'/tmp','mcf-'));await privateDirectory(dir);let reads=0,stops=0;
 const release=await ownRuntime(dir,()=>({version:'fixture',reads:++reads}),()=>{stops++});
 const token=readRuntimeOwner(join(dir,'runtime.lock')).value.token;
 return {dir,token,reads:()=>reads,stops:()=>stops,close:async()=>{await release();await rm(dir,{recursive:true,force:true})}};
}
async function exchange(dir:string,chunks:readonly string[]){
 // Exercise the real Unix socket / Windows named pipe without calling end():
 // the newline frame, not a transport half-close, must trigger the response.
 const socket=createConnection(controlEndpoint(dir));socket.setEncoding('utf8');let raw='';
 const result=Promise.withResolvers<Record<string,unknown>>();const timer=setTimeout(()=>result.reject(Error('FRAMED_REPLY_TIMEOUT')),2000);
 socket.on('error',result.reject);socket.on('end',()=>result.reject(Error('FRAMED_PEER_CLOSED')));
 socket.on('data',chunk=>{raw+=chunk;const end=raw.indexOf('\n');if(end<0)return;try{result.resolve(JSON.parse(raw.slice(0,end)))}catch(error){result.reject(error)}});
 const send=(index:number)=>{if(index===chunks.length)return;socket.write(chunks[index],error=>{if(error)result.reject(error);else setImmediate(()=>send(index+1))})};socket.once('connect',()=>send(0));
 try{return await result.promise}finally{clearTimeout(timer);socket.destroy()}
}

for(const action of ['status','stop'] as const)test(`authenticated ${action} frames execute and reply while the requesting peer remains writable`,{timeout:5000},async()=>{
 const f=await fixture();try{
  const frame=JSON.stringify({token:f.token,action})+'\n';const response=await exchange(f.dir,[frame.slice(0,7),frame.slice(7,-1),'\n']);
  assert.deepEqual(response,action==='status'?{ok:true,version:'fixture',reads:1}:{ok:true,stopping:true});assert.equal(f.stops(),action==='stop'?1:0);assert.equal(f.reads(),action==='status'?1:0);
 }finally{await f.close()}
});

test('framed wrong-token and malformed requests cannot invoke stop or corrupt owned control resources',{timeout:5000},async()=>{
 const f=await fixture();try{
  const wrong=(f.token[0]==='A'?'B':'A')+f.token.slice(1);
  assert.deepEqual(await exchange(f.dir,[JSON.stringify({token:wrong,action:'stop'})+'\n']),{ok:false});
  assert.deepEqual(await exchange(f.dir,['{invalid-json}\n']),{ok:false});assert.equal(f.stops(),0);assert.equal(f.reads(),0);
  assert.deepEqual(await requestControl(f.dir,'status'),{ok:true,version:'fixture',reads:1});
 }finally{await f.close()}
});

test('oversized authenticated request is rejected before dispatch, and a following connection still works',{timeout:5000},async()=>{
 const f=await fixture();try{
  await assert.rejects(exchange(f.dir,[JSON.stringify({token:f.token,action:'stop',padding:'x'.repeat(4096)})+'\n']));
  assert.equal(f.stops(),0);assert.equal(f.reads(),0);assert.deepEqual(await requestControl(f.dir,'status'),{ok:true,version:'fixture',reads:1});
 }finally{await f.close()}
});
