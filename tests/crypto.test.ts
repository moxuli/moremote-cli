import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sealEnvelope, openEnvelope, openHistoricalSnapshot, deriveKey, presenceTopic } from '../src/crypto.ts';
const pairId='11111111-1111-4111-8111-111111111111';
const id='22222222-2222-4222-8222-222222222222';
const root=Buffer.alloc(32,7);
const meta={version:1 as const,pairId,id,channel:'command' as const,issuedAt:1000,expiresAt:301000};
test('public known-answer vector and round trip',async()=>{
 const v=JSON.parse(await readFile(new URL('../vectors/envelope-v1.json',import.meta.url),'utf8'));
 const key=Buffer.from(v.rootKeyHex,'hex'); const {nonce,ciphertext,...metadata}=v.envelope;
 assert.equal(Buffer.from(await deriveKey(key,v.envelope.pairId,v.envelope.channel)).toString('hex'),v.derivedKeyHex);
 const sealed=await sealEnvelope(key,metadata,v.payload,Buffer.from(nonce,'base64url'));
 assert.deepEqual(sealed,v.envelope); assert.deepEqual(await openEnvelope(key,sealed,metadata.issuedAt),v.payload);
});
test('metadata, wrong keys, channel separation, expiry and canonical encodings fail closed',async()=>{
 const e=await sealEnvelope(root,meta,{type:'send',agentId:'agent',text:'保留 Unicode',messageId:id});
 await assert.rejects(openEnvelope(Buffer.alloc(32,8),e,1000));
 await assert.rejects(openEnvelope(root,{...e,id:pairId},1000));
 await assert.rejects(openEnvelope(root,{...e,channel:'receipt'},1000));
 await assert.rejects(openEnvelope(root,e,301000));
 await assert.rejects(openEnvelope(root,{...e,nonce:e.nonce+'='},1000));
 await assert.rejects(openEnvelope(root,{...e,extra:true},1000));
 await assert.rejects(openEnvelope(root,{...e,issuedAt:121001,expiresAt:122000},1000));
 assert.notEqual(await presenceTopic(root,pairId,'a'),await presenceTopic(root,pairId,'b'));
});
test('historical snapshot decode preserves display provenance but never command authority',async()=>{
 const state=await sealEnvelope(root,{...meta,channel:'state'},{measuredAt:1000});
 assert.deepEqual(await openHistoricalSnapshot(root,state,400000),{measuredAt:1000});
 await assert.rejects(openEnvelope(root,state,400000));
 const command=await sealEnvelope(root,meta,{type:'send'});
 await assert.rejects(openHistoricalSnapshot(root,command,400000));
});
