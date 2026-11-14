# Informative notifications and remote activity release — 0.1.7

Owner-authorized sourceb6756ca861ad8dc56728eae6896a91fbf7331bcf is merged and
pushed to main. Three-platform CI43645424293 passes complete checks and real
packaged upgrade/rollback on macOS15, Ubuntu24.04 and Windows2025. The exact
v0.1.7 tag triggers successful release43646031281, repeating full checks,
upgrade/rollback and deterministic packing before npm provenance publication and
the corresponding GitHub Release. Existing scoped publishing authority is reused.

An independent anonymous exact-version registry download and isolated-prefix
install verify0.1.7. Actual frontend --version reports0.1.7 under an isolated
empty CLI/Paseo state, without a service or official connection. Local tested,
GitHub Release and npm archives are byte-identical; npm integrity matches.
SHA256: `af959601bc92f71680aee07329932551924990b6b436bc71bcd6df2eaa6c7495`.
Archive size:158646bytes. Initial public404 after the accepted publish is retained;
public availability is established only by the later successful receiver.
The first isolated npm helper reused one file as both global/user config; npm
rejected this before installation. Separate empty configs correct the helper,
without any product, credential, package or tag change.

Fresh final local checks pass250tests, types/build, real isolated packaged
upgrade/rollback, deterministic packing and npm audit with zero vulnerabilities.
The release audit caught existing ws8.20.0 advisory ranges; the manifest/lock now
pin8.21.0 while Node24.13.0 and official Paseo SDK/protocol pins stay unchanged.
Upstream primary advisories: GHSA-96hv-2xvq-fx4p and GHSA-58qx-3vcg-4xpx.
No real user service was installed/restarted as publication acceptance.

Informative previews and optional remote update/end need their corresponding
App/service rollout. Widgets remain direct Paseo clients. Physical APNs display,
background OS scheduling and general native action acceptance remain separate.
Private evidence: moremote-release-20261115-8ed079_h under MoRemoteAcceptance.
