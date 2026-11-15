# Title provenance release0.1.8

## Authorized scope and preflight

The owner explicitly authorized0.1.8publication alongside the related App update.
The reviewed title-provenance implementation is unchanged from the accepted
source snapshot. Only package/lock root versions, README and release records
change during preparation; dependencies and compatibility tuple remain pinned.
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

## Publication boundary

The existing GitHub `Release` workflow and its scoped repository/environment
publishing authority perform npm publication and create the GitHub Release only
after npm accepts the exact tested tarball. A pushed tag or successful identity
check alone does not establish public availability. Independent anonymous registry
download, exact-version isolated installation and tarball/checksum equality are
required before recording publication as accepted. No real everyday service is
restarted or upgraded by this release procedure.
