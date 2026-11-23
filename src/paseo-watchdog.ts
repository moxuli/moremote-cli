import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { homedir, uptime } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Config } from './config.js';

export interface PaseoLauncher {
  command: string;
  argsPrefix: string[];
}

export interface PaseoStartResult {
  ok: boolean;
  code: string | null;
}

export interface PaseoWatchdogStatus {
  state: 'idle' | 'recovering' | 'backoff' | 'unavailable';
  recoveries: number;
  lastCode: string | null;
}

const KNOWN_FILES = ['config.json', 'daemon-keypair.json', 'server-id', 'paseo.pid'] as const;
const IDENTITY_PROOF_FILES = ['daemon-keypair.json', 'server-id', 'paseo.pid'] as const;
const START_TIMEOUT_SECONDS = '15';
const SPAWN_TIMEOUT_MS = 20000;
const BOOT_TOLERANCE_MS = 5000;

function entryExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ENOENT');
  }
}

function ownedRegularFile(path: string, maxBytes = 65536): string | null {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) return null;
    if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) return null;
    const content = readFileSync(path, 'utf8');
    return Buffer.byteLength(content) <= maxBytes ? content : null;
  } catch {
    return null;
  }
}

function ownedDirectory(path: string): boolean {
  try {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) return false;
    return true;
  } catch {
    return false;
  }
}

export function canManageLocalPaseo(config: Config): boolean {
  if (config.target) return false;
  if (!config.paseoHome || resolve(config.paseoHome) !== config.paseoHome) return false;
  if (!ownedDirectory(config.paseoHome)) return false;

  for (const name of KNOWN_FILES) {
    const full = join(config.paseoHome, name);
    if (entryExists(full) && ownedRegularFile(full) === null) return false;
  }

  const initialized = IDENTITY_PROOF_FILES.some(name => ownedRegularFile(join(config.paseoHome, name)) !== null);
  if (!initialized) return false;

  if (config.daemonServerId) {
    const serverId = ownedRegularFile(join(config.paseoHome, 'server-id'), 512)?.trim();
    if (!serverId || serverId !== config.daemonServerId) return false;
  }
  return true;
}

function currentLinuxBootId(): string | null {
  if (process.platform !== 'linux') return null;
  try {
    return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() || null;
  } catch {
    return null;
  }
}

export function isPaseoPidAlive(paseoHome: string, now = Date.now()): boolean {
  const raw = ownedRegularFile(join(paseoHome, 'paseo.pid'), 65536);
  if (!raw) return false;
  let parsed: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    parsed = value as Record<string, unknown>;
  } catch {
    return false;
  }
  const pid = parsed.pid;
  if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) return false;
  const bootId = currentLinuxBootId();
  if (typeof parsed.bootId === 'string' && bootId && parsed.bootId !== bootId) return false;
  if (typeof parsed.startedAt === 'string') {
    const started = Date.parse(parsed.startedAt);
    if (Number.isFinite(started) && started < now - uptime() * 1000 - BOOT_TOLERANCE_MS) return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
  }
}

function resolveOfficialJsEntry(candidate: string): string | null {
  try {
    const real = realpathSync(candidate);
    const normalized = real.replaceAll('\\', '/');
    if (normalized.endsWith('/@getpaseo/cli/bin/paseo')) return real;
    return null;
  } catch {
    return null;
  }
}

function isExecutableFile(candidate: string): boolean {
  try {
    const stat = lstatSync(candidate);
    if (stat.isSymbolicLink()) {
      const target = realpathSync(candidate);
      if (!lstatSync(target).isFile()) return false;
    } else if (!stat.isFile()) return false;
    if (process.platform !== 'win32') accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function readNpmrcPrefix(rcPath: string, home: string, env: NodeJS.ProcessEnv): string | null {
  const raw = ownedRegularFile(rcPath, 65536);
  if (!raw) return null;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key !== 'prefix') continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!value) continue;
    let unresolved = false;
    value = value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, name: string) => {
      const resolved = name === 'HOME' ? (env.HOME ?? home) : env[name];
      if (resolved === undefined) {
        unresolved = true;
        return '';
      }
      return resolved;
    });
    if (unresolved || !value) continue;
    if (value === '~' || value.startsWith('~/') || value.startsWith('~\\')) {
      value = join(home, value.slice(2));
    }
    return value;
  }
  return null;
}

