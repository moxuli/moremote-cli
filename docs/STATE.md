# Current state — 2026-11-10

## Scope

Owner-approved notification/scoped-delivery first iteration; Apache-2.0. Standalone Node24 companion targeting inspected official SDK/protocol 0.15.3. Existing iOS protocol-vector floor is independent and unchanged. OpenUI, system extensions and broader native surfaces belong to later app iterations.

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


## Reproduction commands

1. npm ci --ignore-scripts
2. npm run check
3. node bin/moremote-companion.js --help
4. node bin/moremote-companion.js --version
5. With a synthetic temporary MOREMOTE_COMPANION_HOME, run check, configure, status. Do not install services in ordinary CI.
6. Against an explicitly isolated official0.15.3 daemon: configure its exact target/home, check --connect, then run; inspect traffic for only narrow subscriptions/read RPCs and no heartbeat/read acknowledgement/push registration. Use synthetic conversations for explicit send and actual pending question/approval tests. Verify accepted admission separately from agent completion and simulate socket loss after dispatch without replay.
7. Run the independent cloud’s local SQLite-backed Worker, configure explicit loopback development at both ends, pair a synthetic endpoint using the public contract, submit an encrypted command and validate its exact encrypted receipt. No repository runtime imports are needed.

### Read-only isolated official smoke

Use an already-authorized isolated0.15.3 daemon, empty isolated user home and an unused selected port. Do not point this at everyday Paseo data. The companion commands are:

```sh
HOME="$SANDBOX/user" PASEO_PASSWORD= node bin/moremote-companion.js configure --data-dir "$SANDBOX/companion" --paseo-home "$SANDBOX/daemon" --target "127.0.0.1:$PASEO_TEST_PORT"
HOME="$SANDBOX/user" PASEO_PASSWORD= node bin/moremote-companion.js check --connect --data-dir "$SANDBOX/companion"
```

If no isolated daemon exists, an operator can explicitly authorize and run `paseo onboard --home "$SANDBOX/daemon" --listen "127.0.0.1:$PASEO_TEST_PORT" --no-relay --no-mcp --voice disable --json` with HOME set to "$SANDBOX/user"; afterward `paseo daemon stop --home "$SANDBOX/daemon"`. The owner exercised this isolated read-only setup for local acceptance. It neither created an agent nor called a provider/model. Reuse an already-authorized isolated daemon instead of starting a second one during verification.

The actual SDK synthetic-wire cases are `tests/official-wire.test.ts` (waits for the real10s liveness ping; asserts no presence/read/Expo; loses admission ack then reconnects without resend) and `tests/official-permission-wire.test.ts` (real structured question response/resolution, same-ID replacement rejection and lost resolution without resend). These are not mock adapter echoes and do not call a real model.

### Upstream license evidence

Official tag v0.15.3 points to commit d91ae138cb931447635e94296023414a58bedcc5. Its root LICENSE expressly grants Apache-2.0 for non-third-party Paseo code and retains third-party terms; matching client/protocol package sources are version0.15.3. Full text and immutable primary URLs are in licenses/Paseo-0.15.3.txt and NOTICE. npm package license fields are absent and were not treated as evidence; no signed npm/source attestation is claimed.

## External gates / substrate gaps

- Independent specification and quality/security reviews and frozen local check results belong to the integration owner.
- No published repository/package, hosted CI, issue tracker, automatic release scheduler or branch protections have been provisioned. npm update intentionally reports a missing version as failure until a separately authorized real publication exists.
- Real per-user launchd/systemd/Windows logon-task installation requires point-of-use operator authorization and testing on each OS; adapters are source, not evidence of another OS’s acceptance.
- No everyday login service, real work-session action, DNS/cloud deployment, paid model call, Apple key/capability change or public publication has been performed.
- Production Cloudflare storage/network reachability, Apple provider signing and app topic/environment, actual iOS app enrollment and physical APNs delivery are real external setup/acceptance requirements. Emulation is not proof of delivery.

Continue from this file and living specs, not private machine history. Record exercised evidence here before claiming a verified release.
