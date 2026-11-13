# Current state — 2026-11-13

## 0.1.4 release candidate — owner-authorized, not yet published

- Pending questions/approvals now use a stable current-occurrence clock, not an
  older task-completion clock. Actual SDK delayed-current/snapshot regressions
  first reproduce resolution/replacement resurrection, then the observation fence
  prevents journal, binding and notification renewal. Actual same-batch SDK reply
  consumers also reproduce caller-continuation resurrection before repair: adapter
  journal ownership removes duplicate synchronization, source fingerprints prevent
  old request text acquiring a replacement binding, and crypto rechecks currentness.
  Cached question/approval consumers fail before exact occurrence capture/drain
  binding, then notifications10/10 pass without old clocks consuming new IDs.
  Final unchanged-input full check passes251/251,typecheck and build. Independent
  Stage A closes both lifecycle blockers; final quality re-review and hosted
  three-platform verification remain pending before immutable publication.
- Quality review catches observed in-place mutation followed by valid rename;
  both real regressions fail before the pre-retry guard, then resource24/24 pass.
  Hosted40e1b73 passes Linux/macOS but Windows rejects test-injected replacement
  with a live handle. Tests now verify real refusal, complete original contents
  and identity, then actual post-close replacement and strict unsafe-file refusal;
  no production error guard or platform coverage is removed. Narrow review passes.

- Ordinary config rename is now distinguished from an unsafe resource: at most
  three reopen attempts, independent descriptor/path validation, retired handles
  discarded, strict no-follow/user/private-mode/link/byte/encoding checks retained.
  Same-inode content changes remain rejected. Real rename regressions reproduce
  the failure before repair, then22resource consumers and the original2runtime
  cases pass. Final unchanged-input full check passes235/235,typecheck and build.
  Stage A narrow review passes; independent quality/security review and fresh
  hosted three-platform verification remain in progress before publication.

- Exact tagv0.1.3 and its successful three-platform CI43380589650 are retained.
  Release43381419784 fails its full check before packaging/publication: concurrent
  normal runtime config replacement triggers FOREIGN_RESOURCE_LIMIT in a read.
  Publish and GitHub Release steps are skipped; no0.1.3 package is submitted.
  Preserve that immutable failed tag and prepare0.1.4 after a deterministic repair.

- First hosted run43378427840 correctly rejects three cross-environment fixture
  defects: inherited config/service paths, unsupported Windows POSIX-mode equality,
  and an unbound synthetic Paseo home whose local mismatch check had accidentally
  contacted the ordinary daemon read-only. Bind the exact fixture home and require
  its real handshake, no cloud calls, unchanged config and private-output absence.
- Stricter pending-endpoint controls return409 before activation. Runtime now
  activates only after official identity and original expiry/revocation checks;
  no command/state lane exists in that cycle, and the next cycle validates controls.
  Shared origin quota fences and fixed activation proof remain intact. Independent
  narrow review finds no blocker. Final unchanged-input full check passes221/221
  and build; hosted portability/packaged smoke are being rerun on this exact delta.

- Integrated51942a0 and reviewed the final enrollment/setup and packaging delta.
  Exact public0.1.2 archive bytes now live in the test fixtures with verified npm
  SHA1/SHA512 and matching recorded GitHub SHA256, independent of workstation caches.
- Final full check passes typecheck,221/221 tests and build. Three actual retained
  public0.1.2 migration consumers pass. Real packaged activation/failed-start
  rollback/retained frontend and clean shutdown pass; no everyday service is installed.
- Release validation accepts additive capability metadata while retaining the
  strict1/1/1 protocol tuple and exact source/package capability equality.
  Constructor-scoped fixture isolation removes inherited operator credentials;
  the smoke retries only read-only unproven-stage probes under its live owned supervisor.
- Independent Stage A and Stage B reviews find no remaining scoped blocker.
  Main integration, hosted checks, immutable npm/GitHub publication and independent
  registry receipt remain pending. The production cloud remains unchanged.