export function resolvePaseoLauncher(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  execPath: string = process.execPath,
  home: string = homedir(),
): PaseoLauncher | null {
  const dirs: string[] = [];
  const seen = new Set<string>();
  const pushDir = (dir: string | undefined) => {
    if (!dir) return;
    const resolved = resolve(dir);
    if (!seen.has(resolved)) {
      seen.add(resolved);
      dirs.push(resolved);
    }
  };
  const pushPrefix = (prefix: string | null | undefined) => {
    if (!prefix) return;
    pushDir(platform === 'win32' ? prefix : join(prefix, 'bin'));
    pushDir(prefix);
  };

  for (const part of (env.PATH ?? '').split(delimiter)) {
    if (part) pushDir(part);
  }
  pushDir(dirname(execPath));
  pushPrefix(env.npm_config_prefix || env.NPM_CONFIG_PREFIX);
  pushPrefix(readNpmrcPrefix(env.NPM_CONFIG_USERCONFIG || join(home, '.npmrc'), home, env));
  if (env.NPM_CONFIG_GLOBALCONFIG) pushPrefix(readNpmrcPrefix(env.NPM_CONFIG_GLOBALCONFIG, home, env));

  if (platform === 'win32') {
    pushDir(join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'npm'));
  } else {
    pushDir(join(home, '.npm-global', 'bin'));
    pushDir(join(home, '.local', 'bin'));
    pushDir('/opt/homebrew/bin');
    pushDir('/usr/local/bin');
  }

  for (const dir of dirs) {
    if (platform === 'win32') {
      for (const candidate of [
        join(dir, 'node_modules', '@getpaseo', 'cli', 'bin', 'paseo'),
        join(dir, '..', 'lib', 'node_modules', '@getpaseo', 'cli', 'bin', 'paseo'),
        join(dir, '..', 'node_modules', '@getpaseo', 'cli', 'bin', 'paseo'),
      ]) {
        const jsEntry = resolveOfficialJsEntry(candidate);
        if (jsEntry) return { command: execPath, argsPrefix: ['--disable-warning=DEP0040', jsEntry] };
      }
      const exe = join(dir, 'paseo.exe');
      if (isExecutableFile(exe)) return { command: exe, argsPrefix: [] };
    } else {
      const bin = join(dir, 'paseo');
      if (isExecutableFile(bin)) {
        const jsEntry = resolveOfficialJsEntry(bin);
        if (jsEntry) return { command: execPath, argsPrefix: ['--disable-warning=DEP0040', jsEntry] };
        return { command: bin, argsPrefix: [] };
      }
      const jsEntry = resolveOfficialJsEntry(join(dir, '..', 'lib', 'node_modules', '@getpaseo', 'cli', 'bin', 'paseo'));
      if (jsEntry) return { command: execPath, argsPrefix: ['--disable-warning=DEP0040', jsEntry] };
    }
  }
  return null;
}

export function resolveSystemdRun(
  env: NodeJS.ProcessEnv = process.env,
  systemDirs: readonly string[] = ['/usr/bin', '/bin'],
): string | null {
  const candidates = [
    ...(env.PATH ?? '').split(delimiter).filter(Boolean).map(dir => join(resolve(dir), 'systemd-run')),
    ...systemDirs.map(dir => join(dir, 'systemd-run')),
  ];
  for (const candidate of candidates) {
    if (isExecutableFile(candidate)) return candidate;
  }
  return null;
}

export function systemdRunSupportsNoExpand(systemdRun: string): boolean {
  try {
    const res = spawnSync(systemdRun, ['--help'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
      timeout: 2000,
      encoding: 'utf8',
    });
    return res.status === 0 && (res.stdout ?? '').includes('--expand-environment');
  } catch {
    return false;
  }
}

