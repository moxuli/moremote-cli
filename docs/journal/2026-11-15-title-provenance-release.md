# Title provenance release0.1.8

## Authorized scope and preflight

The owner explicitly authorized0.1.8publication alongside the related App update.
The reviewed title-provenance implementation is unchanged from the accepted
source snapshot. Initial preparation changes package/lock root versions, README
and release records; dependencies and compatibility tuple remain pinned.
The original seven-field enrollment descriptor and rollback discovery layout
remain unchanged. Source behavior and historical failed-check evidence are in
[[2026-11-15-live-activity-title-provenance]].

Fresh Node24.13.0 `npm ci --ignore-scripts` installs the pinned lock and audits
zero vulnerabilities. Default `npm run check` passes267tests with zero failures
or skips, plus typecheck/build. Actual `npm run smoke:upgrade` accepts compatible
activation, failed-candidate rollback, retained bootstrap/previous, aliased
frontend selection and clean stop. It uses disposable private prefixes and owned
test processes; no native login service or real provider session is touched.
`node scripts/release.mjs validate v0.1.8` passes. Deterministic pack and hosted
publication/receiver results are recorded separately after their actual completion.

Independent same-provider follow-up `run-20261115121907-cdb3164c` closes all4
initial blockers and independently passes11CLI tests. The earlier external
provider account hold yielded no review; this is an independent-context fallback,
not a cross-vendor approval. The previously accepted complete267/267and focused
24/24results remain preserved alongside this fresh release gate.

## Hosted pathname-read race found before tagging

Candidate541715e's first hosted CI exposed `FOREIGN_RESOURCE_LINKS` in the real
local-enrollment consumer's config read on Ubuntu. The tag was withheld. Initial
and final pathname lookup can observe a valid owned inode whose link count has
already become0during atomic rename, before the stat result reaches the caller.
The previous reader handled that retirement only after opening a file descriptor.

Two deterministic regressions hold the real old inode, rename its replacement,
and return that inode's actual retired fstat as the pathname lookup result; both
failed with the hosted stack's error before the fix. The minimal private-reader
helper recognizes only retired0, strictly validates a different ordinary owned
replacement and reopens within the original3attempts. General inspect/write/delete
paths remain strict. Eight additional retirement-to-foreign replacement cases
retain symlink/hardlink/mode/limit rejection. Original observed-mutation and
continuous-replacement tests remain intact. The resource suites pass34/34locally;
the10POSIX retirement-specific cases are explicitly unsupported on Windows.
Original candidate bytes/checksum, hosted failure and actual RED/GREEN logs are
retained separately rather than overwritten or described as a successful release.

Independent Codex review then found an integrity gap: final pathname lookup could
observe size/mtime changes made after the final handle fstat, yet the retired0
branch discarded that observation. Two actual-fd truncate/equal-size regressions
first failed. The final helper receives the opened snapshot and rejects observed
same-inode size/mtime differences before any retirement retry; retirement's own
ctime change is not treated as a content write. Resource suites now pass36/36.
The first independent reviewer re-ran36/36and closed its P2 in follow-up
`run-20261115131303-ff270ab1`; a second independent static security context matched
the frozen source/test hashes and confirmed the corrected final-read fence.
Both are same-provider fallbacks, not cross-provider approvals. Wrong-uid, fd-close
counts and no-read-on-retired-handle are verified by control flow rather than
new direct counters in these regressions.

The obsolete initial CI retained its Ubuntu failure and macOS success. Windows
was canceled after its real enrollment consumer missed the original15s admission
deadline; its stalled teardown made the job linger. That failure is not described
as a proven consequence of the POSIX lookup race. The fixture now reports only
allowlisted stage/error codes and synthetic request counts, and stops its own
child before server teardown on failures/abort. Original15s/20sassertions remain
unchanged. A new complete source/test check and all3hosted platforms are required
for the final candidate; the initial CI is not accepted as the release gate.

The final frozen production guard and diagnostic fixture pass a fresh default
complete279/279check with types/build and the actual packaged upgrade/rollback
smoke. The focused real enrollment consumer passes1/1. A separate temporary
failure probe disables its synthetic claim and deliberately uses a1500msprobe
admission deadline; it retains the failure and exits with owned-child/server
teardown in2.685s. That probe does not alter the repository's15s/20sassertions.
Final hosted platform checks/publication/receiver acceptance remain pending.

## Publication boundary

The existing GitHub `Release` workflow and its scoped repository/environment
publishing authority perform npm publication and create the GitHub Release only
after npm accepts the exact tested tarball. A pushed tag or successful identity
check alone does not establish public availability. Independent anonymous registry
download, exact-version isolated installation and tarball/checksum equality are
required before recording publication as accepted. No real everyday service is
restarted or upgraded by this release procedure.