## Scope

Owner-approved notification/scoped delivery and local activity/widget integration; Apache-2.0. Standalone Node24 companion targeting inspected official SDK/protocol0.15.3. Existing iOS protocol-vector floor is independent and unchanged. OpenUI and broader system extensions remain outside this scope.

## Unreleased single-pairing enrollment — source0.1.3, locally accepted

- Official Paseo pairing is the only normal user pairing. Explicit
  `setup --yes` prepares the optional owned CLI service; a connected native
  client exchanges the existing per-phone offer through official authenticated
  file APIs. No second QR, pasted invitation, terminal command or new relay
  configuration is required in the app.
- Discovery is private and bounded; original request identity/expiry, canonical
  offer and cloud-create bytes are durable before network I/O. Activation and
  expiry remove the private handoff. Revocation, retained active phones, custom
  origin, daemon pinning and managed-update opt-out remain authoritative.
- Confirmed review findings are fixed: duplicate runtime startup never rewrites
  configuration; setup prepares packages before acquiring shared runtime
  ownership, then holds it across load/authenticate/save. A concurrent runtime
  either wins before config loading or is refused. Config readers/writers share
  the524288-byte encoded bound; old managed0.1.2 setup selects a verified
  enrollment-capable current package instead of silently enabling old code.
- Optional admission performs at most one cloud-create attempt per cycle with
  its own3-second deadline. Unknown results retain exact retry bytes. No cloud
  endpoint, recursive dispatch, polling budget or production deployment changes.
- Node24.13.0 typecheck passes. The final six-file selection passes37/38;
  its remaining source-setup assertion incorrectly demanded absence of an
  internal managed directory. That implementation-detail assertion is removed,
  while actual package-manager refusal and service-entry checks remain. The
  corrected consumer passes independently and the compiled build passes.
  Both new setup/runtime interleavings failed before the ownership correction.
- Actual unmodified official Paseo0.15.4 and the native transport exchange the
  canonical offer, verify the real native claim and unchanged activation proof,
  and remove exact private request/response files. One cloud-create body and
  zero official agents are observed. The cloud is a local in-process test
  double; this is not production, physical-device or APNs acceptance.
- Independent-context source re-review closes the scoped native/CLI findings.
  The weaker same-provider route is explicit; unavailable external native
  reviews are not approvals. Temporary probe code/state are removed, with
  redacted receipts retained outside the repository.
- Source0.1.3 remains unpublished. Public0.1.2, shared production and existing
  official data are unchanged. No npm tag, TestFlight upload or phone install
  is implied.

## Unreleased Share-first onboarding delta — locally verified

- Approved cross-repository plan: MoRemote
  `docs/plans/2026-11-13-share-first-onboarding.md`; CLI ownership is source,
  focused consumers and public docs only. No publication or deployment.
- Explicit `pair` opts in to cloud, uses the production endpoint only when no
  origin exists, and reuses existing official listen/credential discovery.
  Origin validation, daemon pinning, custom targets/origins and retained
  pair authority remain intact. Plain load/check/status remain passive.
- Task snapshots carry genuine provider and ISO-8601 creation time alongside
  last-user time, through existing bounded projection and authenticated state.
  Widget equality includes the new meaningful metadata. No assistant-update
  substitution for user recency.
- Added actual CLI enrollment consumers with a synthetic official WebSocket
  and isolated relay, passive diagnostics/custom authority/invalid-origin and
  daemon-pin cases; added real-SDK encrypted task metadata consumers.
- Node24.13.0 typecheck, 22 focused pair-onboarding/task-projection/activity/CLI
  consumers, and compiled build pass. The actual SDK/HTTP boundary exercises
  passive diagnostics, authenticated enrollment, custom authority and encrypted
  metadata without production enrollment or official-file changes.
- Independent read-only review `run-20261113030053-9f69faa3` approves the scoped
  implementation. The same-provider fallback is explicit; this is not physical
  acceptance or a new package release. Public0.1.2 and its cached receiver remain
  unchanged.

