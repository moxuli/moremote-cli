# Changelog

## 0.1.0 — unreleased

- Completed the owner-approved identity cutover (2026-11-10): MoRemote CLI, repository/npm/command `moremote-cli`, entry `bin/moremote-cli.js`, `MOREMOTE_CLI_HOME`, platform state `MoRemoteCLI`/`moremote-cli`, and separately owned CLI service/runtime identities. No compatibility alias or automatic old-state adoption; protocol/crypto/app identities remain unchanged.
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