export async function spawnPaseoStart(
  paseoHome: string,
  signal?: AbortSignal,
  options: {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    execPath?: string;
    home?: string;
    timeoutMs?: number;
    systemDirs?: readonly string[];
  } = {},
): Promise<PaseoStartResult> {
  if (signal?.aborted) return { ok: false, code: 'PASEO_START_ABORTED' };
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const execPath = options.execPath ?? process.execPath;
  const launcher = resolvePaseoLauncher(env, platform, execPath, options.home);
  if (!launcher) return { ok: false, code: 'PASEO_CLI_NOT_FOUND' };

  const nodeBin = dirname(execPath);
  const pathParts = (env.PATH ?? '').split(delimiter).filter(Boolean);
  const nextPath = pathParts.includes(nodeBin) ? env.PATH : [nodeBin, ...pathParts].join(delimiter);
  const childEnv: NodeJS.ProcessEnv = { ...env, PATH: nextPath, PASEO_HOME: paseoHome };
  const baseArgs = [...launcher.argsPrefix, 'daemon', 'start', '--home', paseoHome, '--timeout', START_TIMEOUT_SECONDS];

  let command = launcher.command;
  let args = baseArgs;
  if (platform === 'linux' && env.INVOCATION_ID) {
    const systemdRun = resolveSystemdRun(env, options.systemDirs);
    if (!systemdRun) return { ok: false, code: 'PASEO_ISOLATION_UNAVAILABLE' };
    const noExpand = systemdRunSupportsNoExpand(systemdRun);
    if (!noExpand && [launcher.command, ...baseArgs].some(part => part.includes('$'))) {
      return { ok: false, code: 'PASEO_ISOLATION_UNAVAILABLE' };
    }
    command = systemdRun;
    args = [
      '--user',
      '--scope',
      '--quiet',
      '--collect',
      ...(noExpand ? ['--expand-environment=no'] : []),
      '--',
      launcher.command,
      ...baseArgs,
    ];
  }

  return new Promise<PaseoStartResult>(resolvePromise => {
    let settled = false;
    let outputBytes = 0;
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
      env: childEnv,
    });
    const finish = (result: PaseoStartResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolvePromise(result);
    };
    const onAbort = () => {
      for (const stream of [child.stdout, child.stderr]) stream?.destroy();
      child.unref();
      finish({ ok: false, code: 'PASEO_START_ABORTED' });
    };
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      finish({ ok: false, code: 'PASEO_START_TIMEOUT' });
    }, options.timeoutMs ?? SPAWN_TIMEOUT_MS);
    timer.unref();
    signal?.addEventListener('abort', onAbort, { once: true });

    for (const stream of [child.stdout, child.stderr]) {
      stream?.on('data', (chunk: Buffer) => {
        outputBytes += chunk.byteLength;
        if (outputBytes > 65536) {
          stream.destroy();
        }
      });
    }
    child.once('error', () => finish({ ok: false, code: 'PASEO_START_FAILED' }));
    child.once('close', code => {
      finish(code === 0 ? { ok: true, code: null } : { ok: false, code: 'PASEO_START_FAILED' });
    });
  });
}

export interface PaseoWatchdogOptions {
  restartGraceMs?: number;
  cooldownMs?: number;
  missingBinaryCooldownMs?: number;
  maxBackoffMs?: number;
  clock?: () => number;
  isAlive?: (paseoHome: string, now: number) => boolean;
  startDaemon?: (paseoHome: string, signal?: AbortSignal) => Promise<PaseoStartResult>;
}

export class PaseoWatchdog {
  private hasObservedLiveDaemon = false;
  private connectedCount = 0;
  private pendingRecoverySince: number | null = null;
  private consecutiveFailures = 0;
  private nextAttemptAt = 0;
  private recoveries = 0;
  private lastCode: string | null = null;
  private state: PaseoWatchdogStatus['state'] = 'idle';

  private readonly restartGraceMs: number;
  private readonly cooldownMs: number;
  private readonly missingBinaryCooldownMs: number;
  private readonly maxBackoffMs: number;
  private readonly clock: () => number;
  private readonly isAlive: (paseoHome: string, now: number) => boolean;
  private readonly startDaemon: (paseoHome: string, signal?: AbortSignal) => Promise<PaseoStartResult>;

