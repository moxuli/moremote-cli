import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer, type Socket} from 'node:net';
import {randomBytes, randomUUID} from 'node:crypto';
import {mkdtemp, chmod, lstat, rm, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {privateDirectory, privateManagedDirectory} from '../src/config.ts';
import {controlEndpoint} from '../src/control.ts';
import {publishControlTransport} from '../src/control-transport.ts';
import {RUNTIME_OWNER, createPrivateFile, removeOwnedResource, type RuntimeOwner} from '../src/resources.ts';
import {initialUpdateState, writeUpdateState, updateLock} from '../src/update-state.ts';
import {stopManagedRuntime} from '../src/supervisor.ts';

// Exercise a genuine owned socket/record and supervisor lock retirement window;
// neither transport closure nor the stop marker alone is proof of shutdown.
async function drainingPeer(managed: boolean, response = '', replaceOnStatus = false) {
 const dir = await mkdtemp(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'mstop-'));
 await privateDirectory(dir);
 let owner: RuntimeOwner = {owner:RUNTIME_OWNER, version:1, instanceId:randomUUID(),
  pid:process.pid, startedAt:Date.now(), token:randomBytes(32).toString('base64url')};
 const dropped = Promise.withResolvers<void>(), retired = Promise.withResolvers<void>();
 const sockets = new Set<Socket>();
 let requests = 0;
 const server = createServer(socket => {
  sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => { sockets.delete(socket); dropped.resolve(); });
  socket.once('data', bytes => {
   const request = JSON.parse(bytes.toString());
   assert.equal(request.token, owner.token); requests++;
   if(replaceOnStatus && request.action === 'status') {
    assert.equal(removeOwnedResource(join(dir, 'runtime.json'), record), true);
    assert.equal(removeOwnedResource(join(dir, 'runtime.lock'), lock), true);
    owner = {...owner, instanceId:randomUUID(), token:randomBytes(32).toString('base64url')};
    lock = createPrivateFile(join(dir, 'runtime.lock'), JSON.stringify(owner));
    record = createPrivateFile(join(dir, 'runtime.json'), JSON.stringify({...owner, socket:socketIdentity}));
   } else assert.equal(request.action, 'stop');
   socket.end(response);
  });
 });
 const listening = Promise.withResolvers<void>();
 server.once('error', listening.reject); server.listen(controlEndpoint(dir), listening.resolve); await listening.promise;
 let socketIdentity = null;
 if(process.platform !== 'win32') {
  await chmod(controlEndpoint(dir), 0o600); const value = await lstat(controlEndpoint(dir));
  socketIdentity = {dev:value.dev, ino:value.ino};
 }
 await publishControlTransport(dir, owner);
 let lock = createPrivateFile(join(dir, 'runtime.lock'), JSON.stringify(owner));
 let record = createPrivateFile(join(dir, 'runtime.json'), JSON.stringify({...owner, socket:socketIdentity}));
 let supervisor: Promise<void> | undefined;
 if(managed) {
  await privateManagedDirectory(join(dir, 'managed'));
  writeUpdateState(dir, initialUpdateState('0.1.1'));
  const acquired = Promise.withResolvers<void>();
  supervisor = updateLock(dir, async () => { acquired.resolve(); await retired.promise; }, 'supervisor');
  await acquired.promise;
 }
 let released = false;
 async function retireSupervisor() { retired.resolve(); await supervisor; }
 async function retire() {
  if(released) return;
  released = true;
  for(const socket of sockets) socket.destroy();
  const closed = Promise.withResolvers<void>(); server.close(() => closed.resolve()); await closed.promise;
  assert.equal(removeOwnedResource(join(dir, 'runtime.json'), record), true);
  assert.equal(removeOwnedResource(join(dir, 'runtime.lock'), lock), true);
  await retireSupervisor();
 }
 async function close() {
  await retire();
  await rm(dir, {recursive:true, force:true});
 }
 return {dir, dropped:dropped.promise, requests:() => requests, retire, retireSupervisor, close};
}

test('managed shutdown waits for supervisor and exact runtime retirement after a concurrent control close', {timeout:5000}, async () => {
 const f = await drainingPeer(true);
 let settled = false;
 const stopping = stopManagedRuntime(f.dir).finally(() => { settled = true; });
 void stopping.catch(() => {});
 try {
  await f.dropped;
  assert.equal(settled, false, 'A closed connection is not yet successful shutdown.');
  await f.retire(); await stopping;
  assert.equal(f.requests(), 1, 'Never replay an uncertain stop against a replacement generation.');
 } finally { await f.close(); }
});

test('managed shutdown rejects a live replacement that takes over during the final status probe', {timeout:5000}, async () => {
 const f = await drainingPeer(true, '', true);
 const original = JSON.parse(await readFile(join(f.dir, 'runtime.json'), 'utf8'));
 const stopping = stopManagedRuntime(f.dir);
 void stopping.catch(() => {});
 try {
  await f.dropped;
  await f.retireSupervisor();
  await assert.rejects(stopping, {message:'STOP_TIMEOUT'});
  const replacement = JSON.parse(await readFile(join(f.dir, 'runtime.json'), 'utf8'));
  assert.notEqual(replacement.instanceId, original.instanceId);
  assert.equal(replacement.pid, process.pid);
  assert.equal(f.requests(), 2, 'Only the original stop and final status are allowed.');
 } finally { await f.close(); }
});

for(const [managed, response, error] of [[false, '', 'CONTROL_CONNECTION_CLOSED'],
 [true, '{"ok":', 'CONTROL_INVALID_RESPONSE']] as const) {
 test(`shutdown preserves ${error} without authoritative managed retirement`, {timeout:5000}, async () => {
  const f = await drainingPeer(managed, response);
  try { await assert.rejects(stopManagedRuntime(f.dir), {message:error}); assert.equal(f.requests(), 1); }
  finally { await f.close(); }
 });
}
