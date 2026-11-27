# 0002. Event-driven delivery and open-only notifications

Status: accepted. Event-driven delivery shipped in 0.1.14. The terminal title
fallback shipped in 0.1.15.

## Context

The companion used to ask the relay for commands and controls while idle.
Empty reads consumed relay work without improving delivery. The phone already
has an authenticated Paseo path for normal conversation reads, messages and
approvals. The operating system still needs a push path when the app is in
the background.

## Decision

- Observe events through the existing local Paseo connection. Publish only
  meaningful attention and Live Activity changes, bounded retry work, and
  freshness renewals for an active Activity. Discover the phone-authorized
  registration when there is delivery work. Keep exact item reads and immutable
  receipts for previously attempted work.
- Notifications open the original conversation. Messages and approval decisions
  use Paseo inside the app. Keep legacy receipt handling and the current
  notification hydration path until a compatible rollout proves which clients
  still need them. Today pending question and permission alerts can wait briefly
  for hydration, so removing its writes also requires updating that dependency.
- For terminal activities, use an already verified title from the exact
  conversation when workspace title metadata is unavailable. Reuse the existing
  terminal read to fill a missing title. Preserve nonblank live titles and fence
  the result to the same turn and registration. Titles stay endpoint-encrypted.

## Alternatives and consequences

Slower empty polling would still cost work while idle and delay visible state.
Paseo-only delivery would not meet the background notification requirement.
On-demand registration lookup avoids both costs, with one bounded reread when
registration replacement races a publication. The compatible relay ships first
when a change needs a new relay capability. A temporary relay route mismatch
is not evidence that a pairing has been revoked or removed.

Verify event-driven and immutable-retry behavior with isolated peers. Check
package publication, managed-runtime activation, and physical push and ActivityKit
delivery independently. See [architecture](../specs/01-architecture.md) and the
[release runbook](../releasing.md).
