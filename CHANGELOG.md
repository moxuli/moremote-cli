# Changelog

## 0.1.3 — 2026-11-13

- Refuse duplicate `run` before any config rewrite; initialize fresh runtime config only after ownership. Keep setup's load/authenticate/save under the same cross-process ownership after package preparation, so a concurrent run cannot lose newer endpoint state. Unify config readers/writers at524288bytes and reject oversize serialized writes without replacing state.
- Make `setup` reachable through a new capability-aware frontend when retained public0.1.2 lacks it; explicitly select verified exact-current enrollment-capable owned runtime/bootstrap while preserving pairs/custom origin/update opt-out. Unavailable current packages fail without reporting enabled.
- Bound automatic enrollment to one optional cloud-create attempt per cycle with an independent3s abort deadline, retaining original durable retry bytes and existing phone control cadence.
- Add explicit `setup --yes` and private single-pairing discovery over the already authenticated official file channel; ordinary users no longer scan or paste a second enhancement offer. Preserve custom origins, existing pairs/revocation and managed-update opt-out.
- Persist bounded immutable request fingerprints, original per-phone offers and exact cloud-create bytes before I/O; resume identical requests across ownership-safe restarts, remove private responses on activation/expiry, and keep checks/status passive. Source-checkout setup binds its current owned frontend instead of downloading an older public runtime.
- Make explicit `pair` the cloud opt-in and default to the production endpoint only when no origin is configured; reuse existing official local discovery without changing custom targets, per-phone authority or service installation.
- Include genuine provider and creation time with last-user time in encrypted task snapshots and meaningful widget fingerprints; retain absent user recency rather than using assistant updates.

## 0.1.2 — 2026-11-12

- Add optional encrypted per-task activity interests/state and keyed meaningful-change widget reload fingerprints; existing official-only and scoped-command behavior remains independent.
- Bound activity work in an owned cancellation-aware lane without blocking commands/controls; renew acknowledged ongoing measurements before expiry, retain unknown immutable retries, and preserve terminal recovery under validated normal-only quota pauses.
- Document registration expiry/non-resurrection, exact pre-transport provider fences and pending native/live APNs acceptance. Publish0.1.2 through the approved existing tag workflow; production device delivery remains a separate gate.
- Preserve request-bound attention until that exact official request is resolved or retired; bind notice identity to its occurrence so reconnect/replacement cannot strand a still-pending question.
- Derive completion/error notice identity from the canonical official attention timestamp, not the raw broadcast clock. Bound hydration to one in-flight read plus one latest event per agent and fence stale replies without letting an older observation cancel a newer terminal event.
- Correct managed shutdown when native service removal closes IPC during graceful drain: wait for supervisor/runtime ownership retirement instead of reporting a spurious control-channel failure. Preserve strict unmanaged/malformed-response errors and never replay an uncertain stop.
- Extend real packaged-upgrade acceptance to verify failed-candidate startup rollback, retained bootstrap/previous versions, durable failure state and clean shutdown through the production updater/supervisor.
- Recognize canonical parent-path aliases for exact owned launchd/systemd registration files, including macOS `/tmp`→`/private/tmp`, without accepting leaf symlinks, distinct files or foreign registrations.
- Preserve BOM-free Windows ownership XML for retained public0.1.1 readers; supply Task Scheduler's required UTF-16LE BOM only in a private transient import copy, removed before runtime startup and on registration failure. Retain exact ownership and malformed-encoding rejection.
- Complete isolated native Linux systemd and Windows Task Scheduler activation, failed-start rollback, stop and uninstall acceptance using packaged QA bytes; this does not publish a new release or exercise production cloud delivery.
- Verify immutable public npm/GitHub artifact equality and actual public0.1.1→0.1.2 normal background discovery/download/activation, retained bootstrap/frontend and clean owned stop without a service, real official connection or cloud operation.

## 0.1.1 — 2026-11-10

- Fix real Windows named-pipe request/response delivery using bounded frames without prematurely half-closing the channel; retain authentication, absolute deadlines and owned cleanup.
- Preserve control during mixed-version activation/rollback using explicit owned runtime transport facts, not timeout-based operation replay.
- Reuse the preexisting selected-repository organization secret for tag releases, with publishing credentials confined to the publish step. First0.1.0 npm publication is independently installable; no new token or mandatory browser trust setup.

## 0.1.0 — 2026-11-10

