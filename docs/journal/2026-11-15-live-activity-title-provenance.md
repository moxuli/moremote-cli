# Live Activity title provenance — local, unreleased

## Root cause and correction

The notification path already resolves App-authorized workspace names, while the
companion activity path projected the raw provider agent title. Blindly replacing
that encrypted title with App catalog text would let stale cached names replace
fresh remote renames. Inferring workspace authority from a partial recent agent
page would also regress imported or shared-root conversations.

Encrypted activity interests may now carry at most32 exact source hints whose
complete UTF-8 JSON array is at most4000bytes. They contain only agent/workspace
IDs and conversation/workspace provenance. Matching workspace hints authorize
fresh official workspace metadata; conversation/mismatched/missing hints retain
fresh agent text. Visible independent roots can disprove workspace authority,
never manufacture it. Managed children do not become roots.

An active activity owns a bounded100-workspace read subscription. Missing targets
acquire at most32 exact reads with exact-ID response checks and a132-row shared
cache. Owned-subscription hosts use separate target owners. Legacy hosts use
non-subscribing seeds, preserving their connection-wide broad subscription slot.
Stop releases owners and fences late read results. No Worker poll is added.

Unknown metadata delays activity publication independently of attention delivery.
Read errors and page omissions retain confirmed names; a full official entry
without a title normalizes to null, while a removed record stays unknown. Shared
rows compare generation/sequence across observers; retired generations and
released ownership cannot restore older names. Unversioned owned exact reads
conservatively outrank broad reads, and legacy seeds cannot overwrite newer
stream observations. Page membership skips a targeted read only while known
metadata remains cached. Original unacknowledged publications retain exact bytes.

## Rolling compatibility

The legacy enrollment descriptor is exact-field validated by older App versions;
the legacy discovery directory also rejects unknown resources. Neither changes.
Capability support is published separately at
`<home>/.moremote-cli-activity/<sha256(UTF8 daemonServerId)>/capabilities.json`.
The exact version1 document contains daemon/instance identity, descriptor lease
clocks and `titleHints:1`, with no title text or keys. Its independent marked
private tree follows existing enrollment lock ownership and matching-instance
cleanup. Old-runtime rollback ignores that directory; old capability files fail
fresh descriptor instance/expiry checks. Config and cloud HTTP shapes are unchanged.

## Verification and review

New capability/strict-interest tests first failed with missing files/rejected
hints. The initial owner test then failed without workspace observation. Later
regressions reproduced raw-title publication before metadata readiness, loss of
confirmed names during recovery, legacy seed races, cross-owner sequence rollback,
unversioned observer precedence, missing-title confusion and cache-eviction stalls.
Each behavioral correction was preceded by its failing regression.

The initial complete default-concurrency run reported258tests,256passes and2
runtime-deadline failures (`REPAIRED_RUNTIME_COULD_NOT_ACQUIRE` and
`RECEIPT_OR_STATE_BLOCKED_COMMANDS`). Deadlines and production timeouts were not
weakened. Intermediate complete concurrency4 runs passed265/265and267/267.
After the final cache-membership fix, the frozen complete check passes types,
267tests with zero failures/skips, and compilation. Final focused regressions
pass24/24. The accepted command is the complete check sequence with explicit
test concurrency4:

```sh
npm run typecheck
node --import tsx --test --test-concurrency=4 tests/*.test.ts
npm run build
```

Both legacy and owned real-SDK wire fixtures cover workspace bootstrap arriving
after agents, current rename, exact target metadata, non-subscribing legacy wire
behavior and late response after release. The independent notification consumer
proves unknown title metadata does not block its attention outbox. Existing
immutable activity retry and real runtime acquisition/receipt tests remain green.

Independent-context review found the cross-subscription ordering blocker, which
now has an explicit RED/GREEN regression. Parent review additionally identified
unknown metadata, full-entry title semantics and cache membership edges; those
are covered. External-provider attempts yielded no usable review because of
account/transport availability; no cross-vendor approval is claimed. Actual final
logs and clearly labeled early output excerpts are in this run's local CLI
acceptance bundle. Source remained uncommitted at handoff.

## Boundary

Only CLI code/tests/contracts changed. There was no package/tag publication,
deployment, service installation, dependency upgrade or real provider-session
mutation. Native/Cloud changes and physical APNs display remain independently
owned acceptance scopes.
