# Project state

The [event-driven delivery decision](decisions/0002-event-driven-delivery.md)
records why idle queue reads were removed, why notification actions open the
conversation, and why terminal activities can use an already verified title.

## Public 0.1.15 — 2026-11-27

Source `fd87d1c81b9146708a751bb0389f0cc38f25a33a` is public as
[`v0.1.15`](https://github.com/moxuli/moremote-cli/releases/tag/v0.1.15).
The isolated preflight passed 306 tests, typecheck, build, and packaged upgrade
and rollback. [Main CI](https://github.com/moxuli/moremote-cli/actions/runs/45939157676)
passed on macOS, Ubuntu, and Windows. The
[release run](https://github.com/moxuli/moremote-cli/actions/runs/45940189904)
published a 188,612-byte tarball. The anonymous npm and GitHub downloads matched
the prepared SHA256 `75195eed5ac404a6fcf19f7c43cdda65cd62b27357d0a262f476b7b6f45f8f70`.
The isolated CLI reported 0.1.15. The registry metadata became visible before
the tarball. Read-only retries verified the original publication after propagation.

Finished and failed Live Activities can show the verified conversation title
before workspace metadata arrives. The existing exact Paseo completion read also
repairs a missing title on the matching live row. An isolated runtime test
verified the first encrypted completion payload. Host activation and physical
ActivityKit display are separate acceptance checks.

## Public 0.1.14 — 2026-11-27

Source `c427ef1f3c3cad0b84d6b8ca506eb89808212763` is public as
[`v0.1.14`](https://github.com/moxuli/moremote-cli/releases/tag/v0.1.14).
The final local check passed 305 tests. The
[main CI run](https://github.com/moxuli/moremote-cli/actions/runs/45915875209)
passed on macOS, Ubuntu, and Windows, including packaged upgrade and rollback.
The [release run](https://github.com/moxuli/moremote-cli/actions/runs/45916816194)
published a 187,461-byte archive. An anonymous npm and GitHub readback matched
the local archive and checksum. The isolated installation reported 0.1.14.
The package SHA256 is
`a91e87627813d247e215156fcff316a0d63ca41a40692d44f3ac6b74585439f2`.
The first registry reads returned 404 during propagation. Verification retried
the same immutable release.

The companion publishes from Paseo observations without periodic command or
control queue reads. Production switched to the compatible Worker first.
Authenticated reads verified the active pair and encrypted Live Activity
registration on both production origins. The first Worker rollout briefly
returned a private catalog route error while the Durable Object adopted the
new code. The patched Worker returns a temporary failure in that case. The
released companion verifies and restores affected local pairings only after
the relay confirms the exact active pair. Physical notification delivery and
ActivityKit presentation are separate acceptance checks.

The existing managed macOS supervisor activated 0.1.14 and retained 0.1.13
for rollback. All three affected pairings returned to active. The running
companion passed its official read-only Paseo connection check and recorded a
fresh acknowledged Live Activity publication. A stale workstation npm manifest
blocked the first update attempt. The same exact update succeeded with a fresh
registry read.

## Public 0.1.13 — 2026-11-24

Source `c1e253b2003bbb6ad05b91315446e30fb50d5ea7` is public as
[`v0.1.13`](https://github.com/moxuli/moremote-cli/releases/tag/v0.1.13).
The [main CI run](https://github.com/moxuli/moremote-cli/actions/runs/45412373530)
passed on macOS, Ubuntu, and Windows, including packaged upgrade and rollback.
The [release run](https://github.com/moxuli/moremote-cli/actions/runs/45415204208)
published the tested archive. The independent receiver verified that the local,
npm, and GitHub archives match and installed the public package into an isolated
prefix, where the frontend reported 0.1.13. The 183,999-byte archive has SHA256
`57ec5befbbe77e40c7f14ac6725ad9eff0360b997cce56a8545f1fdcb264d89a`.
The first registry read returned 404 after the hosted publication. The same
version became readable without changing the tag or retrying publication.

Live Activity candidates can publish with a generic title while metadata is
unavailable. An already-verified Paseo terminal read can repair a stale row for
the same turn and subscription. Physical APNs delivery remains unverified.

## Public 0.1.12 — 2026-11-23

Source `b640610617175f0a6f56b5a8eeba88432f387a8e` is public as
[`v0.1.12`](https://github.com/moxuli/moremote-cli/releases/tag/v0.1.12).
The [main CI run](https://github.com/moxuli/moremote-cli/actions/runs/45191671652)
passed on macOS, Ubuntu, and Windows. The
[release run](https://github.com/moxuli/moremote-cli/actions/runs/45193765835)
published the tested artifact. The independent readback verified that the
locally prepared archive, npm tarball, and GitHub assets matched, and an
isolated installation reported 0.1.12. The 182,586-byte archive has SHA256
`964091a0c5e23219d4a3e7028f6d93968161399b7ab87ed31ea1da23b182d1cb`.
The first anonymous npm read returned 404 after the publish receipt. Readback
succeeded after registry propagation.

This release repairs supported existing Windows login tasks when the updated
runtime next runs and separates local Paseo recovery from cloud delays.
The packaged upgrade and rollback smoke passed in isolation. Host-specific
activation still depends on the existing service configuration.

## Public 0.1.9 and release operator

Source `3dfb1986db11cbcdb91f00e5656aef5a2fe18aa6` is public as `v0.1.9`.
Main CI `44493968482` and the hosted release `44493968462` succeeded.
The release operator's read-only receiver check downloaded the npm archive and
both GitHub assets anonymously, verified all checksums and installed the same
archive in an isolated prefix. Its CLI printed 0.1.9. SHA256 of the
171,886-byte public archive is
`7671890a2e14db8b91bf63f782be7ea2d3f18b6bf495e4d519a33675d8fee954`.

See [the release runbook](releasing.md) for operator commands, required
authorization and sibling procedures. A fresh local check passed all 286 tests,
typecheck and build. The isolated packaged-upgrade smoke accepted the compatible
candidate and rolled back the failing candidate. The operator is source-only
at this checkpoint.

## Public0.1.8 — 2026-11-15

Reviewed sourced545c23 is public as0.1.8. All3OS CI43718667202 and release
43719303096 pass, including actual packaged upgrade/rollback. POSIX checks pass
279/279; Windows passes246with33explicit platform skips and zero failures.
Final resource security regressions pass36/36with two independent same-provider
security contexts; unavailable cross-provider review is not claimed as approval.

Anonymous registry read reports latest0.1.8; an exact-version install with empty
npm credential configuration and isolated HOME prints0.1.8. Its106package files
equal the archive bytes. Local tested/npm/GitHub tarballs and SHA256SUMS match:
`2ce3f482208d8f5b8d8cbe3a34cacead401ec278d2f4b6e11ec4b0de81f66179`.
The public archive is170832bytes. Initial failed CI/RED evidence and npm processing
delay are preserved in [[2026-11-15-title-provenance-release]]. Dependencies and
compatibility tuple remain unchanged. No everyday service or real provider
session was modified by release/receiver acceptance. Do not republish or retag0.1.8.

## Earlier local title-provenance checkpoint — before0.1.8

The activity endpoint accepts bounded encrypted source hints and resolves current
official workspace names through an active-only owned read subscription. A separate
private capability file preserves the exact legacy enrollment descriptor/tree and
rollback discovery. Targeted tests first reproduced rejected hints and missing
capability publication, then unknown-metadata, cross-owner ordering and cache
recovery failures. Final frozen checks pass types,267complete tests with zero
failures/skips and compilation;24focused tests also pass. Full tests use explicit
concurrency4 with all original timing assertions unchanged. Initial default
concurrency258tests had2runtime-deadline failures; both pass the final complete run.
See [[2026-11-15-live-activity-title-provenance]]. Source remains uncommitted;
no package release, service installation or physical device acceptance is implied.

## Public0.1.7 — 2026-11-15

Reviewed sourceb6756ca is public as0.1.7. All3OS CI43645424293 and release
43646031281 pass; anonymous registry download/install and exact frontend version
verify availability. Tested/npm/GitHub archive bytes and integrity match. Final
local250tests, types/build, packaged upgrade/rollback and audit0 pass. See
[[2026-11-15-informative-notifications-activity-release]]. No real host service
or physical APNs delivery is implied. Corresponding native/service rollout is
separately recorded; prior local-only checkpoints below remain historical.


## Earlier local remote activity checkpoint — before0.1.7

The owner-authorized v2 path shares CLI attention/activity event ingress and the
existing APNs infrastructure. Native foreground-started activities receive encrypted
remote update/end without app keepalive. Widgets remain direct Paseo clients.
No push-to-start, physical APNs delivery, deployment or release is claimed.
Local proof: CLI249complete/7final-focused, cloud202, Kit554with5explicit
skips, App83, real system journeys2and unsigned Release all pass. See
[[2026-11-15-remote-activity-local-acceptance]].

Updated: 2026-11-15

## Earlier local notification preview checkpoint — before0.1.7

Optional endpoint-encrypted session/host/current-content previews are implemented
on `fix/notification-content-1115`, with unchanged action/route authority, exact
retries and original expiry. No new package, Worker or physical APNs acceptance
is claimed. Final local checks and compatibility/review evidence:
[[2026-11-15-informative-notifications-and-settings]].

## Previous public release0.1.6

`@moxuli/moremote@0.1.6` is independently available and installable. Source
`c38e2b07adc88e6fd5f4e18ef9c41fb87b51f9b9`, immutable tagv0.1.6,
CI43611899292 and Release43612669196 succeeded. The existing repository
environment/scoped publishing secret was reused; no credential or service
permission changed. macOS15, Ubuntu24.04 and Windows2025 each passed complete
checks and actual packaged upgrade/rollback; the release job repeated them.

New unconfigured setup/discovery and expert pairing use the verified
`https://api.moremote.moxuli.com` default. Configured Pages/custom origins,
per-phone authority and exact pending request/offer/create bytes are preserved.
Both origins are direct with valid TLS and no redirects; Alibaba DNS remains
authoritative. Widgets/Live Activities do not use this cloud service.

Anonymous registry download/install reports0.1.6. npm integrity and GitHub
archive/SHA256SUMS equality pass. Published SHA256:
`cce7ddf6d1913ba27e8e07697cc73dbaa575d76b8be7f02fb62603654b29127b`.
The actual compiled archive uses the new shared default and contains82 files,
without private paths, credentials or obsolete activity outputs. Evidence:
[[2026-11-15-custom-origin-release]].

## Verification and preserved limits

Local full check:238 tests, zero failures, plus build/upgrade/rollback/validate/
deterministic pack. After a final test-only Windows file-URL correction, both
actual CLI fixture suites pass5/5 and final three-platform CI passes in full.
Initial236/238 failures exposed temporary-HOME service-manager leakage; the
shared fixture now intercepts exact read queries, records all calls and rejects
unknown/lifecycle requests, retaining foreign-data refusal assertions. Production
ownership behavior was not weakened. Independent-context Codex fallback review
clears the source; the cross-vendor attempt produced no report.

Node24.13.0, pinned dependencies and compatibility tuple remain unchanged.
Notification-only operation, current question/approval identity, immutable
unknown outcomes, exact retry/revocation and service ownership remain intact.
This release did not install/update a real everyday service, mutate a real
provider conversation or verify physical APNs display. Installed managed CLI
instances discover updates under their existing bounded policy; publication
does not prove every user's runtime upgraded. Never republish0.1.6 or move its tag.

## Historical state

The complete preceding515-line STATE is preserved in order, byte-for-byte
across [[2026-11-14-state-before-0.1.6-part-1]] and [[2026-11-14-state-before-0.1.6-part-2]], each below500 lines.
Concatenated SHA256: `82ed7e1d6916da17ed3d0ee759cc5600aab6173006d19e9b7333ece8ba2af3cd`.
All prior contracts, failures, external gates and operating boundaries remain
there. Current procedures remain [[releasing]] and [[conventions]].