- Completed the owner-approved identity cutover (2026-11-10): MoRemote CLI, repository/command `moremote-cli`, public npm `@moxuli/moremote`, entry `bin/moremote-cli.js`, `MOREMOTE_CLI_HOME`, platform state `MoRemoteCLI`/`moremote-cli`, and separately owned CLI service/runtime identities. No compatibility alias or automatic old-state adoption; protocol/crypto/app identities remain unchanged.
- Optional Node24 companion using pinned official Paseo client/protocol0.15.3 without modifying the official daemon or iOS vector floor.
- Local per-phone endpoint-root QR enrollment, one-use proof activation and standalone HKDF/AES-GCM contract/reference fixture.
- Bounded encrypted state/attention, scoped send/current question/approval operations, FULL-sync SQLite dispatch journal and truthful acceptance/resolution/unknown receipts without automatic mutation replay.
- Endpoint-authenticated control tombstones/immutable acknowledgements, exact request occurrence bindings, native question codec validation, original-offer activation expiry, monotonic receipt revisions, post-expiry/revoke minimal receipt audit and authoritative attention invalidation.
- Explicit portable foreground/lifecycle commands and independently owned per-user launchd/systemd/Windows logon-task adapters.
- Apache-2.0, standalone contributor/docs surface, test-first behavioral checks. Verification and external native/cloud/APNs/release gates remain recorded in docs/STATE.md.
- Retained upstream release LICENSE and immutable0.15.3 source provenance, independent bearer/envelope vectors, real SDK WebSocket send/permission/no-presence/lost-ack consumers and foreign-data lifecycle guards.
- Recheck execution/control authority and original enrollment deadlines after asynchronous authentication/preflight, with deterministic default-clock boundary regressions.
- Exercise both real SDK owned/legacy subscription negotiation paths; verify consumed daemon identity and attention independently of the legacy status-event wire filter.
- Independent-review repairs: latest-child retired-key cleanup, bounded safe tombstones, read-only stale projection, final occurrence race guards, retained resolution evidence and isolated receipt failures.
- Resource-level no-follow ownership, companion SQLite identity, authenticated socket provenance, immutable managed versions and truthful unknown service-manager state.
- Guard attention queue insertion against request retirement during cryptography, preventing stale notifications from appearing after authoritative invalidation.
- Carry explicit standalone03/04 historical first-upload rules for immutable minimal receipts within original child audit retention, without relaxing action expiry.
- Validate wire timeline evidence fixtures with pinned official schemas and canonical startSeq/endSeq ranges, preserving both negative and positive reconciliation assertions.
- Make wire-fixture failure cleanup independent of release RPCs: validate complete responses, echo release subscription IDs, cancel timers, and close every tracked SDK/socket/server/database through bounded teardown.
- Locally verified compiled CLI and native production Kit enrollment through actual Pages/Worker/SQLite, immutable command rejection, durable endpoint revocation and retained authenticated audit; production notification delivery remains separately gated.
- Keep subprocess privacy regressions focused on leaked private bytes and failure outcomes rather than incidental Node warning wording.
- Publish each measured encrypted snapshot once after an exact lost-ack retry; stop repeated active-pair reads and acknowledged receipt uploads without delaying ordinary command/control acquisition.
- Fence relay-retired pairs locally without forging an endpoint revoke receipt; end automatic recovery at original retained-child deadlines.
- Honor validated HTTP429/503 Retry-After deadlines for at most24hours per origin, without renewing operation authority or automatically replaying uncertain mutations.
- Fence the origin through the remainder of a paused runtime cycle even if the deadline expires during a slow SDK snapshot; reacquire controls before resuming publication/recovery/command work. Keep unrelated origins independent.
- Default-on private managed updates for installed packages: immutable exact scoped prefixes, retained service bootstrap, persisted bounded discovery, independent opt-out, storage/wire compatibility gate, cycle-safe IPC handoff, startup rollback and failed-candidate suppression.
- Add portable CI/real packaged-upgrade acceptance and tag-validated deterministic npm artifacts/provenance and public GitHub Releases. Reuse the owner's existing selected-repository organization publishing secret only in the publish step; no new token or web-only trusted-publisher setup is required.
- Compare canonical frontend entry paths to prevent recursive selected-CLI respawn through parent-directory aliases (including macOS `/tmp` → `/private/tmp`). Packaged-upgrade acceptance covers an explicit parent symlink/junction, bounded stages, owned-process teardown and preserved failure evidence.
- Release runtime control ownership and SQLite handles on journal initialization failure; propagate delegated termination and parent IPC loss through supervisor shutdown; allow stable upgrades from explicit prereleases; pin both default and scoped npm registries against inherited scope overrides.
- Await positive initialized-runtime IPC readiness instead of probing unpublished socket stages; make truncated/empty control responses explicit, preserving strict foreign-resource checks and requiring observed owner retirement before reporting absence.
