# Custom API origin release — 2026-11-15

The owner requested the custom notification hostname while retaining Alibaba DNS
and conditional CLI publication. Missing-origin setup/discovery and expert
pairing now share that verified default; saved Pages/custom origins and exact
pending authority remain unchanged.

Reviewed sourcec38e2b07adc88e6fd5f4e18ef9c41fb87b51f9b9 was merged/pushed to
main. CI43611899292 passed complete checks and real packaged upgrades on
macOS15, Ubuntu24.04 and Windows2025 before tagv0.1.6. Release43612669196
repeated full checks, upgrade/rollback and deterministic packing, then used the
existing scoped repository secret to publish with provenance and create the
matching GitHub Release. No new credential, permission or service was created.

Anonymous registry read/download/install verifies0.1.6 and actual compiled new
defaults. npm integrity matches; GitHub archive and SHA256SUMS match the npm
archive exactly. Published SHA256: `cce7ddf6d1913ba27e8e07697cc73dbaa575d76b8be7f02fb62603654b29127b`.
Install used a disposable prefix and independent empty npm configuration, no
inherited publishing credentials and disabled install scripts. Only --version
was invoked; it reported0.1.6 without registering a real service.

The initial local236/238 result exposed real service queries outside temporary
HOME. A shared read-query fixture fixed isolation without weakening production
ownership/foreign-data refusal. A subsequent review found Windows preload paths
needed file URLs; focused5/5 and final actual three-platform CI pass. Acceptance
uses the weaker independent-context Codex fallback, not cross-vendor proof.

Local main packing initially reused prior ignored dist outputs. Rebuilding then
exposed two obsolete dist/activity outputs left by incremental tsc. Fresh public
CI packaging contains neither; every shared archived file byte matches local
source builds. Neither obsolete local archive was published. Original failed
preflight/packing observations remain retained rather than labeled successful.

No App release, everyday service update or physical push delivery is implied.
Complete prior state remains in [[2026-11-14-state-before-0.1.6-part-1]] and [[2026-11-14-state-before-0.1.6-part-2]].
