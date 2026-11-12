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

## Remaining gates at the preceding checkpoint

1. A separately authorized, immutable next-version release including current source;
   the published0.1.1 package must not be represented as containing this correction.
2. Real published-version activation/rollback through an installed native service.
3. Equivalent native service-manager acceptance on Linux and Windows.

Do not install a test registration over an everyday service. A fake HOME isolates
registration files, not launchd's per-user label namespace. When that label is in
use, use a separately owned OS environment rather than stopping another instance.

## Installed upgrade and rollback continuation — 2026-11-12

- A fresh anonymous npm download of immutable0.1.1 matches registry SHA512 and
  published SHA256`358574ca750d27c8a116743cd729d7ab830c41fc17045ddfa46ff808ff3bba3b`.
  The retained native service starts those actual published bootstrap bytes.
- The actual launchd namespace and real-home registration file are required to
  be absent before installation. The service uses an owned temporary HOME/state,
  no pairs, cloud disabled and an unreachable loopback official endpoint.
- Initial startup did not reach readiness because the fixture omitted the required
  client-identity prefix. A private direct bootstrap diagnostic reports
  `INVALID_CONFIG`; this is not a product startup defect.
- Failed-run cleanup exposed a real ownership defect: launchd canonicalizes
  `/tmp` to `/private/tmp`, while the controller compared raw strings and rejected
  its own registration. The exact first service was safely removed through the
  normal controller using its independently established canonical definition.
- The product correction accepts a parent-path alias only when both leaves are
  ordinary non-symlink files, device/inode match and real paths match. Exact
  unchanged paths retain their fast path. Leaf symlinks, different files and
  foreign registration/marker protections remain rejected. The same rule applies
  to systemd's file path; Windows task matching is unchanged.
- All10focused service-lifecycle consumers, typecheck and build pass. Independent
  OpenCode review reports no blocker. Distinct hard links/bind mounts remain a
  conservative refusal; no general authority over user-writable services is added.
- The corrected real launchd run passes in181.29seconds: published0.1.1 bootstrap
  → current synthetic9000.0.2 candidate → failed compatible9000.0.3 startup →
  recovered9000.0.2. Authenticated status and durable selection agree; bootstrap/
  previous remain0.1.1. Normal stop/uninstall leaves no registration, plist or
  owned successful-run files.

This accepts macOS native activation/rollback with real installed package bytes
and a deliberately failing unpublished fixture. It is not a new immutable public
release, public-to-public next-version delivery, Linux/Windows native acceptance,
cloud activation or any real-work-session operation.
