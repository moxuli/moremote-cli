# Native service acceptance — 2026-11-11

## Status and boundary

The current compiled source controller has exercised real macOS launchd installation,
start, status, stop and uninstall against the published0.1.1 managed runtime.
This is not a new npm release, a published-version upgrade, or Linux/Windows native
service-manager acceptance. Existing released0.1.1 bytes remain unchanged.

The acceptance used an unused per-user service label, an isolated HOME and a short,
owned state directory. Cloud was disabled, pairings were empty and the official
endpoint was an unreachable loopback address. No official daemon, real-work session,
model, enrollment or APNs request was used. Installation was refused unless the
service label and real-home registration file were initially absent.

## Discovered shutdown race

The real service initially installed and started successfully. Stopping it could
fail with `CONTROL_CONNECTION_CLOSED`: native bootout had already begun graceful
supervisor/runtime shutdown while the CLI independently requested control shutdown.
The socket could close before its ownership records had finished retiring.

The correction preserves strict generic control transport errors. Only a managed
shutdown can cross this specific closure window; it must still wait for supervisor
retirement and confirm that no runtime remains. An empty response alone is never
success, malformed responses still fail, and an uncertain stop is not replayed
against a replacement generation. The workflow now lives with supervisor lifecycle
ownership instead of being duplicated in CLI command wiring.

Independent review exposed a second boundary: a final status probe can return null
for a departed generation while a replacement owner remains alive. Its regression
also failed before correction. Shutdown now revalidates the current supervisor and
runtime lock/PID synchronously after the awaited probe, including lock-only startup.
The replacement must remain intact and shutdown must fail rather than authorizing
uninstall. The independent follow-up found no remaining blocker in this scope.
These checks are snapshots; they cannot prevent an independent start afterward.

## Exercised proof

- The new owned-socket/supervisor-retirement regression failed before the behavior
  correction. It checks that closure cannot complete shutdown before retirement.
- 22 focused behavioral checks passed across `managed-shutdown.test.ts`,
  `frontend-lifecycle.test.ts`, `control-response.test.ts` and `cli.test.ts`.
- `npm run typecheck` and `npm run build` passed.
- The corrected compiled source controller installed the real launchd registration,
  reached the published runtime's authenticated status endpoint, stopped it and
  removed the registration, plist and isolated state. Final launchd lookup returned
  the platform's explicit missing-service result; no test login service remained.
- Earlier fixture setup failures were not product acceptance: one used an invalid
  synthetic client identity; another exceeded the Unix-domain socket path limit.
  The final native run used valid configuration and a short isolated path.

## Remaining gates

1. A separately authorized, immutable next-version release including current source;
   the published0.1.1 package must not be represented as containing this correction.
2. Real published-version activation/rollback through an installed native service.
3. Equivalent native service-manager acceptance on Linux and Windows.

Do not install a test registration over an everyday service. A fake HOME isolates
registration files, not launchd's per-user label namespace. When that label is in
use, use a separately owned OS environment rather than stopping another instance.