## Native service acceptance — 2026-11-12

- Actual Ubuntu26.04/Node24.13.0/systemd259 user-service acceptance passes:
  install/start, authenticated status, QA0.1.1 → synthetic9000.0.2 activation,
  failed9000.0.3 startup rollback, normal stop/uninstall and independent absence
  of the unit, definition and live runtime. No cloud or real official daemon I/O.
- Initial Windows QA exposed missing native-import BOM and current-reader BOM
  handling. Fresh-context specification review then found that persisting a BOM
  breaks unchanged public0.1.1 runtimes, despite the current/current QA success.
- The current installer keeps persistent ownership XML BOM-free. Only a private
  transient import outside shared state has a BOM; it is removed before `/Run`
  and on `/Create` failure. Retained0.1.1 consumers remain usable for bootstrap
  and rollback without a storage migration.
- Both new consumer regressions first failed. All20focused lifecycle/resource
  consumers, typecheck and build then pass. The frozen reader matches the
  independently downloaded public0.1.1 module bytes.
- The new actual Windows Task Scheduler journey passes in183.86seconds:
  unchanged registry0.1.1 bootstrap → current synthetic9000.0.2 → deliberately
  failed9000.0.3 → recovered9000.0.2, then normal stop/uninstall. Task,
  definition, control endpoint and live supervisor/runtime are independently absent.
- Fresh-context specification and quality re-review close the scoped blocker.
  This is the explicitly weaker same-provider fallback, not cross-vendor approval.
  Earlier168.23second QA acceptance and unavailable provider reviews remain
  historical evidence in [[2026-11-11-native-service-acceptance]].
- The candidate is unpublished QA bytes, not a public-to-public release. No real
  official host, paid provider, cloud operation or everyday login service is used.
- The shared production cloud remains persistently enabled under the owner's
  later decision; these isolated native tests neither use nor disable it. Older
  temporary-window shutdown receipts below are historical, not current policy.

## Released0.1.2 — 2026-11-12

- Package and lock root identities select0.1.2; no dependency or compatibility
  tuple changes. Owner-approved tagv0.1.2 targets739c76008ea583fa86bfb023dafaa17a3ea9adf4.
- The combined check passes typecheck and180/181 tests. Its remaining legacy-wire
  case incorrectly requires an extra read for an old event that may be coalesced.
  The test now drains the actual wire and retains the phone-visible no-new-notice
  and unchanged-ciphertext assertions without demanding that incidental RPC.
- Both actual SDK wire variants then pass2/2. Build, real packaged activation/
  failed-start rollback/aliased frontend/clean stop, release identity validation
  and deterministic0.1.2 packaging pass. These overlapping runs are not a new
  single green full-suite result.
- Hosted CI43227228037 passes full check/build, release validation and real
  packaged upgrade on Ubuntu24.04, macOS15 and Windows2025.
  Automatic Release43232455123 passes check/build, upgrade smoke, deterministic
  packaging, existing-secret npm publication/provenance and GitHub Release.
- Anonymous registry reads independently confirm version/latest0.1.2 after
  asynchronous processing; publication is never repeated. Downloaded GitHub
  bytes match SHA256SUMS and npm SHA1/SHA512 integrity. Archive SHA256:
  `845fd98470964303a6a86dc696e64c47ac1e7b1ce90b59cd730cdec56d64f9bb`.
- Actual public0.1.1 installation/retained supervisor discovers and downloads
  public0.1.2 through its unchanged normal background scheduler, not a custom
  fetcher, direct queue, altered package or fake clock. Exact authenticated
  status becomes0.1.2; bootstrap/previous remain0.1.1; retained frontend returns
  0.1.2; normal stop exits0 and all owned processes/files are removed, in80.12s.
  No login service, real official connection or cloud operation occurs.
  An initial fixture prepopulates an unowned state directory and is correctly
  rejected before any process starts; initialization is corrected outside the
  managed state, preserving strict ownership. Its exact failed fixture is removed.
