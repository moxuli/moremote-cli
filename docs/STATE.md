# Current state — 2026-11-10

## Scope

Owner-approved notification/scoped-delivery first iteration; Apache-2.0. Standalone Node24 companion targeting inspected official SDK/protocol 0.15.3. Existing iOS protocol-vector floor is independent and unchanged. OpenUI, system extensions and broader native surfaces belong to later app iterations.

## Approved identity cutover — locally verified

The owner approved the complete rename to **MoRemote CLI** on 2026-11-10:
repository/command `moremote-cli`, current public npm `@moxuli/moremote`, entry `bin/moremote-cli.js`,
`MOREMOTE_CLI_HOME`, state `MoRemoteCLI` on macOS/Windows and `moremote-cli`
on Linux, and services `com.moremote.cli` / `moremote-cli.service` / `MoRemoteCLI`.
Ownership/runtime/client/managed-package identities move together. There is no
released package or installed service to migrate: no compatibility aliases or
automatic adoption of old state. Foreign-resource protections remain strict.
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
Hosted final Windows acceptance and tag publishing still need receiver results.
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
- Public GitHub repository exists; CI/release workflow source is prepared but no hosted run, tag/release, npm publication, trusted publisher, scheduler or branch/tag protection is claimed. Unpublished npm404 is a real update failure, persisted with bounded discovery rather than a retry storm or fake success.
- Real per-user launchd/systemd/Windows logon-task installation requires point-of-use operator authorization and testing on each OS; adapters are source, not evidence of another OS’s acceptance.
- No everyday login service, real work-session action, DNS/cloud deployment, paid model call, Apple key/capability change or public publication has been performed.
- Production Cloudflare storage/network reachability, Apple provider signing and app topic/environment, actual iOS app enrollment and physical APNs delivery are real external setup/acceptance requirements. Emulation is not proof of delivery.

Continue from this file and living specs, not private machine history. Record exercised evidence here before claiming a verified release.
