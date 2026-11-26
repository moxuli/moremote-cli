import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { WebSocketServer } from 'ws';
import { wrapSessionMessage } from '@getpaseo/protocol/messages';
import { saveConfig, type Config } from '../src/config.ts';
import { makeOffer } from '../src/pairing.ts';
import { OperationJournal } from '../src/journal.ts';
import { sealEnvelope, decode } from '../src/crypto.ts';
import { requestControl, controlEndpoint } from '../src/control.ts';
import {
  PaseoWatchdog,
  canManageLocalPaseo,
  isPaseoPidAlive,
  resolvePaseoLauncher,
  spawnPaseoStart,
} from '../src/paseo-watchdog.ts';

function baseConfig(paseoHome: string, overrides: Partial<Config> = {}): Config {
  return {
    version: 1,
    clientId: 'moremote-cli-watchdog-test',
    paseoHome,
    allowLoopbackHttp: false,
    cloudEnabled: false,
    pairs: [],
    ...overrides,
  };
}

test('canManageLocalPaseo fails closed on missing identity, symlinks, directories, or mismatched server-id', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mrw-elig-'));
  try {
    const home = join(root, 'paseo');
    assert.equal(canManageLocalPaseo(baseConfig(home)), false, 'missing paseoHome must not be managed');

    await mkdir(home, { mode: 0o700 });
    assert.equal(canManageLocalPaseo(baseConfig(home)), false, 'empty paseoHome must not be managed');

    // config.json alone is not sufficient initialization proof
    await writeFile(join(home, 'config.json'), '{}');
    assert.equal(canManageLocalPaseo(baseConfig(home)), false, 'config.json alone must not suffice');

    await writeFile(join(home, 'daemon-keypair.json'), '{}');
    assert.equal(canManageLocalPaseo(baseConfig(home)), true);

    assert.equal(canManageLocalPaseo(baseConfig(home, { target: 'tcp://127.0.0.1:6767' })), false);
    assert.equal(canManageLocalPaseo(baseConfig(home, { target: 'https://remote.example:6767' })), false);

    // Pinned daemonServerId must fail closed if server-id is missing, symlinked, or a directory
    assert.equal(canManageLocalPaseo(baseConfig(home, { daemonServerId: 'srv_actual' })), false, 'missing server-id must fail closed when pinned');

    await writeFile(join(home, 'server-id'), 'srv_actual\n');
    assert.equal(canManageLocalPaseo(baseConfig(home, { daemonServerId: 'srv_other' })), false);
    assert.equal(canManageLocalPaseo(baseConfig(home, { daemonServerId: 'srv_actual' })), true);

    if (process.platform !== 'win32') {
      const linkHome = join(root, 'paseo-link');
      await symlink(home, linkHome);
      assert.equal(canManageLocalPaseo(baseConfig(linkHome)), false, 'symlinked paseoHome must be rejected');

      // Symlinked server-id pointing elsewhere must fail closed even when pinned
      const otherServerId = join(root, 'other-server-id');
      await writeFile(otherServerId, 'srv_other\n');
      await rm(join(home, 'server-id'));
      await symlink(otherServerId, join(home, 'server-id'));
      assert.equal(canManageLocalPaseo(baseConfig(home, { daemonServerId: 'srv_actual' })), false, 'symlinked server-id must be rejected');
      await rm(join(home, 'server-id'));

      // Directory at server-id must fail closed
      await mkdir(join(home, 'server-id'));
      assert.equal(canManageLocalPaseo(baseConfig(home, { daemonServerId: 'srv_actual' })), false, 'directory server-id must be rejected');
      await rm(join(home, 'server-id'), { recursive: true });
      await writeFile(join(home, 'server-id'), 'srv_actual\n');

      // Symlinked config.json must fail closed even when daemon-keypair.json is valid
      await rm(join(home, 'config.json'));
      await symlink(otherServerId, join(home, 'config.json'));
      assert.equal(canManageLocalPaseo(baseConfig(home, { daemonServerId: 'srv_actual' })), false, 'symlinked config.json must fail closed');
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('isPaseoPidAlive rejects dead, malformed, and pre-boot PIDs while accepting current-boot live PIDs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mrw-pid-'));
  try {
    assert.equal(isPaseoPidAlive(root), false);

    await writeFile(join(root, 'paseo.pid'), JSON.stringify({ pid: 999999, startedAt: new Date().toISOString() }));
    assert.equal(isPaseoPidAlive(root), false);

    const livePid = process.ppid > 1 ? process.ppid : 1;
    if (livePid > 1) {
      const veryOld = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
      await writeFile(join(root, 'paseo.pid'), JSON.stringify({ pid: livePid, startedAt: veryOld }));
      assert.equal(isPaseoPidAlive(root), false, 'pre-boot PID reuse must be classified dead');

      if (process.platform === 'linux') {
        await writeFile(
          join(root, 'paseo.pid'),
          JSON.stringify({ pid: livePid, startedAt: new Date().toISOString(), bootId: '00000000-0000-0000-0000-000000000000' }),
        );
        assert.equal(isPaseoPidAlive(root), false, 'stale Linux bootId must be classified dead');
      }

      await writeFile(join(root, 'paseo.pid'), JSON.stringify({ pid: livePid, startedAt: new Date().toISOString() }));
      assert.equal(isPaseoPidAlive(root), true);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('resolvePaseoLauncher searches PATH, node sibling bin, .npmrc prefix, and avoids Windows cmd.exe fallback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mrw-resolve-'));
  try {
    const pathBin = join(root, 'path-bin');
    const nodeRoot = join(root, 'node-root');
    const nodeBin = join(nodeRoot, 'bin');
    const customPrefix = join(root, 'custom-npm');
    const customBin = join(customPrefix, 'bin');
    const fakeNode = join(nodeBin, process.platform === 'win32' ? 'node.exe' : 'node');
    const paseoPkgBin = join(nodeRoot, 'lib', 'node_modules', '@getpaseo', 'cli', 'bin');
    await Promise.all([
      mkdir(pathBin, { recursive: true }),
      mkdir(nodeBin, { recursive: true }),
      mkdir(customBin, { recursive: true }),
      mkdir(paseoPkgBin, { recursive: true }),
    ]);

    const mockBin = join(pathBin, process.platform === 'win32' ? 'paseo.exe' : 'paseo');
    await writeFile(mockBin, '#!/bin/sh\nexit 0\n');
    if (process.platform !== 'win32') await chmod(mockBin, 0o755);

    const fromPath = resolvePaseoLauncher({ PATH: pathBin }, process.platform, fakeNode, root);
    assert.deepEqual(fromPath, { command: mockBin, argsPrefix: [] });

    // Stripped PATH (LaunchAgent / systemd): resolves custom .npmrc prefix including ${HOME}
    const npmrcHome = join(root, 'npmrc-home');
    await mkdir(npmrcHome, { recursive: true });
    await writeFile(join(npmrcHome, '.npmrc'), `# comment\nprefix = "${customPrefix}"\n`);
    const customPaseo = join(customBin, 'paseo');
    await writeFile(customPaseo, '#!/bin/sh\nexit 0\n');
    if (process.platform !== 'win32') {
      await chmod(customPaseo, 0o755);
      const fromNpmrc = resolvePaseoLauncher({ PATH: '/usr/bin:/bin' }, 'linux', fakeNode, npmrcHome);
      assert.deepEqual(fromNpmrc, { command: customPaseo, argsPrefix: [] });

      const envToolBin = join(npmrcHome, 'tools', 'bin');
      await mkdir(envToolBin, { recursive: true });
      const envToolPaseo = join(envToolBin, 'paseo');
      await writeFile(envToolPaseo, '#!/bin/sh\nexit 0\n');
      await chmod(envToolPaseo, 0o755);
      await writeFile(join(npmrcHome, '.npmrc'), 'prefix=${HOME}/tools\n');
      const fromEnvNpmrc = resolvePaseoLauncher({ PATH: '/usr/bin:/bin', HOME: npmrcHome }, 'linux', fakeNode, npmrcHome);
      assert.deepEqual(fromEnvNpmrc, { command: envToolPaseo, argsPrefix: [] });
    }

    // Windows .cmd without @getpaseo/cli/bin/paseo must NOT return cmd.exe
    const winDir = join(root, 'win-cmd-only');
    await mkdir(winDir, { recursive: true });
    await writeFile(join(winDir, 'paseo.cmd'), '@echo off\r\n');
    assert.equal(resolvePaseoLauncher({ PATH: winDir }, 'win32', fakeNode, join(root, 'empty-home')), null);

    // Stripped PATH (LaunchAgent / systemd): falls back to node sibling @getpaseo/cli/bin/paseo
    const jsEntry = join(paseoPkgBin, 'paseo');
    await writeFile(jsEntry, '#!/usr/bin/env node\n');
    if (process.platform !== 'win32') {
      await symlink('../lib/node_modules/@getpaseo/cli/bin/paseo', join(nodeBin, 'paseo'));
      const fromSibling = resolvePaseoLauncher({ PATH: '/usr/bin:/bin' }, 'linux', fakeNode, root);
      assert.ok(fromSibling);
      assert.equal(fromSibling.command, fakeNode);
      assert.equal(fromSibling.argsPrefix[0], '--disable-warning=DEP0040');
      assert.ok(fromSibling.argsPrefix[1].endsWith('/@getpaseo/cli/bin/paseo'));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('spawnPaseoStart passes special characters safely without shell parsing and isolates systemd scope when INVOCATION_ID is set', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'mrw-spawn-'));
  try {
    const binDir = join(root, 'bin');
    const trickyHome = join(root, 'Paseo &whoami %PATH%');
    const argvLog = join(root, 'argv.json');
    const systemdLog = join(root, 'systemd.json');
    const injectedMarker = join(root, 'pwned');
    await Promise.all([mkdir(binDir), mkdir(trickyHome)]);

    const paseoBin = join(binDir, 'paseo');
    await writeFile(
      paseoBin,
      `#!${process.execPath}
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(argvLog)}, JSON.stringify(process.argv.slice(2)));
`,
      { mode: 0o755 },
    );
    const systemdRunBin = join(binDir, 'systemd-run');
    await writeFile(
      systemdRunBin,
      `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('--help')) { console.log('--expand-environment=BOOL'); process.exit(0); }
fs.writeFileSync(${JSON.stringify(systemdLog)}, JSON.stringify(args));
`,
      { mode: 0o755 },
    );

    const res = await spawnPaseoStart(trickyHome, undefined, { env: { PATH: binDir }, platform: 'darwin' });
    assert.deepEqual(res, { ok: true, code: null });
    assert.deepEqual(JSON.parse(await readFile(argvLog, 'utf8')), ['daemon', 'start', '--home', trickyHome, '--timeout', '15']);
    await assert.rejects(readFile(injectedMarker, 'utf8'));

    const dollarHome = join(root, '${MR_SLOT}');
    await mkdir(dollarHome);
    const linuxRes = await spawnPaseoStart(dollarHome, undefined, {
      env: { PATH: binDir, INVOCATION_ID: '1234567890abcdef', MR_SLOT: 'other' },
      platform: 'linux',
    });
    assert.deepEqual(linuxRes, { ok: true, code: null });
    assert.deepEqual(JSON.parse(await readFile(systemdLog, 'utf8')), [
      '--user',
      '--scope',
      '--quiet',
      '--collect',
      '--expand-environment=no',
      '--',
      paseoBin,
      'daemon',
      'start',
      '--home',
      dollarHome,
      '--timeout',
      '15',
    ]);

    // Older systemd-run without --expand-environment must refuse literal $ paths instead of risking expansion
    await writeFile(
      systemdRunBin,
      `#!${process.execPath}
if (process.argv.includes('--help')) { console.log('--scope'); process.exit(0); }
require('node:fs').writeFileSync(${JSON.stringify(injectedMarker)}, 'ran');
`,
      { mode: 0o755 },
    );
    const unsafeDollar = await spawnPaseoStart(dollarHome, undefined, {
      env: { PATH: binDir, INVOCATION_ID: '1234567890abcdef', MR_SLOT: 'other' },
      platform: 'linux',
    });
    assert.deepEqual(unsafeDollar, { ok: false, code: 'PASEO_ISOLATION_UNAVAILABLE' });
    await assert.rejects(readFile(injectedMarker, 'utf8'));

    // Refuses to run un-isolated under Linux systemd (INVOCATION_ID) when systemd-run is absent
    const isolatedBin = join(root, 'no-systemd-run');
    await mkdir(isolatedBin);
    const plainPaseo = join(isolatedBin, 'paseo');
    const unisolatedFlag = join(root, 'unisolated-ran');
    await writeFile(
      plainPaseo,
      `#!${process.execPath}
require('node:fs').writeFileSync(${JSON.stringify(unisolatedFlag)}, 'ran');
`,
      { mode: 0o755 },
    );
    const refused = await spawnPaseoStart(trickyHome, undefined, {
      env: { PATH: isolatedBin, INVOCATION_ID: '1234567890abcdef' },
      platform: 'linux',
      systemDirs: [],
    });
    assert.deepEqual(refused, { ok: false, code: 'PASEO_ISOLATION_UNAVAILABLE' });
    await assert.rejects(readFile(unisolatedFlag, 'utf8'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('PaseoWatchdog starts immediately on boot, honors restart grace after live session, and backs off failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mrw-sm-'));
  try {
    const paseoHome = join(root, 'paseo');
    await mkdir(paseoHome);
    await writeFile(join(paseoHome, 'daemon-keypair.json'), '{}');
    const config = baseConfig(paseoHome);

    let now = 100_000;
    let alive = false;
    const calls: string[] = [];
    let nextResult = { ok: true, code: null as string | null };

    const watchdog = new PaseoWatchdog({
      restartGraceMs: 4000,
      cooldownMs: 10000,
      missingBinaryCooldownMs: 60000,
      maxBackoffMs: 80000,
      clock: () => now,
      isAlive: () => alive,
      startDaemon: async home => {
        calls.push(home);
        return nextResult;
      },
    });

    // 1. Cold boot -> starts immediately
    const boot = await watchdog.ensureAfterConnectFailure(config);
    assert.deepEqual(boot, { attempted: true, started: true, code: null });
    assert.equal(calls.length, 1);

    // Cooldown prevents tight spawn loop if connect still fails right after start
    now += 2000;
    const cooling = await watchdog.ensureAfterConnectFailure(config);
    assert.equal(cooling.attempted, false);

    // 2. Live connection clears state, subsequent drop waits restartGraceMs
    watchdog.onConnected();
    now += 1000;
    const grace1 = await watchdog.ensureAfterConnectFailure(config);
    assert.deepEqual(grace1, { attempted: false, started: false, code: 'PASEO_RESTART_GRACE' });
    assert.equal(calls.length, 1);

    // Reconnecting during grace cancels pending start
    now += 2000;
    watchdog.onConnected();
    now += 1000;
    const grace2 = await watchdog.ensureAfterConnectFailure(config);
    assert.equal(grace2.code, 'PASEO_RESTART_GRACE');
    assert.equal(calls.length, 1);

    // Exceeding grace triggers crash recovery
    now += 4500;
    const crashHeal = await watchdog.ensureAfterConnectFailure(config);
    assert.deepEqual(crashHeal, { attempted: true, started: true, code: null });
    assert.equal(calls.length, 2);

    // If PID is alive (still binding), watchdog waits without spawning
    now += 15000;
    alive = true;
    const starting = await watchdog.ensureAfterConnectFailure(config);
    assert.deepEqual(starting, { attempted: false, started: false, code: 'PASEO_STARTING' });
    assert.equal(calls.length, 2);

    // 3. Repeated failures back off exponentially (10s -> 20s -> 40s)
    alive = false;
    nextResult = { ok: false, code: 'PASEO_START_FAILED' };
    const fail1 = await watchdog.ensureAfterConnectFailure(config);
    assert.deepEqual(fail1, { attempted: true, started: false, code: 'PASEO_START_FAILED' });
    assert.equal(watchdog.status().state, 'backoff');
    now += 9000;
    assert.equal((await watchdog.ensureAfterConnectFailure(config)).attempted, false);
    now += 1500;
    assert.equal((await watchdog.ensureAfterConnectFailure(config)).attempted, true);
    now += 15000;
    assert.equal((await watchdog.ensureAfterConnectFailure(config)).attempted, false);
    now += 6000;
    assert.equal((await watchdog.ensureAfterConnectFailure(config)).attempted, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('real runRuntime starts Paseo while the cloud is blocked and self-heals after a crash', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'mrw-e2e-'));
  const dir = join(root, 'cli');
  const paseoHome = join(root, 'paseo');
  const binDir = join(root, 'bin');
  const startLog = join(root, 'paseo-starts.jsonl');
  const credToken = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE';

  let unblockCloud!: () => void;
  const cloudGate = new Promise<void>(resolve => { unblockCloud = resolve; });
  let waitingForCloud = false;
  const cloud = createServer(async (_request, response) => {
    waitingForCloud = true;
    await cloudGate;
    response.writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ ok: true }));
  });
  cloud.listen(0, '127.0.0.1');
  await once(cloud, 'listening');
  const cloudAddress = cloud.address();
  assert.ok(cloudAddress && typeof cloudAddress !== 'string');
  const apiOrigin = `http://127.0.0.1:${cloudAddress.port}`;
  const { pair } = makeOffer(apiOrigin);
  pair.active = true;

  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(wss, 'listening');
  const addr = wss.address();
  assert.ok(addr && typeof addr !== 'string');
  let allowConnect = false;

  wss.on('connection', socket => {
    if (!allowConnect) { socket.close(); return; }
    const reply = (message: unknown) => socket.send(JSON.stringify(wrapSessionMessage(message)));
    socket.on('message', data => {
      const f = JSON.parse(data.toString());
      if (f.type === 'hello') {
        reply({ type: 'status', payload: { status: 'server_info', serverId: 'srv_watchdog_e2e', hostname: 'SyntheticWatchdog', features: { explicitEventSubscriptions: true, ownedSubscriptions: true } } });
      } else if (f.type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong' }));
      } else if (f.type === 'session') {
        const m = f.message;
        if (m.type === 'session.events.set_subscription.request') reply({ type: 'session.events.set_subscription.response', payload: { requestId: m.requestId, subscriptionId: 's1' } });
        else if (m.type === 'fetch_agents_request') reply({ type: 'fetch_agents_response', payload: { requestId: m.requestId, ...(m.subscribe ? { subscriptionId: 'agents' } : {}), entries: [], pageInfo: { nextCursor: null, prevCursor: null, hasMore: false } } });
        else if (m.type === 'subscription.release.request') reply({ type: 'subscription.release.response', payload: { requestId: m.requestId } });
      }
    });
  });

  const spawnedPidsPath = join(root, 'spawned-pids.jsonl');
  let child: ReturnType<typeof spawn> | undefined;
  let exited: Promise<unknown> | undefined;

  try {
    await Promise.all([mkdir(paseoHome, { mode: 0o700 }), mkdir(binDir, { mode: 0o700 })]);
    await writeFile(join(paseoHome, 'daemon-keypair.json'), '{}', { mode: 0o600 });
    await writeFile(join(paseoHome, 'server-id'), 'srv_watchdog_e2e\n', { mode: 0o600 });
    await writeFile(join(paseoHome, 'local-credential'), credToken + '\n', { mode: 0o600 });

    const fakeScript = join(root, 'fake-paseo.mjs');
    await writeFile(
      fakeScript,
      `import { appendFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
appendFileSync(${JSON.stringify(startLog)}, JSON.stringify(process.argv.slice(2)) + '\\n');
const daemon = spawn(process.execPath, ['-e', 'setInterval(()=>{}, 1000)'], { detached: true, stdio: 'ignore', windowsHide: true });
daemon.unref();
appendFileSync(${JSON.stringify(spawnedPidsPath)}, String(daemon.pid) + '\\n');
writeFileSync(${JSON.stringify(join(paseoHome, 'paseo.pid'))}, JSON.stringify({ pid: daemon.pid, startedAt: new Date().toISOString(), listen: ${JSON.stringify(`tcp://127.0.0.1:${addr.port}`)} }));
`,
      { mode: 0o600 },
    );

    if (process.platform === 'win32') {
      const pkgDir = join(binDir, 'node_modules', '@getpaseo', 'cli'), pkgBin = join(pkgDir, 'bin');
      await mkdir(pkgBin, { recursive: true });
      await writeFile(join(pkgDir, 'package.json'), JSON.stringify({ name: '@getpaseo/cli', type: 'module' }));
      await writeFile(join(pkgBin, 'paseo'), `import ${JSON.stringify(pathToFileURL(fakeScript).href)};\n`);
    } else {
      await writeFile(join(binDir, 'paseo'), `#!/bin/sh\nexec "${process.execPath}" "${fakeScript}" "$@"\n`, { mode: 0o755 });
    }

    await saveConfig(dir, baseConfig(paseoHome, {
      daemonServerId: 'srv_watchdog_e2e', cloudEnabled: true, allowLoopbackHttp: true, apiOrigin, pairs: [pair],
    }));
    // Previously executed durable work can require HTTP before the daemon is available.
    const journal = new OperationJournal(join(dir, 'journal.sqlite'));
    try {
      const id = '11111111-1111-4111-8111-111111111111', issuedAt = Date.now();
      const key = decode(pair.rootKey, 32);
      journal.prepare(await sealEnvelope(key, { version: 1, pairId: pair.pairId, id,
        channel: 'command', issuedAt, expiresAt: issuedAt + 300000 },
        { type: 'send', agentId: 'synthetic', messageId: id, text: 'already executed' }));
      journal.dispatched(pair.pairId, id);
      journal.outcome(pair.pairId, id, 'accepted', await sealEnvelope(key, {
        version: 1, pairId: pair.pairId, id, channel: 'receipt', issuedAt, expiresAt: issuedAt + 600000,
      }, { operationId: id, state: 'accepted', revision: 1 }));
    } finally { journal.close(); }
    assert.ok(Buffer.byteLength(controlEndpoint(dir)) < 100 || process.platform === 'win32');
    allowConnect = true;
    child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', "import { runRuntime } from './src/runtime.ts'; await runRuntime(process.argv[1]); process.disconnect?.();", dir], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, PASEO_PASSWORD: '', PATH: `${binDir}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}` },
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    exited = once(child, 'exit');

    const waitUntil = async (fn: () => Promise<boolean>, label: string, ms = 15000) => {
      const end = performance.now() + ms;
      while (performance.now() < end) {
        try { if (await fn()) return; } catch {}
        await sleep(50);
      }
      throw Error(label);
    };

    await waitUntil(async () => waitingForCloud && (await readFile(startLog, 'utf8')).length > 0,
      'CLOUD_REQUEST_BLOCKED_LOCAL_AUTOSTART', 5000);
    unblockCloud();
    await waitUntil(async () => {
      const st = await requestControl(dir, 'status');
      return st?.stage === 'cloud-enabled' && (st.paseoWatchdog as { recoveries?: number } | undefined)?.recoveries === 1;
    }, 'BOOT_AUTOSTART_FAILED');

    allowConnect = false;
    const firstPid = Number((await readFile(spawnedPidsPath, 'utf8')).trim().split('\n')[0]);
    if (firstPid > 1) try { process.kill(firstPid, 'SIGKILL'); } catch {}
    await rm(join(paseoHome, 'paseo.pid'), { force: true });
    for (const sock of wss.clients) sock.terminate();
    await sleep(300);
    allowConnect = true;

    await waitUntil(async () => {
      const st = await requestControl(dir, 'status');
      return st?.stage === 'cloud-enabled' && (st.paseoWatchdog as { recoveries?: number } | undefined)?.recoveries === 2;
    }, 'CRASH_SELF_HEAL_FAILED', 18000);

    const starts = (await readFile(startLog, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as string[]);
    assert.equal(starts.length, 2);
    for (const argv of starts) assert.deepEqual(argv, ['daemon', 'start', '--home', paseoHome, '--timeout', '15']);

    await requestControl(dir, 'stop');
    const [code] = await exited;
    assert.equal(code, 0);
    assert.ok(isPaseoPidAlive(paseoHome), 'stopping companion must leave Paseo alive');
  } finally {
    unblockCloud();
    cloud.closeAllConnections();
    await new Promise<void>(resolveClose => cloud.close(() => resolveClose()));
    try {
      for (const line of (await readFile(spawnedPidsPath, 'utf8')).trim().split('\n')) {
        const pid = Number(line);
        if (pid > 1) try { process.kill(pid, 'SIGKILL'); } catch {}
      }
    } catch {}
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exited?.catch(() => {});
    }
    for (const sock of wss.clients) sock.terminate();
    await new Promise<void>(resolveClose => wss.close(() => resolveClose()));
    await rm(root, { recursive: true, force: true });
  }
});
