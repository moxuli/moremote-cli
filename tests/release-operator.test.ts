import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {runRelease} from '../scripts/release-operator.mjs';

const sha = 'a'.repeat(40);
const wrongSha = 'b'.repeat(40);
const tag = 'v2.3.4';
const filename = 'moxuli-moremote-2.3.4.tgz';
const bytes = Buffer.from('synthetic package bytes');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const tarball = 'https://registry.npmjs.org/@moxuli/moremote/-/moremote-2.3.4.tgz';
const github = 'https://github.com/moxuli/moremote-cli';
const cdn = 'https://release-assets.githubusercontent.com/assets';
const registry = {
 name: '@moxuli/moremote',
 version: '2.3.4',
 dist: {
  tarball,
  integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64'),
  shasum: createHash('sha1').update(bytes).digest('hex'),
 },
};

async function fixture(options: {
 tagSha?: string;
 mainSha?: string;
 ciSha?: string;
 localChanges?: string;
 published?: boolean;
 releaseStatus?: string;
 githubArchive?: Buffer;
 checksum?: string;
 npmIntegrity?: string;
 activeWorkflow?: boolean;
 failPush?: boolean;
 privateGitHub?: boolean;
 foreignAssetRedirect?: boolean;
 failedHostedStep?: 'publish' | 'create' | 'both';
} = {}) {
 const root = await mkdtemp(join(tmpdir(), 'moremote-release-test-'));
 await writeFile(join(root, 'package.json'), JSON.stringify({version: '2.3.4'}));
 const calls: [string, string[]][] = [];
 const urls: string[] = [];
 const output: string[] = [];
 const tagRef = 'refs/tags/' + tag;
 const commonDir = join(root, '.git');
 let remoteTag = options.tagSha;
 const npm = join(root, 'bin', 'npm-cli.js');
 const run = (argv: string[]) => runRelease(argv, {
  root,
  env: {npm_execpath: npm, NODE_AUTH_TOKEN: 'synthetic-private-value', NPM_CONFIG_REGISTRY: 'https://private.example.test'},
  print: (line: string) => output.push(line),
  exec(tool: string, args: string[], context: {cwd: string; env: Record<string, string>}) {
   calls.push([tool, args]);
   if (tool === 'git') {
    if (args[0] === 'remote') return 'https://github.com/moxuli/moremote-cli.git\n';
    if (args[0] === 'status') return options.localChanges ?? '';
    if (args[0] === 'rev-parse') return (args.includes('--git-common-dir') ? commonDir : sha) + '\n';
    if (args[0] === 'ls-remote') {
     const refs = [`${options.mainSha ?? sha}\trefs/heads/main`];
     if (remoteTag) refs.push(`${wrongSha}\t${tagRef}`, `${remoteTag}\t${tagRef}^{}`);
     return refs.join('\n') + '\n';
    }
    if (args[0] === 'clone') {
     mkdirSync(args.at(-1)!);
     return '';
    }
    if (args[0] === 'checkout' || args[0] === 'tag') return '';
    if (args[0] === 'push') {
     if (options.failPush) throw new Error('synthetic timeout');
     remoteTag = sha;
     return '';
    }
   }
   if (tool === 'gh' && args[0] === 'api') {
    return JSON.stringify({path: '.github/workflows/release.yml', state: options.activeWorkflow === false ? 'disabled_manually' : 'active'});
   }
   const [resource, action] = args;
   if (tool === 'gh' && resource === 'run' && action === 'list') {
    const branch = args[args.indexOf('--branch') + 1];
    const status = branch === tag ? (options.releaseStatus ?? 'completed') : 'completed';
    return JSON.stringify([{
     headSha: options.ciSha ?? sha,
     headBranch: branch,
     status,
     conclusion: status !== 'completed' ? '' : branch === tag && options.failedHostedStep ? 'failure' : 'success',
     databaseId: 1234,
    }]);
   }
   if (tool === 'gh' && resource === 'release' && action === 'view') {
    return JSON.stringify({tagName: tag, isDraft: false, isPrerelease: false, assets: [
     {name: filename, size: bytes.length, state: 'uploaded', digest: 'sha256:' + sha256},
     {name: 'SHA256SUMS', size: sha256.length + filename.length + 3, state: 'uploaded'},
    ]});
   }
   if (tool === 'gh' && resource === 'run' && action === 'view') {
    if (options.failedHostedStep) {
     const done = (name: string, conclusion = 'success') => ({name, status: 'completed', conclusion});
     return JSON.stringify({
      headSha: sha, headBranch: tag, status: 'completed', conclusion: 'failure',
      jobs: [{
       name: 'release', status: 'completed', conclusion: 'failure', steps: [
        done('Build byte-deterministic validated release artifact'),
        done('Publish exact tested tarball with the existing scoped organization secret',
         options.failedHostedStep === 'create' ? 'success' : 'failure'),
        done('Create GitHub Release with exact published bytes',
         options.failedHostedStep === 'publish' ? 'skipped' : 'failure'),
        done('Post Run actions/setup-node', 'skipped'),
       ],
      }],
     });
    }
    return JSON.stringify({jobs: ['ubuntu-24.04', 'macos-15', 'windows-2025'].map(runner => ({
     name: `check (${runner})`, status: 'completed', conclusion: 'success',
    }))});
   }
   if (tool === process.execPath) {
    if (args.at(-2) === 'validate' && args.at(-1) === tag) return '';
    if (args.at(-2) === 'pack' && args.at(-1) === tag) {
     writeFileSync(join(context.cwd, filename), bytes);
     writeFileSync(join(context.cwd, 'SHA256SUMS'), `${sha256}  ${filename}\n`);
     return '';
    }
    if (args[0] === npm) {
     assert.equal(context.env.NODE_AUTH_TOKEN, undefined);
     assert.equal(context.env.NPM_CONFIG_REGISTRY, undefined);
     assert.equal(context.env.npm_config_registry, 'https://registry.npmjs.org');
     assert.equal(readFileSync(context.env.npm_config_userconfig, 'utf8'), '');
     if (process.platform === 'darwin') assert.match(context.env.TMPDIR, /^\/tmp\//);
     if (args[1] === 'install') assert.deepEqual(readFileSync(args.at(-1)!), bytes);
     return '';
    }
    if (args.at(-1) === '--version') return '2.3.4\n';
   }
   throw new Error(`Unexpected command ${tool} ${args.join(' ')}`);
  },
  async fetch(url: string, request: RequestInit) {
   urls.push(url);
   assert.equal(request.headers, undefined);
   if (url.startsWith(github) || url.startsWith(cdn)) {
    assert.equal(request.credentials, 'omit');
    assert.equal(request.redirect, 'manual');
    if (url === github || url === `${github}/releases/tag/${tag}`) {
     return new Response(null, {status: options.privateGitHub ? 404 : 200});
    }
    if (url.startsWith(`${github}/releases/download/${tag}/`)) {
     const location = options.foreignAssetRedirect ? 'https://foreign.example.test/asset' : `${cdn}/${url.split('/').at(-1)}`;
     return new Response(null, {status: 302, headers: {location}});
    }
    if (url === `${cdn}/${filename}`) return new Response(options.githubArchive ?? bytes);
    if (url === `${cdn}/SHA256SUMS`) return new Response(options.checksum ?? `${sha256}  ${filename}\n`);
   }
   if (url === tarball) return new Response(bytes);
   assert.equal(url, 'https://registry.npmjs.org/%40moxuli%2Fmoremote/2.3.4');
   if (!options.published) return new Response(null, {status: 404});
   return Response.json({...registry, dist: {...registry.dist, integrity: options.npmIntegrity ?? registry.dist.integrity}});
  },
 });
 const close = () => rm(root, {recursive: true, force: true});
 return {run, calls, urls, output, root, commonDir, close};
}

test('plan is offline and a missing publish confirmation reaches no command', async () => {
 const f = await fixture();
 try {
  await f.run(['plan', '--sha', sha]);
  assert.ok(f.output.some(line => line.includes(tag)));
  assert.deepEqual(f.urls, []);
  assert.ok(!f.calls.some(([tool]) => tool === 'gh'));
  const before = [...f.calls];
  await assert.rejects(f.run(['publish', '--sha', sha]), /confirm/);
  assert.deepEqual(f.calls, before);
 } finally {
  await f.close();
 }
});

test('publish refuses an existing version, wrong upstream or unsuccessful source CI before preparing', async () => {
 for (const [options, failure] of [
  [{published: true}, /already serves/],
  [{mainSha: wrongSha}, /origin\/main/],
  [{ciSha: wrongSha}, /workflow/],
  [{activeWorkflow: false}, /workflow/],
  [{localChanges: '?? local.txt\n'}, /clean/],
  [{tagSha: sha}, /already|exists/],
 ] as const) {
  const f = await fixture(options);
  try {
   await assert.rejects(f.run(['publish', '--sha', sha, '--confirm', tag]), failure);
   assert.ok(!f.calls.some(([tool, args]) => tool === 'git' && args[0] === 'push'));
  } finally {
   await f.close();
  }
 }
});

test('publish pushes one exact tag ref and does not retry an uncertain push', async () => {
 for (const failPush of [false, true]) {
  const f = await fixture({failPush});
  try {
   const operation = f.run(['publish', '--sha', sha, '--confirm', tag]);
   if (failPush) await assert.rejects(operation, /outcome is uncertain/);
   else await operation;
   assert.deepEqual(f.calls.filter(([tool, args]) => tool === 'git' && args[0] === 'push'), [
    ['git', ['push', '--no-follow-tags', 'origin', `refs/tags/${tag}:refs/tags/${tag}`]],
   ]);
  } finally {
   await f.close();
  }
 }
});

test('a fresh process refuses a second push when the remote tag remains absent', async () => {
 const f = await fixture({failPush: true});
 try {
  const argv = ['publish', '--sha', sha, '--confirm', tag];
  await assert.rejects(f.run(argv), /outcome is uncertain/);
  const marker = JSON.parse(readFileSync(join(f.commonDir, 'moremote-release-intents', tag + '.json'), 'utf8'));
  assert.equal(marker.sha, sha);
  assert.equal(marker.tag, tag);
  const script = `
   import {runRelease} from ${JSON.stringify(new URL('../scripts/release-operator.mjs', import.meta.url).href)};
   import assert from 'node:assert/strict';
   await assert.rejects(runRelease(${JSON.stringify(argv)}, {
    root: ${JSON.stringify(f.root)},
    exec(tool, args) {
     if (tool === 'git' && args[0] === 'status') return '';
     if (tool === 'git' && args[0] === 'remote') return 'https://github.com/moxuli/moremote-cli.git';
     if (tool === 'git' && args[0] === 'rev-parse') return args.includes('--git-common-dir')
      ? ${JSON.stringify(f.commonDir)} : '${sha}';
     if (tool === 'git' && args[0] === 'ls-remote') return '${sha}\\trefs/heads/main';
     if (tool === process.execPath && args.at(-2) === 'validate') return '';
     throw new Error('A second process attempted an unexpected command');
    },
    fetch() { throw new Error('A second process contacted a release provider'); },
   }), /release intent already exists/);
  `;
  const second = spawnSync(process.execPath, ['--input-type=module', '-'], {input: script, encoding: 'utf8'});
  assert.ifError(second.error);
  assert.equal(second.status, 0, second.stderr);
 } finally {
  await f.close();
 }
});

test('verification distinguishes pending publication from an exact immutable release', async () => {
 for (const [options, failure] of [
  [{tagSha: wrongSha, published: true}, /tag.*source/i],
  [{tagSha: sha}, /not yet visible/],
  [{tagSha: sha, published: true, releaseStatus: 'in_progress'}, /workflow/],
  [{tagSha: sha, published: true, githubArchive: Buffer.from('mismatched')}, /tarball/],
  [{tagSha: sha, published: true, checksum: 'incorrect\n'}, /SHA256SUMS/],
  [{tagSha: sha, published: true, privateGitHub: true}, /Anonymous GitHub repository/],
  [{tagSha: sha, published: true, foreignAssetRedirect: true}, /unexpected host/],
  [{tagSha: sha, published: true, npmIntegrity: registry.dist.integrity.replace('S', 'X') + 'A'}, /integrity/],
  [{tagSha: sha, published: true}, undefined],
 ] as const) {
  const f = await fixture(options);
  try {
   const args = ['verify', '--sha', sha, '--tag', tag];
   if (failure) {
    await assert.rejects(f.run(args), failure);
   } else {
    await f.run(args);
    assert.ok(f.output.some(line => line.includes(sha256)));
    assert.ok(f.urls.includes(`${github}/releases/tag/${tag}`));
    assert.ok(f.urls.includes(`${cdn}/${filename}`));
   }
   assert.ok(!f.calls.some(([tool, argv]) => tool === 'git' && argv[0] === 'push'));
  } finally {
   await f.close();
  }
 }
});

test('recovery requires successful hosted npm publication and public artifact evidence', async () => {
 const args = ['verify', '--sha', sha, '--tag', tag];
 for (const [options, failure] of [
  [{failedHostedStep: 'publish'}, /workflow/],
  [{failedHostedStep: 'both'}, /workflow/],
  [{failedHostedStep: 'create', privateGitHub: true}, /Anonymous GitHub repository/],
  [{failedHostedStep: 'create', githubArchive: Buffer.from('mismatched')}, /tarball/],
  [{failedHostedStep: 'create'}, undefined],
 ] as const) {
  const f = await fixture({tagSha: sha, published: true, ...options});
  try {
   if (failure) await assert.rejects(f.run(args), failure);
   else {
    await f.run(args);
    assert.ok(f.output.some(line => line.includes('recovered GitHub Release')));
    assert.ok(f.output.some(line => line.includes(sha256)));
   }
   assert.ok(!f.calls.some(([tool, argv]) => tool === 'git' && argv[0] === 'push'));
  } finally {
   await f.close();
  }
 }
});
