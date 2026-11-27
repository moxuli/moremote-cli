import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { Config, Pair } from '../src/config.ts';
import { recoverCatalogRetirements } from '../src/retired-pair-recovery.ts';

const incident = Date.UTC(2026, 10, 27, 0, 12);
const origin = 'https://api.moremote.moxuli.com';
const retiredPair = (overrides: Partial<Pair> = {}): Pair => ({
  pairId: randomUUID(), rootKey: 'synthetic', hostToken: 'synthetic', daemonServerId: 'host',
  active: false, relayRetiredAt: incident, expiresAt: incident - 3600000, ...overrides,
});
const configFor = (pairs: Pair[]): Config => ({
  version: 1, clientId: 'moremote-cli-synthetic', paseoHome: 'synthetic',
  apiOrigin: origin, allowLoopbackHttp: false, cloudEnabled: true, pairs,
});

test('recovers only the exact still-active pair after transient catalog retirement', async () => {
  const eligible = retiredPair(), rejected = retiredPair(), mismatched = retiredPair(), unavailable = retiredPair();
  const config = configFor([eligible, rejected, mismatched, unavailable]);
  const changed = await recoverCatalogRetirements(config, { pairRevoked: () => false }, 'host', async (receiver, pair) => {
    assert.equal(receiver, origin);
    if (pair === unavailable) throw Error('temporary outage');
    return { pair: {
      pairId: pair === mismatched ? eligible.pairId : pair.pairId,
      state: pair === rejected ? 'revoked' : 'active',
    } };
  });
  assert.equal(changed, true);
  assert.equal(eligible.active, true);
  assert.equal(eligible.relayRetiredAt, undefined);
  for (const pair of [rejected, mismatched, unavailable]) {
    assert.equal(pair.active, false);
    assert.equal(pair.relayRetiredAt, incident);
  }
});

test('does not look up explicit revocations, superseded or unrelated pairings', async () => {
  const clientId = randomUUID();
  const journalRevoked = retiredPair();
  const pairs = [
    journalRevoked,
    retiredPair({ revokedAt: incident }),
    retiredPair({ relayRetiredAt: incident - 3600000 }),
    retiredPair({ apiOrigin: 'https://other.example' }),
    retiredPair({ daemonServerId: 'other-host' }),
    retiredPair({ automaticClientId: clientId }),
    retiredPair({ automaticClientId: clientId, active: true, relayRetiredAt: undefined, expiresAt: incident }),
  ];
  let requests = 0;
  const changed = await recoverCatalogRetirements(configFor(pairs),
    { pairRevoked: id => id === journalRevoked.pairId }, 'host', async () => {
      requests++;
      return {};
    });
  assert.equal(changed, false);
  assert.equal(requests, 0);
});
