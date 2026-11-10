# Managed updates and public release

Owner-authorized T2 iteration. Public npm identity is `@moxuli/moremote`; repository/executable/service/state identities remain `moremote-cli`.

## Decision and acceptance

Use immutable private npm prefixes and a retained bootstrap supervisor, not global npm self-replacement. An explicitly installed service points at the retained bootstrap's service entry forever; a supervisor launches the selected runtime with authenticated-by-parent IPC. Global scoped npm installations enter this managed mode on run; source checkouts remain manual unless explicitly adopted with update/service-install. Default enabled managed checks run at most once per six hours, with one exclusive writer and no immediate retry. Exact stable versions only for automatic discovery, exact semver for explicit updates. Never update official Paseo, Node or global tooling. Read-only/foreign state fails visibly.


Owner refinement: automatic releases must declare unchanged updateProtocol/journalSchema/wireProtocol compatibility; mismatches stay pending/manual without executing. Discovery persists both lastCheck and nextCheck, honors bounded Retry-After, and suppresses a failed candidate across restart. Independent durable opt-out wins even during staging/activation. Installed mode requires actual resolved scoped npm layout, exact manifest and current-user resource ownership. All queued activation waits while disabled, including explicit manual candidates.
Activation queues a verified candidate. The supervisor requests a drain, never force-kills for an update; runtime finishes its entire current journalled cycle, closes connections/journal/control ownership, then exits. Only after exit does the supervisor launch the candidate. Readiness requires runtime ownership and a durable journal, followed by a ten-second startup window. Failure rolls back to the retained previous version and blocks that candidate from automatic retry. An interrupted activation rolls back at the next supervisor startup. Old prefixes are never garbage-collected automatically. Explicit stop exits the supervisor, not a respawn loop.

## Implementation map

- `src/update-state.ts`: marked private JSON state, durable atomic replacement, exclusive process-aware writer/supervisor locks; no package configuration writes.
- `src/updater.ts`: managed setup, bounded registry discovery, package install and queued activation, opt-out/status.
- `src/supervisor.ts`, `bin/moremote-service.js`: stable per-user bootstrap and cooperative runtime handoff/rollback.
- `src/service.ts`: scoped identity verification, immutable installs and bounded npm subprocesses, retain platform ownership adapters.
- `src/runtime.ts`: parent-only IPC drain at cycle boundary and readiness, preserve mutation/journal semantics.
- `src/cli.ts`: managed run/service/update/status/opt-out integration and installed-version reporting.
- `tests/updater.test.ts`: real state/install/handoff processes with synthetic packages, failure/concurrency/opt-out boundaries.
- `.github/workflows/{ci,release}.yml`, `scripts/release.mjs`: frozen Node24.13.0, exact identity/tag validation, deterministic tarball and a least-privilege publishing step using the already-provisioned organization secret.

## Verification entrypoints (integration owner only)

`npm run check`; `node --import tsx --test tests/updater.test.ts tests/service-lifecycle.test.ts`; `node scripts/release.mjs validate v0.1.0`; isolated real npm tarball installation/upgrade as documented in release guidance. No service, global npm, registry publish, GitHub write or real host/device mutation in worker verification.
