import type { Config, Pair } from './config.js';
import type { OperationJournal } from './journal.js';

const firstAffected = Date.UTC(2026, 10, 27, 0, 10);
const lastAffected = Date.UTC(2026, 10, 27, 0, 16);
const managedOrigins = new Set(['https://api.moremote.moxuli.com', 'https://moremote-cloud-ingress.pages.dev']);

/** Reconcile markers from the November 27 catalog rollout once at startup. */
export async function recoverCatalogRetirements(
  config: Config, journal: Pick<OperationJournal, 'pairRevoked'>, daemonServerId: string,
  readPair: (origin: string, pair: Pair) => Promise<Record<string, unknown>>,
): Promise<boolean> {
  let changed = false;
  for (const pair of config.pairs) {
    const retiredAt = pair.relayRetiredAt;
    const origin = pair.apiOrigin ?? config.apiOrigin;
    if (pair.active || retiredAt === undefined || retiredAt < firstAffected || retiredAt >= lastAffected
      || pair.revokedAt !== undefined || journal.pairRevoked(pair.pairId)
      || pair.daemonServerId !== daemonServerId || !origin || !managedOrigins.has(origin)) continue;
    if (pair.automaticClientId && config.pairs.some(other => other !== pair
      && other.automaticClientId === pair.automaticClientId && other.daemonServerId === daemonServerId
      && (other.active || (other.expiresAt ?? 0) >= (pair.expiresAt ?? 0)))) continue;
    const response = await readPair(origin, pair).catch(() => undefined);
    const status = response?.pair as { pairId?: unknown; state?: unknown } | undefined;
    if (status?.pairId !== pair.pairId || status.state !== 'active') continue;
    delete pair.relayRetiredAt;
    pair.active = true;
    changed = true;
  }
  return changed;
}
