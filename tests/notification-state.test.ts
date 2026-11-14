import test from 'node:test';
import assert from 'node:assert/strict';
import {NotificationStatePublisher} from '../src/notification-state.ts';
import {openEnvelope,type Envelope} from '../src/crypto.ts';

const pair={pairId:'11111111-1111-4111-8111-111111111111',rootKey:Buffer.alloc(32,7).toString('base64url')};
const empty={version:1,daemonServerId:'daemon',tasks:[]};
function state(binding='first'){return {...empty,tasks:[{agentId:'agent',pendingRequests:[{requestId:'question',requestBinding:binding,request:{kind:'question'}}]}]} }

test('only notification changes and pending-request expiry renewal publish state',async()=>{
 const publisher=new NotificationStatePublisher(),writes:Envelope[]=[];
 const cloud={state:async(envelope:Envelope)=>{writes.push(envelope);return {ok:true}}};
 assert.equal(await publisher.publish(pair,cloud,empty,1000),true);assert.equal(writes.length,0);
 await publisher.publish(pair,cloud,state(),1001);
 await publisher.publish(pair,cloud,state(),31001);assert.equal(writes.length,1,'a measurement clock cannot upload a whole directory');
 await publisher.publish(pair,cloud,state(),481001);assert.equal(writes.length,2,'only a still-pending request renews its hydration');
 await publisher.publish(pair,cloud,empty,481002);assert.equal(writes.length,3,'clear resolved details once');
 await publisher.publish(pair,cloud,empty,1481002);assert.equal(writes.length,3,'empty state never becomes a periodic feed');
 assert.deepEqual(await openEnvelope(Buffer.alloc(32,7),writes[2],481002),empty);
});

test('a lost acknowledgement retries immutable bytes then publishes current requests in order',async()=>{
 const publisher=new NotificationStatePublisher(),writes:Envelope[]=[];let lose=true;
 const cloud={state:async(envelope:Envelope)=>{writes.push(envelope);if(lose){lose=false;throw Error('Synthetic lost acknowledgement')}return {ok:true}}};
 await assert.rejects(publisher.publish(pair,cloud,state('old'),1000));
 await publisher.publish(pair,cloud,state('replacement'),1000);
 assert.equal(writes.length,3);assert.deepEqual(writes[0],writes[1]);
 assert.ok(writes[2].issuedAt>writes[1].issuedAt,'a same-clock replacement cannot conflict with the older accepted state');
 assert.deepEqual(await openEnvelope(Buffer.alloc(32,7),writes[2],1001),state('replacement'));
 await publisher.publish(pair,cloud,state('replacement'),5000);assert.equal(writes.length,3);
});

test('expired display hydration can yield to a new current occurrence without replaying an action',async()=>{
 const publisher=new NotificationStatePublisher(),writes:Envelope[]=[];let lose=true;
 const cloud={state:async(envelope:Envelope)=>{writes.push(envelope);if(lose)throw Error('Synthetic offline');return {ok:true}}};
 await assert.rejects(publisher.publish(pair,cloud,state('old'),1000));lose=false;
 await publisher.publish(pair,cloud,state('current'),601001);assert.equal(writes.length,2);
 assert.notEqual(writes[0].id,writes[1].id);assert.deepEqual(await openEnvelope(Buffer.alloc(32,7),writes[1],601001),state('current'));
 publisher.retain([]);await publisher.publish(pair,cloud,empty,601002);assert.equal(writes.length,2);
});
