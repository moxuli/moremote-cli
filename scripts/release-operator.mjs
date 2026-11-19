import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {closeSync, existsSync, fsyncSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, dirname, isAbsolute, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

const repository = 'github.com/moxuli/moremote-cli';
const packageName = '@moxuli/moremote';
const registryUrl = 'https://registry.npmjs.org';
const githubUrl = `https://${repository}`;
const githubAssetHosts = new Set(['release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
const allowedRemotes = new Set([
 `https://${repository}`, `https://${repository}.git`,
 'git@github.com:moxuli/moremote-cli.git',
 'ssh://git@github.com/moxuli/moremote-cli.git',
]);

const tagPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const sourcePattern = /^[a-f0-9]{40}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const nodeVersion = '24.13.0';
const cliPath = fileURLToPath(import.meta.url);

const usage = `MoRemote CLI release operator

  npm run release -- plan --sha <reviewed SHA>
  npm run release -- prepare --sha <reviewed SHA>
  npm run release -- publish --sha <reviewed SHA> --confirm <vX.Y.Z>
  npm run release -- verify --sha <published SHA> --tag <vX.Y.Z> [--expect-sha256 <digest>]

Plan is offline. Prepare runs local checks in an isolated checkout. Publish pushes
one tag for the existing workflow. Verify reads the hosted run and public package,
compares its release assets, and checks an isolated exact-version installation.`;

function requireEvidence(condition, message) {
 if (!condition) throw new Error(message);
}

function command(tool, args, {cwd, env, timeout = 120_000, showOutput = false} = {}) {
 const result = spawnSync(tool, args, {
  cwd, env, timeout, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true,
 });
 if (showOutput) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
 }
 requireEvidence(!result.error && result.status === 0,
  `${basename(tool)} ${args.slice(0, 2).map(arg => basename(arg)).join(' ')} failed (${result.error?.code ?? result.signal ?? result.status}).`);
 return result.stdout;
}

function privateNpmEnvironment(directory, sourceEnv) {
 const home = join(directory, 'home');
 const cache = join(directory, 'cache');
 mkdirSync(home);
 const userconfig = join(directory, 'user.npmrc');
 const globalconfig = join(directory, 'global.npmrc');
 writeFileSync(userconfig, '', {mode: 0o600});
 writeFileSync(globalconfig, '', {mode: 0o600});
 const env = {};
 for (const [key, value] of Object.entries(sourceEnv)) {
  if (/^(path|pathext|systemroot|windir|comspec|systemdrive)$/i.test(key) && value !== undefined) {
   env[key] = value;
  }
 }
 return {
  ...env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home,
  XDG_CONFIG_HOME: home, XDG_CACHE_HOME: cache, XDG_DATA_HOME: home, XDG_STATE_HOME: home,
  TMPDIR: directory, TEMP: directory, TMP: directory, CI: 'true', NO_COLOR: '1',
  npm_config_userconfig: userconfig, npm_config_globalconfig: globalconfig,
  npm_config_cache: cache, npm_config_registry: registryUrl,
  npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false',
 };
}

async function inTemp(run) {
 // Native smoke tests create Unix sockets beneath this private directory.
 // macOS's default per-user temp path can exceed the socket path limit.
 const temporaryRoot = process.platform === 'darwin' ? '/tmp' : tmpdir();
 const directory = mkdtempSync(join(temporaryRoot, 'mr-rel-'));
 try {
  return await run(directory);
 } finally {
  rmSync(directory, {recursive: true, force: true, maxRetries: 3});
 }
}

function readWorkflow(exec, filename, ref, sha, acceptFailure = false) {
 const runs = JSON.parse(exec('gh', [
  'run', 'list', '--repo', repository, '--workflow', filename,
  '--branch', ref, '--commit', sha, '--event', 'push', '--limit', '20',
  '--json', 'headSha,headBranch,status,conclusion,databaseId,url',
 ]));
 const run = runs.find(candidate => candidate.headSha === sha && candidate.headBranch === ref);
 requireEvidence(run?.status === 'completed' && (run.conclusion === 'success' || (acceptFailure && run.conclusion === 'failure')),
  `The ${filename} workflow for ${ref} at ${sha} has no acceptable completed run (observed ${run?.conclusion || run?.status || 'no matching run'}).`);
 return run;
}

function readHostedRelease(exec, tag, sha) {
 const run = readWorkflow(exec, 'release.yml', tag, sha, true);
 if (run.conclusion === 'success') return run;
 const detail = JSON.parse(exec('gh', ['run', 'view', String(run.databaseId), '--repo', repository,
  '--json', 'headSha,headBranch,status,conclusion,jobs']));
 const [job] = detail.jobs ?? [];
 const publish = 'Publish exact tested tarball with the existing scoped organization secret';
 const create = 'Create GitHub Release with exact published bytes';
 const steps = job?.steps ?? [];
 const succeeded = step => step?.status === 'completed' && step.conclusion === 'success';
 const failures = steps.filter(step => step.conclusion === 'failure');
 requireEvidence(detail.headSha === sha && detail.headBranch === tag
  && detail.status === 'completed' && detail.conclusion === 'failure'
  && detail.jobs?.length === 1 && job?.name === 'release'
  && job.status === 'completed' && job.conclusion === 'failure'
  && succeeded(steps.find(step => step.name === publish))
  && failures.length === 1 && failures[0].name === create && failures[0].status === 'completed'
  && steps.every(step => step.name === create || succeeded(step)
   || (step.name.startsWith('Post Run actions/') && step.conclusion === 'skipped')),
 'The hosted release workflow did not complete or fail only at GitHub Release creation after a successful npm publish.');
 return {...run, recovered: true};
}

async function readRegistry(fetch, version) {
 const response = await fetch(`${registryUrl}/${encodeURIComponent(packageName)}/${version}`, {
  redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(30_000),
 });
 if (response.status === 404) return null;
 requireEvidence(response.ok, `Anonymous npm metadata request failed (HTTP ${response.status}).`);
 return response.json();
}

async function readPublicGitHub(fetch, url, description, asset = false) {
 for (let redirects = 0; redirects <= 3; redirects++) {
  const response = await fetch(url, {
   redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 200) return response;
  const location = response.headers.get('location');
  requireEvidence(asset && [301, 302, 303, 307, 308].includes(response.status) && location,
   `Anonymous GitHub ${description} request failed (HTTP ${response.status}).`);
  await response.body?.cancel();
  const next = new URL(location, url);
  requireEvidence(next.protocol === 'https:' && !next.username && !next.password && !next.port
   && githubAssetHosts.has(next.hostname), 'GitHub redirected a release asset to an unexpected host.');
  url = next.href;
 }
 throw new Error('GitHub release asset redirected too many times.');
}

function digest(bytes, algorithm = 'sha256', encoding = 'hex') {
 return createHash(algorithm).update(bytes).digest(encoding);
}

function npmScript(env) {
 const npm = env.npm_execpath;
 requireEvidence(npm && basename(npm) === 'npm-cli.js', 'Invoke the operator with npm run release -- <mode>.');
 return npm;
}

function runNpm(exec, env, temporaryEnv, cwd, args) {
 return exec(process.execPath, [npmScript(env), ...args], {
  cwd, env: temporaryEnv, timeout: 600_000, showOutput: true,
 });
}

function expectedRemote(exec) {
 const read = exec('git', ['remote', 'get-url', '--all', 'origin']).trim();
 const write = exec('git', ['remote', 'get-url', '--push', '--all', 'origin']).trim();
 requireEvidence(allowedRemotes.has(read) && allowedRemotes.has(write),
  `The only permitted origin is ${repository}.`);
 return write;
}

function remoteRefs(exec, tag) {
 const ref = 'refs/tags/' + tag;
 const rows = exec('git', ['ls-remote', 'origin', 'refs/heads/main', ref, ref + '^{}']).trim();
 const refs = new Map(rows ? rows.split(/\r?\n/).map(row => {
  const [hash, name] = row.split('\t');
  return [name, hash];
 }) : []);
 return {main: refs.get('refs/heads/main'), tag: refs.get(ref + '^{}') ?? refs.get(ref)};
}

function pendingIntent(exec, tag) {
 const commonDir = exec('git', ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim();
 requireEvidence(isAbsolute(commonDir), 'Git did not report an absolute common directory.');
 return join(commonDir, 'moremote-release-intents', tag + '.json');
}

function recordIntent(path, sha, tag) {
 const directory = dirname(path);
 mkdirSync(directory, {recursive: true, mode: 0o700});
 let file;
 try {
  file = openSync(path, 'wx', 0o600);
 } catch (error) {
  if (error.code === 'EEXIST') throw new Error(`A release intent already exists for ${tag}. Reconcile the remote state before sending again.`);
  throw error;
 }
 try {
  writeFileSync(file, JSON.stringify({repository, tag, sha, createdAt: new Date().toISOString()}) + '\n');
  fsyncSync(file);
 } finally {
  closeSync(file);
 }
 if (process.platform !== 'win32') {
  for (const parent of [directory, dirname(directory)]) {
   const entries = openSync(parent, 'r');
   try {
    fsyncSync(entries);
   } finally {
    closeSync(entries);
   }
  }
 }
}

async function prepare(exec, env, root, directory, sha, tag, print) {
 const source = join(directory, 'source');
 const temporaryEnv = {...privateNpmEnvironment(directory, env), npm_execpath: npmScript(env)};
 exec('git', ['clone', '--quiet', '--no-hardlinks', '--no-tags', '--no-checkout', '--', root, source]);
 exec('git', ['checkout', '--quiet', '--detach', sha], {cwd: source});
 requireEvidence(exec('git', ['rev-parse', 'HEAD'], {cwd: source}).trim() === sha,
  'The isolated checkout does not match the reviewed SHA.');
 const releaseScript = join(source, 'scripts', 'release.mjs');
 exec(process.execPath, [releaseScript, 'validate', tag], {cwd: source, env: temporaryEnv});
 for (const args of [
  ['ci', '--ignore-scripts'], ['run', 'check'], ['run', 'smoke:upgrade'],
 ]) {
  print(`Running npm ${args.join(' ')} in the isolated checkout.`);
  runNpm(exec, env, temporaryEnv, source, args);
 }
 exec(process.execPath, [releaseScript, 'pack', tag], {cwd: source, env: temporaryEnv});
 const filename = `moxuli-moremote-${tag.slice(1)}.tgz`;
 const checksum = digest(readFileSync(join(source, filename)));
 requireEvidence(readFileSync(join(source, 'SHA256SUMS'), 'utf8').trim() === `${checksum}  ${filename}`,
  'The prepared tarball does not match SHA256SUMS.');
 requireEvidence(!exec('git', ['status', '--porcelain', '--untracked-files=all'], {cwd: source}).trim(),
  'Preparing the package changed the isolated source.');
 print(`Prepared ${tag} at ${sha} with SHA256 ${checksum}.`);
 return source;
}

async function verify({exec, fetch, env, print}, sha, tag, expectedDigest) {
 requireEvidence(remoteRefs(exec, tag).tag === sha, `The remote tag ${tag} does not resolve to source ${sha}.`);
 const version = tag.slice(1);
 const metadata = await readRegistry(fetch, version);
 requireEvidence(metadata, `npm ${packageName}@${version} is not yet visible. Inspect the existing release run before retrying verification.`);
 const workflow = readHostedRelease(exec, tag, sha);
 const filename = `moxuli-moremote-${version}.tgz`;
 const release = JSON.parse(exec('gh', ['release', 'view', tag, '--repo', repository,
  '--json', 'tagName,isDraft,isPrerelease,assets']));
 requireEvidence(release.tagName === tag && release.isDraft === false && release.isPrerelease === false,
  'GitHub did not return the expected stable release.');
 const asset = release.assets?.find(item => item.name === filename);
 const checksumAsset = release.assets?.find(item => item.name === 'SHA256SUMS');
 requireEvidence(asset?.state === 'uploaded' && checksumAsset?.state === 'uploaded',
  'The GitHub release is missing its tarball or SHA256SUMS.');
 const expectedTarball = `${registryUrl}/${packageName}/-/moremote-${version}.tgz`;
 requireEvidence(metadata.name === packageName && metadata.version === version && metadata.dist?.tarball === expectedTarball,
  'The exact npm package identity or tarball URL did not match.');
 const response = await fetch(expectedTarball, {
  redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(30_000),
 });
 requireEvidence(response.ok, `Anonymous npm tarball request failed (HTTP ${response.status}).`);
 const npmBytes = Buffer.from(await response.arrayBuffer());
 requireEvidence(metadata.dist.integrity === 'sha512-' + digest(npmBytes, 'sha512', 'base64')
  && metadata.dist.shasum === digest(npmBytes, 'sha1'), 'The npm tarball failed its published integrity checks.');
 const sha256 = digest(npmBytes);
 requireEvidence(!expectedDigest || sha256 === expectedDigest, 'The npm SHA256 does not match the prepared tarball digest.');
 for (const [url, description] of [[githubUrl, 'repository'], [`${githubUrl}/releases/tag/${tag}`, 'release']]) {
  const document = await readPublicGitHub(fetch, url, description);
  await document.body?.cancel();
 }
 const assetUrl = `${githubUrl}/releases/download/${tag}`;
 const githubTarball = await readPublicGitHub(fetch, `${assetUrl}/${filename}`, 'tarball', true);
 const githubBytes = Buffer.from(await githubTarball.arrayBuffer());
 requireEvidence(npmBytes.equals(githubBytes) && githubBytes.length === asset.size
  && (!asset.digest || asset.digest === 'sha256:' + sha256), 'GitHub and npm tarball bytes do not match.');
 const githubChecksums = await readPublicGitHub(fetch, `${assetUrl}/SHA256SUMS`, 'checksum', true);
 requireEvidence((await githubChecksums.text()).trim() === `${sha256}  ${filename}`,
  'GitHub SHA256SUMS does not match the published tarball.');
 await inTemp(directory => {
  const temporaryEnv = privateNpmEnvironment(directory, env);
  const prefix = join(directory, 'installed');
  const archive = join(directory, filename);
  writeFileSync(archive, npmBytes, {mode: 0o600});
  runNpm(exec, env, temporaryEnv, directory, ['install', '--prefix', prefix, '--ignore-scripts',
   '--no-fund', '--no-audit', '--fetch-retries=0', archive]);
  const entry = join(prefix, 'node_modules', '@moxuli', 'moremote', 'bin', 'moremote-cli.js');
  requireEvidence(exec(process.execPath, [entry, '--version'], {cwd: directory, env: temporaryEnv}).trim() === version,
   'The independently installed CLI reported a different version.');
 });
 requireEvidence(remoteRefs(exec, tag).tag === sha, 'The remote tag changed during verification.');
 if (workflow.recovered) print('Verified the recovered GitHub Release after the hosted workflow published to npm.');
 print(`Verified ${tag} at ${sha}. Release run ${workflow.databaseId}, ${npmBytes.length} bytes, SHA256 ${sha256}.`);
}

export async function runRelease(argv, {
 root = resolve(dirname(cliPath), '..'),
 env = process.env,
 exec: execute = command,
 fetch = globalThis.fetch,
 print = console.log,
} = {}) {
 const [mode = 'help', ...args] = argv;
 if (['help', '--help', '-h'].includes(mode) && args.length === 0) {
  print(usage);
  return;
 }
 requireEvidence(['plan', 'prepare', 'publish', 'verify'].includes(mode), usage);
 const {values} = parseArgs({args, options: {
  sha: {type: 'string'}, tag: {type: 'string'}, confirm: {type: 'string'},
  'expect-sha256': {type: 'string'},
 }});
 const {sha, tag, confirm, 'expect-sha256': expectedDigest} = values;
 requireEvidence(sourcePattern.test(sha ?? ''), 'Supply the full 40-character source SHA with --sha.');
 requireEvidence(process.versions.node === nodeVersion, `The release operator requires Node ${nodeVersion}.`);
 const exec = (tool, toolArgs, options) => execute(tool, toolArgs, {cwd: root, env, ...options});
 if (mode === 'verify') {
  requireEvidence(tagPattern.test(tag ?? '') && !confirm && (!expectedDigest || digestPattern.test(expectedDigest)),
   'Verify requires a stable --tag, with an optional 64-character --expect-sha256.');
  expectedRemote(exec);
  return verify({exec, fetch, env, print}, sha, tag, expectedDigest);
 }
 requireEvidence(!tag && !expectedDigest, '--tag and --expect-sha256 apply to verification only.');
 requireEvidence(mode === 'publish' ? tagPattern.test(confirm ?? '') : !confirm,
  'Publishing requires --confirm <vX.Y.Z>. Confirmation applies to publishing only.');
 requireEvidence(!exec('git', ['status', '--porcelain', '--untracked-files=all']).trim(), 'A clean checkout is required.');
 requireEvidence(exec('git', ['rev-parse', 'HEAD']).trim() === sha, 'HEAD differs from the reviewed source SHA.');
 expectedRemote(exec);
 const versionTag = 'v' + JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
 requireEvidence(tagPattern.test(versionTag), 'The package manifest must declare a stable version.');
 requireEvidence(mode !== 'publish' || confirm === versionTag, 'The confirmation does not match the exact package tag.');
 exec(process.execPath, [join(root, 'scripts', 'release.mjs'), 'validate', versionTag]);
 if (mode === 'plan') {
  print(`Plan for ${packageName} ${versionTag} at ${sha}: local checks, main CI, one tag push, then public receiver verification.`);
  return;
 }
 if (mode === 'prepare') {
  await inTemp(directory => prepare(exec, env, root, directory, sha, versionTag, print));
  return;
 }
 const intent = pendingIntent(exec, versionTag);
 const checkCandidate = async () => {
  const refs = remoteRefs(exec, versionTag);
  requireEvidence(!refs.tag, `Remote tag ${versionTag} exists. Use verify for the existing publication.`);
  requireEvidence(!existsSync(intent),
   `A release intent already exists for ${versionTag}. Reconcile the remote state before sending again.`);
  requireEvidence(refs.main === sha, 'The reviewed commit must be the current origin/main.');
  requireEvidence(!(await readRegistry(fetch, versionTag.slice(1))),
   `npm already serves ${packageName}@${versionTag.slice(1)}. Inspect the existing publication.`);
  const releaseWorkflow = JSON.parse(exec('gh', [
   'api', '--hostname', 'github.com', 'repos/moxuli/moremote-cli/actions/workflows/release.yml',
  ]));
  requireEvidence(releaseWorkflow.path === '.github/workflows/release.yml' && releaseWorkflow.state === 'active',
   'The repository release workflow must be active before pushing a tag.');
  const ci = readWorkflow(exec, 'ci.yml', 'main', sha);
  const {jobs} = JSON.parse(exec('gh', ['run', 'view', String(ci.databaseId), '--repo', repository, '--json', 'jobs']));
  for (const runner of ['ubuntu-24.04', 'macos-15', 'windows-2025']) {
   requireEvidence(jobs?.some(job => job.name === `check (${runner})`
    && job.status === 'completed' && job.conclusion === 'success'), `The ${runner} CI job did not pass.`);
  }
  return ci;
 };
 const ci = await checkCandidate();
 print(`Preflight accepted main CI run ${ci.databaseId}.`);
 await inTemp(async directory => {
  const source = await prepare(exec, env, root, directory, sha, versionTag, print);
  const pushUrl = expectedRemote(exec);
  await checkCandidate();
  const ref = 'refs/tags/' + versionTag;
  exec('git', ['remote', 'set-url', 'origin', pushUrl], {cwd: source});
  requireEvidence(expectedRemote((tool, args) => exec(tool, args, {cwd: source})) === pushUrl,
   'The disposable checkout resolved a different push URL.');
  exec('git', ['tag', '-a', versionTag, sha, '-m', `Release ${versionTag}`], {cwd: source});
  recordIntent(intent, sha, versionTag);
  try {
   exec('git', ['push', '--no-follow-tags', 'origin', `${ref}:${ref}`], {cwd: source});
   requireEvidence(remoteRefs(exec, versionTag).tag === sha, 'Remote readback did not confirm the new tag.');
  } catch (error) {
   throw new Error(`The push outcome is uncertain. Inspect the remote tag and hosted run before any further action. ${error.message}`);
  }
 });
 print(`Tag ${versionTag} at ${sha} is remote. Run verify after the hosted workflow finishes.`);
}

if (process.argv[1] && resolve(process.argv[1]) === cliPath) {
 try {
  await runRelease(process.argv.slice(2));
 } catch (error) {
  console.error(error.message);
  process.exitCode = 1;
 }
}