  constructor(options: PaseoWatchdogOptions = {}) {
    this.restartGraceMs = options.restartGraceMs ?? 4000;
    this.cooldownMs = options.cooldownMs ?? 10000;
    this.missingBinaryCooldownMs = options.missingBinaryCooldownMs ?? 60000;
    this.maxBackoffMs = options.maxBackoffMs ?? 300000;
    this.clock = options.clock ?? Date.now;
    this.isAlive = options.isAlive ?? isPaseoPidAlive;
    this.startDaemon = options.startDaemon ?? ((home, signal) => spawnPaseoStart(home, signal));
  }

  onConnected(): void {
    this.connectedCount += 1;
    this.hasObservedLiveDaemon = true;
    this.pendingRecoverySince = null;
    this.consecutiveFailures = 0;
    this.nextAttemptAt = 0;
    this.lastCode = null;
    this.state = 'idle';
  }

  async monitor(readConfig: () => Promise<Config>, signal: AbortSignal,
                onStarted: () => void): Promise<void> {
    while (!signal.aborted) {
      try {
        const config = await readConfig();
        if (!config.target && canManageLocalPaseo(config)) {
          if (this.isAlive(config.paseoHome, this.clock())) {
            this.hasObservedLiveDaemon = true;
            this.pendingRecoverySince = null;
          } else {
            const result = await this.ensureAfterConnectFailure(config, { signal });
            if (result.started && !signal.aborted) onStarted();
          }
        }
      } catch {
        // A transient configuration read must not terminate the runtime.
      }
      await sleep(2000, undefined, { signal }).catch(() => {});
    }
  }

  status(): PaseoWatchdogStatus {
    return { state: this.state, recoveries: this.recoveries, lastCode: this.lastCode };
  }

  async ensureAfterConnectFailure(
    config: Config,
    options: { signal?: AbortSignal } = {},
  ): Promise<{ attempted: boolean; started: boolean; code: string | null }> {
    if (options.signal?.aborted) return { attempted: false, started: false, code: null };
    if (!canManageLocalPaseo(config)) {
      this.state = 'idle';
      this.lastCode = null;
      return { attempted: false, started: false, code: null };
    }
    const now = this.clock();
    if (this.isAlive(config.paseoHome, now)) {
      this.state = 'recovering';
      this.lastCode = 'PASEO_STARTING';
      return { attempted: false, started: false, code: 'PASEO_STARTING' };
    }
    if (this.hasObservedLiveDaemon) {
      if (this.pendingRecoverySince === null) this.pendingRecoverySince = now;
      if (now - this.pendingRecoverySince < this.restartGraceMs) {
        this.state = 'recovering';
        this.lastCode = 'PASEO_RESTART_GRACE';
        return { attempted: false, started: false, code: 'PASEO_RESTART_GRACE' };
      }
    }
    if (now < this.nextAttemptAt) {
      return { attempted: false, started: false, code: this.lastCode };
    }

    const connectedCount = this.connectedCount;
    const result = await this.startDaemon(config.paseoHome, options.signal);
    if (result.ok) {
      this.recoveries += 1;
      this.consecutiveFailures = 0;
      this.nextAttemptAt = this.clock() + this.cooldownMs;
      this.lastCode = null;
      if (this.connectedCount === connectedCount) this.state = 'recovering';
      return { attempted: true, started: true, code: null };
    }
    if (result.code === 'PASEO_START_ABORTED' || this.connectedCount !== connectedCount) {
      return { attempted: true, started: false, code: result.code };
    }
    this.consecutiveFailures += 1;
    const baseDelay = result.code === 'PASEO_CLI_NOT_FOUND' ? this.missingBinaryCooldownMs : this.cooldownMs;
    const delay = Math.min(baseDelay * 2 ** (this.consecutiveFailures - 1), this.maxBackoffMs);
    this.nextAttemptAt = this.clock() + delay;
    this.lastCode = result.code ?? 'PASEO_START_FAILED';
    this.state = result.code === 'PASEO_CLI_NOT_FOUND' ? 'unavailable' : 'backoff';
    return { attempted: true, started: false, code: this.lastCode };
  }
}
