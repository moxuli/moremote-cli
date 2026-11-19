# Project state

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
