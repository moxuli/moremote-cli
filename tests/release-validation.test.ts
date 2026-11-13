import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('../scripts/release.mjs', import.meta.url));
const original = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

async function validate(capabilities: Record<string, number>) {
 const directory = await mkdtemp(join(tmpdir(), 'moremote-release-validation-'));
 try {
  const manifest = {...original, moremote: capabilities};
  await writeFile(join(directory, 'package.json'), JSON.stringify(manifest));
  await writeFile(join(directory, 'package-lock.json'), JSON.stringify({
   name: manifest.name, version: manifest.version,
   packages: {'': {name: manifest.name, version: manifest.version}},
  }));
  const result = spawnSync(process.execPath, [script, 'validate', 'v' + manifest.version], {
   cwd: directory, encoding: 'utf8',
   env: {...process.env, GITHUB_REPOSITORY: 'moxuli/moremote-cli'},
  });
  assert.ifError(result.error);
  return result;
 } finally {
  await rm(directory, {recursive: true, force: true});
 }
}

test('release validates both retained compatibility and additive enrollment capabilities', async () => {
 for (const capabilities of [
  {updateProtocol: 1, journalSchema: 1, wireProtocol: 1},
  {updateProtocol: 1, journalSchema: 1, wireProtocol: 1, localEnrollment: 1, configBytes: 524288},
 ]) {
  const result = await validate(capabilities);
  assert.equal(result.status, 0, result.stderr);
 }
});

test('additive capabilities cannot mask incompatible retained protocols', async () => {
 for (const field of ['updateProtocol', 'journalSchema', 'wireProtocol']) {
  const result = await validate({...original.moremote, [field]: 2});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /rollback-compatible storage\/wire protocol/);
 }
});

test('release rejects a missing retained compatibility field', async () => {
 const {wireProtocol: _wire, ...capabilities} = original.moremote;
 const result = await validate(capabilities);
 assert.notEqual(result.status, 0);
 assert.match(result.stderr, /rollback-compatible storage\/wire protocol/);
});
