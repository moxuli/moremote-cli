import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {OperationJournal} from '../src/journal.ts';
import {boundAttention,queueAttention} from '../src/runtime.ts';
import {occurrenceBinding} from '../src/bindings.ts';
import {openEnvelope} from '../src/crypto.ts';
import type {Attention} from '../src/official-client.ts';

for(const kind of ['question','permission'] as const)test('cached '+kind+' cannot steal a replacement occurrence notification clock',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'moremote-notice-cache-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const journal=new OperationJournal(join(dir,'journal.sqlite'));t.after(()=>journal.close());
 const pair={pairId:'11111111-1111-4111-8111-111111111111',rootKey:Buffer.alloc(32,7).toString('base64url'),hostToken:'synthetic',active:true};
 const official={generation:'synthetic-generation',requestContext:()=>({serverId:'synthetic-daemon',generation:'synthetic-generation'})};
 const request={id:'synthetic-request',kind:kind==='question'?'question':'tool',input:{value:'old'},actions:[{id:'allow',behavior:'allow'}]};
 const old=journal.observe('synthetic-daemon','synthetic-agent',official.generation,request,1000);
 const first={agentId:'synthetic-agent',requestId:request.id,kind,timestamp:old.createdAt,occurrence:old};
 const current=journal.observe('synthetic-daemon','synthetic-agent',official.generation,{...request,input:{value:'new'}},599000);
 const next={...first,timestamp:current.createdAt,occurrence:current};
 // Drain the actual binding/encryption/queue path after a long quota pause.
 for(const event of [first,next]){const bound=await boundAttention(journal,pair,event,official);if(bound)await queueAttention(journal,pair,bound,600000)}
 const notices=journal.attention(pair.pairId,602000);assert.equal(notices.length,1,'the replacement notice must outlive the retired occurrence');
 const envelope=notices[0].body.envelope;assert.equal(envelope.issuedAt,current.createdAt);
 const plain=await openEnvelope(Buffer.alloc(32,7),envelope,602000) as Attention;
 assert.equal(plain.timestamp,current.createdAt);assert.equal(plain.requestBinding,await occurrenceBinding(pair,current));
 assert.equal(journal.attentionRecords(pair.pairId).length,1);assert.equal(journal.isCurrent(current),true);
});