- Production device reply/approval and remote activity/widget delivery still
  require their separate acceptance; the release does not claim those gates.
- Release: https://github.com/moxuli/moremote-cli/releases/tag/v0.1.2

## Released activity/widget integration — production acceptance open

- Published install identity is **`@moxuli/moremote`0.1.2**; command/runtime
  remains `moremote-cli`, with existing per-platform service identities.
  Activity/widget changes are included; physical production acceptance remains open.
- Implemented locally: authenticated encrypted per-task interests and activity
  state, an owned optional2s host lane with250ms exact fallback reads, meaningful
  keyed widget fingerprints on existing snapshot publication, and normal-only
  quota pauses that preserve eligible terminal recovery. Commands/controls do
  not await activity work; shutdown/drain joins it before SDK/journal close.
- Limits/expiry/error/dataflow truth lives in [[configuration]] and
  [[specs/03-api-contract#Opt-in task activities and widget reloads]].
  Interest expiry is at most8h (8 per pair); state at most600s, fresh acknowledged
  renewal around8min. Unknown admissions retain exact bytes. Widget registration
  expires24h with native renewal around12h. Missing tasks never imply finish.
- Integration-owner-reported evidence: CLI typecheck and57 tests across
  `tests/activity.test.ts`, `tests/cloud-retry.test.ts` and
  `tests/runtime-receipt.test.ts` passed. This is targeted local evidence, not
  a newly green full suite, released artifact, or physical/device acceptance.
- Next gates: independent integration review and owner verification of the final
  delta; authorized native Live Activity/widget rendering, stale/offline and
  token replacement/expiry acceptance; separately authorized live cloud/APNs
  delivery. APNs200 is provider admission, not delivery. Historical alert proof
  below does not cover either new surface.
- A later owner-approved bounded physical acceptance observed all four attention
  kinds through the actual official mock → companion → cloud → sandbox APNs path.
  Duplicate completion and premature request-resolution bugs were exposed and
  corrected locally; this is not real paid-model or production-service evidence.
- The request lifecycle and canonical terminal-identity corrections pass13focused
  consumers plus typecheck. A later reverse-order wire regression first failed
  both SDK variants, then both passed with typecheck after observation-order
  fencing. Independent same-provider review reports no blocker; the preferred
  cross-vendor provider was unavailable.
- Earlier bounded sandbox windows restored disabled service and production
  provider secrets. The later November12 owner decision now keeps the existing
  production service enabled; no temporary watchdog or sandbox swap is allowed.
  Genuine device reply/approval receipts and remote ActivityKit/WidgetKit
  acceptance remain open. No real-work session or new release is implied.
- Fresh local end-to-end action acceptance passes against the unchanged official
  development mock, production runtime, real Pages/Worker/SQLite and a compiled
  unchanged native Kit/CryptoKit slice. Exact send and bound plan denial each
  execute once and produce authenticated accepted/resolved receipts; initial and
  post-settlement identical retries cannot redispatch or change receipts. Both
  SQLite journals retain exactly two settled operations. This is not physical
  locked-notification UI or whole native-package acceptance. Earlier observer and
  incidental-prose harness failures were corrected without product exceptions.

## Native macOS service continuation — partial acceptance

The current compiled source controller passed real launchd install/start/status/
stop/uninstall against the published0.1.1 managed runtime in an unused, isolated
per-user registration. A concurrent graceful-drain control-closure failure was
reproduced and corrected with an authoritative ownership-retirement barrier.
22 focused shutdown/frontend/control/CLI regressions, typecheck and build pass.
The final registration, plist and owned state were removed; cloud stayed disabled
and no official connection or real-work session was used.

See [native service evidence](plans/2026-11-11-native-service-acceptance.md).
Independent review closed a reproduced replacement-owner race with fresh post-probe
supervisor/runtime liveness checks. The November12 continuation below additionally
accepts native macOS upgrade/rollback with a real published bootstrap and synthetic
candidates. The November12 native Linux/Windows gates also pass as recorded above;
a next immutable public release and public-to-public delivery remain open.
Published0.1.1 does not contain the later source corrections.

## Packaged rollback continuation — 2026-11-12

The local macOS packaged smoke now exercises production `queueUpdate` and the
retained supervisor with three real npm-installed synthetic package versions:
9000.0.1→9000.0.2 succeeds; compatible9000.0.3 exits before runtime readiness,
and the supervisor returns to9000.0.2. Authenticated status confirms the recovered
version. Bootstrap/previous remain9000.0.1, failed9000.0.3 is recorded, and
pending/activating are absent. The retained aliased frontend and final clean
shutdown also pass. Only disposable failed-candidate package bytes are altered.

`npm run build` passes. The first expanded smoke stops during fixture setup
because its new import accidentally omitted `managedEntry`; no supervisor starts.
After restoring that import, the exact smoke passes in133.54seconds, including
owned-process/file cleanup. This is not a newly green full unit suite or new
hosted-platform result. That smoke installs no native login service and changes no
official daemon, cloud, real session or public package. The separate installed
macOS journey is recorded below; Linux/Windows observations remain open.

## Installed macOS upgrade continuation — 2026-11-12

An actual launchd test exposes raw-path ownership rejection after macOS resolves
`/tmp` to `/private/tmp`. Canonical parent aliases now require ordinary leaves,
equal device/inode and equal real paths; leaf symlinks and foreign files remain
rejected. All10service-lifecycle consumers, typecheck and build pass; independent
OpenCode review finds no blocker. Distinct hard links/bind mounts remain refused.

The real installed-service journey passes in181.29seconds: verified public0.1.1
bootstrap, current9000.0.2 synthetic activation, failed9000.0.3 startup, recovery
to9000.0.2, then normal stop/uninstall with registration/plist/owned successful-run
files removed. An earlier fixture missed the required client-ID prefix; that
`INVALID_CONFIG` startup failure is not a product defect. First-run cleanup safely
used its independently established canonical definition before the product fix.
No real official connection or cloud operation occurred. Details and remaining
public-release/platform limits: [native service evidence](plans/2026-11-11-native-service-acceptance.md).


## Approved identity cutover — locally verified

The owner approved the complete rename to **MoRemote CLI** on 2026-11-10:
repository/command `moremote-cli`, current public npm `@moxuli/moremote`, entry `bin/moremote-cli.js`,
`MOREMOTE_CLI_HOME`, state `MoRemoteCLI` on macOS/Windows and `moremote-cli`
on Linux, and services `com.moremote.cli` / `moremote-cli.service` / `MoRemoteCLI`.
Ownership/runtime/client/managed-package identities move together.
At the original rename checkpoint there was no released package or installed
service to migrate: no compatibility aliases or automatic adoption of old state.
The later0.1.0/0.1.1 publications are recorded below. Foreign-resource protections remain strict.
The `companionHello` role, crypto salt/envelope schema, APNs categories and
app/Keychain identities are unchanged.

The source/documentation cutover and root-directory move are complete. Parent
verified the renamed source, real compiled command, isolated local state and
package contents; independent source review accepted the identity contract.
Historical local acceptance below used the former `moremote-companion` identity;
its execution transcript remains historically accurate.

The owner also approved proceeding toward cloud/Apple activation. Exact
resource, key, permission and billing-sensitive mutations still require
point-of-risk interactive confirmation. No production or device acceptance is
claimed by this approval; publication and everyday-host service installation
remain separate gates.

## Managed updates and release — local acceptance complete

The owner authorized public scoped npm identity `@moxuli/moremote`, retained
private bootstrap/supervisor and cycle-safe automatic runtime activation.
Native service/state/executable identities remain unchanged.
See [decision](decisions/0001-managed-updates.md), [specification](specs/06-managed-updates.md),
[plan](plans/2026-11-10-managed-updates.md) and [publication prerequisites](releasing.md).

The parent exercised the real packaged upgrade9000.0.1→9000.0.2, retained
bootstrap/previous version, frontend through a parent symlink and clean owned
shutdown. No everyday service was installed. The first full126-case run had123
passes and three lifecycle-readiness failures; after correction, all21focused
control/initialization/frontend cases, types, build and packaged smoke passed.
Do not describe those separate runs as a newly green full suite.

Independent source review's four findings are closed: initialization cleanup,
termination/parent-death propagation, prerelease precedence and exact scoped
npm registry pinning. The final control-response/readiness delta also has no
actionable P1/P2 finding. Cross-provider review timed out without a report; the
completed independent-context review is not represented as cross-vendor approval.

Public GitHub repository `moxuli/moremote-cli` exists. The owner authorized the
first public0.1.0 release and reuse of an existing locally protected publishing
token; its npm identity is verified without disclosing the credential. No new
token or npm login is required. Existing organization secret `NPM_TOKEN` is
restricted to this selected CLI repository; the release publish step reuses it.
Workstation0.1.0 publication is independently visible through the anonymous npm
registry. Published tarball SHA256 is
`6bf3cab16245745f5f9d43026687cff880ca081f106f195d6abe40a169c5efd6`;
registry SHA1 matches and a fresh exact public install runs version/help/
configure/status with cloud off, no runtime/pairs and no installed service.
Initial asynchronous404 processing was observed; publication was not repeated.

Hosted CI42821005843 accepts Ubuntu24.04 and macOS15 check/build/package-upgrade;
Windows2025 reports8control-transport failures (112pass/10explicit POSIX skips).
The correction is patch0.1.1: generation-bound transport selection preserves the
published strict runtime shape; framed peers avoid Windows half-close, while
known legacy POSIX transport is selected before exactly one write, never replayed.
Historical0.1.0 Windows EOF control remains explicitly unavailable/unknown;
managed stop requires real supervisor/runtime retirement evidence.

Final types,35focused control/lifecycle/CLI consumers, build and actual published
0.1.0 retained-bootstrap→0.1.1 archive upgrade pass. The latter verifies active/
previous selection, both transport generations, selected frontend and clean
shutdown without a service/cloud/official-data mutation. Independent review
closes the mixed-transport finding with no remaining actionable P1/P2 issue.
Hosted CI42826719991 passes all three jobs: Ubuntu24.04, macOS15 and
Windows2025, including each platform's check/build, release identity validation
and real packaged upgrade. Source is `dad3d964b9ab144b646316a543e5d36151f8c210`.
Tagv0.1.1 targets that exact source. Automatic Release42827612987 completed
successfully using the existing organization secret: check/build, packaged
upgrade, deterministic artifact, signed GitHub provenance, npm submission and
GitHub Release all passed. No new token, login or trusted-publisher setup.

Independent anonymous npm catalog read confirms latest0.1.1; a fresh installation
by exact public package name runs0.1.1. The downloaded GitHub asset matches its
SHA256SUMS and npm's SHA1/SHA512 integrity. GitHub asset SHA256:
`358574ca750d27c8a116743cd729d7ab830c41fc17045ddfa46ff808ff3bba3b`.
The actual release asset separately runs configure/status with cloud off and
no runtime/service. Both submissions initially reported asynchronous processing;
the same immutable version was never republished.

Release: https://github.com/moxuli/moremote-cli/releases/tag/v0.1.1
Environment `npm-release` has a `v*` tag-only deployment policy; no new secret
was created.

## Locally accepted implementation

Real CLI configure/check/pair/run/status/service-install/unpair/cloud-disable/update/stop/uninstall; per-user ownership adapters; one-phone deadline-bounded proof activation; WebCrypto HKDF/AES-GCM; standalone02/03/04 contracts and independent envelope/bearer vectors; actual official SDK narrow observation/send/question/approval adapter; SQLite FULL-sync dispatch/control/occurrence/attention journal; bounded encrypted state. Independent-review corrections include endpoint-authenticated cancel/revoke, immutable acknowledgements, source/generation request bindings, exact question mapping, monotonic receipts, separate24h minimal audit retention and attention invalidation. No builds, tests, formatters, actual user services or real host session mutations have been run by this worker; dependency installation used --ignore-scripts.

The retention wording has independent static Stage A approval. Final operation and lifecycle re-reviews report no remaining findings in their scoped corrections. Executed acceptance is recorded below; it does not replace production or cross-platform service gates.

The final targeted lifecycle re-review also found no remaining findings among its original six defects and two staged-socket/XML ownership residuals. This covers the inspected source corrections and regression source, not broad security approval or executed platform/service acceptance.

## Verification journal — 2026-11-10

Evidence below was reported by the integration owner; implementation workers did not run checks.

- Initial combined check attempt timed out after900seconds. Both SDK-wire modes had failed after approximately13seconds each; leaked fixture resources prevented clean process exit and assertion-stack reporting. Build was not reached.
- Corrected synthetic timeline ranges from start/end to the pinned protocol's startSeq/endSeq, validated complete synthetic responses with official schemas, and supplied the required subscriptionId in release responses. All behavioral assertions remain.
- Fixture teardown now owns every SDK, socket, server, journal and timer; it closes the wire before SDK disposal, bounds cleanup waits, propagates fixture errors and runs on failure/timeout. It does not wait indefinitely for a release RPC.
- Focused owner run: `node --import tsx --test tests/official-wire.test.ts` passed2/2 (legacy and owned subscriptions) in26.7seconds, with no hang.
- Remaining selection: typecheck passed; the runner reported66passing entries and one failure caused only by a strict stderr wording assertion encountering Node's legitimate SQLite experimental warning. The incidental exact-output assertion was removed, preserving exit-failure and no-private-child-output invariants; its focused regression then passed1/1. Warnings were not suppressed. The already-passed two wire consumers were excluded from that remaining selection; one empty wire-file runner entry is not an extra behavior test.
- Build then passed. Actual compiled bin help and version commands both succeeded; version is0.1.0. No single combined full-suite green run is claimed.
- Actual three-party journey passed: compiled CLI configured and authenticated read-only to an isolated official0.15.3 daemon; native production Kit/CryptoKit enrolled through actual Pages→Worker→SQLite and verified the exact daemon activation proof.
- Actual foreground runtime status was cloud-enabled with one active synthetic pair, no runtime error and no installed service. A native immutable command retry to a nonexistent synthetic target received an authenticated rejection, not execution; encrypted revoke obtained the companion's durable authenticated acknowledgement, followed by narrow post-revoke outcome audit.
- Public-source privacy check found no private owner/account/team/production identifiers. No official agent was created, no model invoked, no real session mutated, and no public release or cloud deployment occurred.
- Renamed-tree combined `npm run check` passed typecheck,100/100 behavioral tests
  and build. Actual compiled help/version/configure/check/status all exited0 in
  temporary `MOREMOTE_CLI_HOME`, cloud off and no runtime/service/official
  connection. Package dry-run contains54files, the canonical bin and no obsolete
  runtime identity in packaged bin/dist; no package was published.
- Cost corrections stop active-pair GET/acknowledged state/receipt amplification
  and bound relay-retired recovery. HTTP quota/operator pauses preserve fixed
  deadlines, original immutable bytes and independent origin cadence.
- Initial Retry-After selection failed11/24 before correction. Its focused29case
  selection passed. A later independent P1 review exposed pause expiry inside a
  slow official snapshot; the real-runtime regression failed with PUT preceding
  the required GET controls. The cycle-fence correction then passed31/31 focused
  cases plus typecheck/build. This delta is not a newly run combined full suite.
- Independent P1 re-review closed with no new blockers. Multi-origin/multiple-pair
  actual runtime behavior remains unexercised beyond the scoped client/fixture
  checks; source review is not cross-platform or production acceptance.


## Reproduction commands

1. npm ci --ignore-scripts
2. npm run check
3. node bin/moremote-cli.js --help
4. node bin/moremote-cli.js --version
5. With a synthetic temporary MOREMOTE_CLI_HOME, run check, configure, status. Do not install services in ordinary CI.
6. Against an explicitly isolated official0.15.3 daemon: configure its exact target/home, check --connect, then run; inspect traffic for only narrow subscriptions/read RPCs and no heartbeat/read acknowledgement/push registration. Use synthetic conversations for explicit send and actual pending question/approval tests. Verify accepted admission separately from agent completion and simulate socket loss after dispatch without replay.
7. Run the independent cloud’s local SQLite-backed Worker, configure explicit loopback development at both ends, pair a synthetic endpoint using the public contract, submit an encrypted command and validate its exact encrypted receipt. No repository runtime imports are needed.

### Read-only isolated official smoke

Use an already-authorized isolated0.15.3 daemon, empty isolated user home and an unused selected port. Do not point this at everyday Paseo data. The companion commands are:

```sh
HOME="$SANDBOX/user" PASEO_PASSWORD= node bin/moremote-cli.js configure --data-dir "$SANDBOX/cli" --paseo-home "$SANDBOX/daemon" --target "127.0.0.1:$PASEO_TEST_PORT"
HOME="$SANDBOX/user" PASEO_PASSWORD= node bin/moremote-cli.js check --connect --data-dir "$SANDBOX/cli"
```

If no isolated daemon exists, an operator can explicitly authorize and run `paseo onboard --home "$SANDBOX/daemon" --listen "127.0.0.1:$PASEO_TEST_PORT" --no-relay --no-mcp --voice disable --json` with HOME set to "$SANDBOX/user"; afterward `paseo daemon stop --home "$SANDBOX/daemon"`. The owner exercised this isolated read-only setup for local acceptance. It neither created an agent nor called a provider/model. Reuse an already-authorized isolated daemon instead of starting a second one during verification.

The actual SDK synthetic-wire cases are `tests/official-wire.test.ts` (waits for the real10s liveness ping; asserts no presence/read/Expo; loses admission ack then reconnects without resend) and `tests/official-permission-wire.test.ts` (real structured question response/resolution, same-ID replacement rejection and lost resolution without resend). These are not mock adapter echoes and do not call a real model.

### Upstream license evidence

Official tag v0.15.3 points to commit d91ae138cb931447635e94296023414a58bedcc5. Its root LICENSE expressly grants Apache-2.0 for non-third-party Paseo code and retains third-party terms; matching client/protocol package sources are version0.15.3. Full text and immutable primary URLs are in licenses/Paseo-0.15.3.txt and NOTICE. npm package license fields are absent and were not treated as evidence; no signed npm/source attestation is claimed.

## External gates / substrate gaps

- Independent specification and quality/security reviews and frozen local check results belong to the integration owner.
- Hosted cross-platform CI, exactv0.1.1 tag, npm publication, signed provenance and GitHub assets are verified above. Environment deployment is `v*`-tag-only. No broader branch/tag Ruleset or trusted-publisher migration is claimed.
- The native macOS/Linux/Windows managers now have the scoped acceptance recorded above. Public-to-public next-version activation and corresponding published-version rollback still require their own release evidence; synthetic QA versions are not that proof.
- No everyday login service, real-work-session send/approval or paid-model task was exercised. The temporary macOS registration was removed; it is not daily-host deployment.
- One authorized synthetic sandbox alert was observed on a real iPad through the independent cloud/app path. This is not genuine permission/reply execution, production TestFlight delivery or terminated-app acceptance; emulation and artifact installation do not establish those gates.

Continue from this file and living specs, not private machine history. Record exercised evidence here before claiming a verified release.
