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

## Linux user-service and Windows encoding continuation — 2026-11-12

Actual Linux acceptance uses the existing Ubuntu26.04 user manager, systemd259
and pinned Node24.13.0. The real unit reaches active/running/enabled and the
authenticated control reports the installed version. QA0.1.1 activates synthetic
9000.0.2, then rejects compatible9000.0.3 before readiness and recovers9000.0.2
with unchanged bootstrap/previous0.1.1. Normal stop/uninstall leaves
LoadState=not-found, an empty FragmentPath, absent definition/control and no live
supervisor/runtime. This is actual user-systemd, not every Linux distribution.

The preceding Windows QA implementation identified missing BOM in a UTF-16LE
task import file. Native COM syntax-only validation of a decoded string did not
test the file bytes consumed by schtasks. That QA writer emitted FF FE; its
current reader was corrected to consume one leading U+FEFF while retaining
ownership/XML checks. This was current/current QA evidence, not retained-version
compatibility; the later correction below supersedes the persistent-BOM design.

That18consumer run covered writer/current-reader consumption, legacy unmarked
UTF-16 ownership inspection, repeated-BOM, wrong-encoding and foreign-marker
rejection. Typecheck and build also passed.

The final unwrapped native Windows Task Scheduler run passes in168.23seconds.
It installs/starts QA0.1.1, authenticates status, activates synthetic9000.0.2,
rejects9000.0.3 before readiness and recovers9000.0.2, then normally stops and
uninstalls. Independent task/definition/control checks are absent and no live
supervisor/runtime remains. The exercised QA archive SHA256 is
`8b5c55ac04edfaf5c93eb7b1708ad07be9eec5b0d288b04ec0b5dbbd81b4df82`.

No console-token impersonation, account/policy change, real daemon/cloud
operation or public release is used. A private fixture's elevated-owner ACL
mismatch was recorded separately rather than misrepresented as a product login
requirement. Failed and diagnostic task registrations were normally removed.
An independent provider review could not run because its read tools were
refused; no review approval is claimed.


## Retained public reader correction — 2026-11-12

Fresh-context specification review found that unchanged public0.1.1 starts its
resource reader before runtime readiness and cannot consume persistent BOM-prefixed
ownership XML. A matching compatibility tuple and synthetic current/current
native pass did not establish retained-reader compatibility.

Persistent `moremote-cli-task.xml` is now BOM-free UTF-16LE. Native `/Create`
receives a separate BOM-prefixed XML file in an owned private temporary directory
outside shared state. `finally` removes that copy before `/Run`; registration or
cleanup failure cannot start the runtime. No schema bump or migration is needed.

Two new deterministic regressions first fail, then the20focused lifecycle/resource
consumers, typecheck and build pass. The frozen public reader is unmodified,
SHA256`1ee80f6bdab819e15da817038cecf46133b07d1a157663893a64112a2fdca13b`;
an independent anonymous npm download confirms those module bytes. Fresh-context
Stage A and Stage B re-review close the blocker, explicitly using the weaker
same-provider fallback after the unavailable cross-provider attempt.

The actual Windows journey starts unchanged npm0.1.1 bootstrap bytes, activates
the current synthetic9000.0.2, fails9000.0.3 before readiness, recovers9000.0.2
and normally stops/uninstalls. The native interval is183.86seconds; the enclosing
fleet job takes202.70seconds. Independent final observations show no task,
definition, control endpoint or live supervisor/runtime; successful-run runtime
files are removed. The intentionally unused loopback official target yields
degraded connection status while authenticated runtime/version checks succeed.

Public0.1.1 archive SHA256 is
`358574ca750d27c8a116743cd729d7ab830c41fc17045ddfa46ff808ff3bba3b`;
unpublished exercised candidate SHA256 is
`6dca555348e87dd395aa0564d97aa1499581fbeadc98b78dbb1c9c3c179ff861`.
No real daemon/cloud/model operation, account/security-policy change, npm
publication or everyday installed service occurs. Synthetic candidates are
still not a new immutable public release or public-to-public delivery.

