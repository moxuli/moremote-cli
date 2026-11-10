# First notification and scoped-delivery implementation

**Goal:** a usable optional computer enhancement layer over an unmodified
Paseo0.15.3 interface, with transparent lifecycle and encrypted short-lived actions.
**Architecture:** Node24/TypeScript, official SDK adapter, standard endpoint
crypto, persistent operation journal and separately authenticated cloud client.
**Global constraints:** Apache-2.0; no private workspace/runtime dependency; no
production session mutation, public publication, automatic installation/update,
official file edits, fake presence/read/Expo registration, blind mutation replay,
plaintext endpoint secrets in logs or false execution acknowledgements.

## File responsibilities and interfaces

- `src/cli.ts`: portable actual command parser and user-facing entry points.
- `src/config.ts`: bounded validated private per-user configuration and explicit
  API/official-target settings, no hardcoded developer path/account.
- `src/crypto.ts`: standard AES-GCM/HKDF envelope implementation and exact public
  conformance vectors; no cloud-encryption-key upload.
- `src/cloud-client.ts`: exact versioned HTTP API, immutable retries and pairing.
- `src/official-client.ts`: narrow real SDK authentication/subscription/snapshot/
  send/permission boundary; no SDK queued replay after ambiguous mutation.
- `src/journal.ts`: durable operation identity, dispatch/restart and receipt truth.
- `src/operations.ts`: typed payload/current-request validation and one-dispatch
  execution; unknown outcome is not automatic retry permission.
- `src/runtime.ts`: bounded observation/attention/state and paired command loop.
- `src/service.ts`: independently owned per-user service check/install/stop/remove
  adapters and explicit update execution; preserve official resources.
- `tests/`: consumer-visible crypto, ownership, timing, persistence, protocol and
  actual CLI tests. No tests of copied text, incidental defaults or mock echoes.

## Contract

Carry a standalone reviewed copy of the relay v1 contract in `docs/specs/`.
App/companion/cloud are independently distributed; no sibling imports, symlinks
or private shared packages. Match the published contract bytes, operation IDs,
expiry/revocation and receipt states exactly. Host credentials stay local.

Core interfaces are `sealEnvelope(rootKey,metadata,payload)` /
`openEnvelope(rootKey,envelope,now)`, `CloudClient`, an `OfficialClient` adapter,
and an `OperationJournal` that persists irrevocable dispatch before official I/O.
Exact signatures belong with their implementation and consumer tests; modules
must not bypass that journal for retry convenience.

## Steps and verification

1. Write contract tests first for vectors, wrong-key/metadata rejection,
   enrollment binding, expiry, same-ID conflicting bytes, crash recovery and
   current permission authority. Have the integration owner run the initial RED
   selection before implementing; do not run builds/tests concurrently in workers.
2. Implement cohesive modules against real SDK declarations and official docs.
   Preserve original Unicode content and request/action IDs. Reconnect observes
   fresh state without clearing attention or replaying uncertain writes.
3. Add complete check/configure/pair/run/status/cloud-disable/update/stop/uninstall
   commands. Install/update actions are explicit, fail honestly and change only
   companion-owned resources. Foreground runtime remains a first-class route.
4. Add README, docs index/STATE/specs/ADRs/conventions, CONTRIBUTING/PR guidance,
   Apache license/upstream notices and an independent local check entry. Remote
   issue/CI surfaces may remain a recorded substrate gap until a repository exists.
5. Freeze source. Run focused checks and fresh-terminal help/check plus the local
   cloud/companion journey, and read-only isolated official status/subscription.
   Do not contact real work sessions or claim other-OS/service-install acceptance.
6. Independent spec review, then quality/security review; close and re-review
   findings. Record evidence/limits, update current docs and commit locally.

## Acceptance boundaries

All implemented commands must be real, not stubs or silent success fallbacks.
Cloud deployment, Apple push configuration, physical push delivery, public package
publication and installation into the everyday host are external gates, not
prerequisites to pretend local tests passed. Remaining native system integrations
are separate app delivery units, not unfinished companion implementations.

## Verification journal — 2026-11-10

- Integration-owner combined check:900second timeout; both real SDK-wire modes
  failed after approximately13seconds each, and fixture resource leaks prevented
  clean exit/stack reporting. Build was not reached.
- Repair: official startSeq/endSeq timeline framing and full response schema
  validation; required release subscriptionId; independently owned, cancellable,
  bounded teardown of SDKs/sockets/server/journals/timers. No behavioral assertion
  was removed and production contracts were unchanged.
- Integration-owner focused command
  `node --import tsx --test tests/official-wire.test.ts`:2/2 passed in26.7seconds,
  without a hang. This covers both legacy and owned subscription modes only.
- Typecheck and all other behavior selections have passing results after removing
  an incidental exact-stderr assertion that rejected Node's SQLite warning. The
  privacy invariant still rejects leaked synthetic child paths; its focused
  regression passed1/1. Build and actual compiled help/version succeeded.
- Actual native Kit/CryptoKit→Pages→Worker→SQLite enrollment verified the exact
  isolated official0.15.3 daemon identity. Foreground runtime, immutable command
  retry/rejection, endpoint-authenticated revocation and post-revoke bounded
  outcome audit passed without real agent creation or session mutation.
- Scoped independent reviews are closed. Local implementation/acceptance is
  complete; service installation, public publication and production/Apple/device
  activation remain separate operator gates. Exact run chronology is in STATE.

## Subsequent owner-approved CLI identity cutover — 2026-11-10

Canonical product: **MoRemote CLI**; repository/npm/command: `moremote-cli`;
entry: `bin/moremote-cli.js`; state override: `MOREMOTE_CLI_HOME`.
macOS/Windows state is `MoRemoteCLI`; Linux state is `moremote-cli`. Services
are `com.moremote.cli`, `moremote-cli.service` and Windows logon task `MoRemoteCLI`.
CLI-owned runtime/client/managed-package identities move together. There is no
released package or installed service to migrate; use no compatibility alias or
automatic old-state adoption. Preserve foreign-resource protections, protocol
role `companionHello`, crypto salt/schema, APNs categories and app/Keychain IDs.

The implementation and root move are complete. Fresh source, compiled-command,
isolated-state and package checks pass; independent identity/quality review
findings are closed. STATE records exact full-suite and later focused-delta
evidence separately. Earlier verification used `moremote-companion`; keep its
historical transcript and this plan filename stable.

Proceeding toward cloud/Apple activation is also owner-approved, with exact
resource/key/permission/billing mutations requiring point-of-risk interactive
confirmation. No deployment, Apple activation, physical delivery, public
publication or everyday-host service installation is claimed by this update.

