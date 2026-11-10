# Releasing @moxuli/moremote

Repository: public `moxuli/moremote-cli`; package: public `@moxuli/moremote`; executable: `moremote-cli`. No unscoped alias is published. Credentials never belong in this repository, release assets or package contents.

## Existing publishing authority

The owner already provisioned organization secret `NPM_TOKEN`, restricted to this selected public CLI repository. Reuse that configuration. Do not create another token, require a new login, or block release on a web-only trusted-publisher migration. The workstation's protected publishing credential is separately loaded at point of use; do not echo it or commit an authenticated npm configuration.

The release job uses environment `npm-release`. Only its publish step receives the existing secret as `NODE_AUTH_TOKEN`; checks, dependency installation, builds and package scripts do not receive it. The temporary npm configuration contains the literal environment placeholder, pins both default and `@moxuli` registries to npmjs, has private permissions and is removed after publishing. No authentication file is packaged. Token authority/expiry and required interactive provider checks still apply; never bypass them or claim acceptance from a valid identity read alone.

Configure the release environment to accept authorized `v*` tags. Branch/tag protection and required reviewers remain owner-governed settings. Token replacement/revocation is a separate account action. npm trusted publishing remains an optional future migration, not an additional prerequisite for the current owner's existing setup.

## Normal release

1. Keep dependencies pinned. Preserve the compatibility tuple only when storage/wire rollback is genuinely safe. On Node24.13.0 run `npm ci --ignore-scripts`, `npm run check`, `npm run smoke:upgrade`, `node scripts/release.mjs validate vX.Y.Z` and `node scripts/release.mjs pack vX.Y.Z`.
2. Review public contents and changelog. Update package.json and only lockfile root versions, commit through review, then push the exact owner-authorized stable `vX.Y.Z` tag. Prerelease/range/mismatched tags fail closed. Generated tarballs/SHA256SUMS are release outputs, not tracked source.
3. The GitHub-hosted Ubuntu24.04 job validates repository/tag/package/lock identity, checks/builds and produces two byte-identical packs. It publishes the exact tested tarball with the existing scoped secret, public access and GitHub provenance. Node24.13.0 is pinned; no global toolchain upgrade occurs.
4. Only after npm accepts publication does the job create a GitHub Release with the identical tarball and SHA256SUMS. Release concurrency is serialized and never cancels an in-flight publish. Only this job receives contents:write/id-token:write for release/provenance; ordinary CI is contents:read. Checkout credentials are not persisted and release builds use no cache.
5. If npm fails, no successful GitHub Release is created. If npm accepted but GitHub creation failed, **do not republish or retag**: recover the exact published bytes, validate integrity against the accepted build artifact/checksum, and recover the GitHub Release under the owner's release authorization. npm versions are immutable.
6. npm can acknowledge submission while processing a new package. Require an independent anonymous registry read and installation of the public exact version before claiming availability. Do not repeatedly republish while processing. Record the receiver result in STATE.

The first workstation bootstrap publication is0.1.0. Subsequent automated releases must use a genuinely new version; neither workflow reruns nor corrected documentation can replace published0.1.0 bytes.

CI also runs portable behavior and isolated real packaged-upgrade smoke on macOS/Linux/Windows. It never installs a real login service. Native platform managers and physical APNs are separate acceptance gates.

## Verified action pins and primary sources

- [`actions/checkout` v6.0.2](https://github.com/actions/checkout/tree/de0fac2e4500dabe0009e67214ff5f5447ce83dd): resolved official tag.
- [`actions/setup-node` v6.1.0](https://github.com/actions/setup-node/tree/395ad3262231945c25e8478fd5baf05154b1d79f): resolved official tag.
- [GitHub publishing Node packages](https://docs.github.com/en/actions/tutorials/publish-packages/publish-nodejs-packages): scoped public publishing, token use and provenance.
- [npm provenance](https://docs.npmjs.com/generating-provenance-statements): hosted build identity is separate from npm publishing authority.
- [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/): optional future short-lived authentication migration.

Never infer a registry package, hosted workflow result, release or protection setting from checked-in YAML alone. Record only exercised facts, without private accounts or credential values.
