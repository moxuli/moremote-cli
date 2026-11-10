# Releasing @moxuli/moremote

Repository: public `moxuli/moremote-cli`; package: public `@moxuli/moremote`; executable: `moremote-cli`. No unscoped npm alias is published. This repository contains no publishing credential and workflows do not read NPM_TOKEN/NODE_AUTH_TOKEN secrets.

## First publication and trust setup (human prerequisites)

The package must exist before its npm package settings can define a trusted publisher. An npm organization owner/package maintainer must establish an authenticated npm account, confirm the `@moxuli` scope/package authority and2FA policy, and explicitly authorize one **first public publication** of the validated0.1.0 tarball from a trusted workstation. This is an external release, not a CI dry run. Do not assume an org token exists, re-use a stale login, create a token automatically or publish merely to test authentication. If npm adds a pre-publication trusted-publisher reservation flow, use its current documented UI rather than guessing that the existing-package settings work for a404 package.

After that first package exists, on npmjs.com package Settings → Trusted Publisher, configure:

- provider GitHub Actions, organization `moxuli`, repository `moremote-cli`;
- workflow filename **`release.yml`** (not its full path);
- environment **`npm-release`**;
- permit **direct `npm publish`** (current npm defaults may allow staged publish only).

Create the matching GitHub environment, restrict it to protected release tags and add required reviewers if desired. Configure tag protection/Rulesets so only authorized maintainers can create release tags. A newly created npm trusted-publisher configuration must complete its first successful publish within the current documented two-day validation window; recreate an expired configuration rather than adding a long-lived secret fallback. For the first OIDC release, bump to a genuinely new version (for example0.1.1); npm versions cannot be overwritten. After successful OIDC publication, require2FA and disallow traditional tokens in npm publishing access, and separately revoke unused automation tokens under owner authorization. Existing organization secrets are not consumed by these workflows.

## Normal release

1. Keep dependencies pinned and the compatibility tuple unchanged only if storage/wire rollback is genuinely safe. Complete `npm ci --ignore-scripts`, `npm run check`, `npm run smoke:upgrade`, `node scripts/release.mjs validate vX.Y.Z` and `node scripts/release.mjs pack vX.Y.Z` using Node24.13.0. The pack command produces `moxuli-moremote-X.Y.Z.tgz` and `SHA256SUMS` from two byte-identical packs and validates archived identity/required entrypoints. These generated files are release outputs, not source files to commit.
2. Review public package contents, changelog and external acceptance separately. Update package.json and only the lockfile root versions; do not upgrade dependencies incidentally. Commit through normal review and push the exact stable `vX.Y.Z` tag only after owner release authorization. Prerelease/range/mismatched tags fail closed.
3. The release workflow revalidates repository/tag/package/lock identity, runs checks/build, packs deterministically, verifies the supported bundled npm version, and publishes that exact tarball with OIDC/public access/provenance. The `npm-release` environment gate applies. GitHub-hosted Ubuntu24.04 and pinned Node24.13.0 are used; no global npm upgrade occurs.
4. Only after npm publication succeeds does it create the GitHub Release containing the identical tarball and SHA256SUMS. Release concurrency is serialized and never cancels a publishing run. Only this job receives contents:write and id-token:write; ordinary CI has contents:read, checkout credentials are not persisted, and no cache is used in release builds.
5. If npm publish fails, no successful GitHub Release is created. If npm succeeded but GitHub creation failed, **do not republish/retag** or assume the workflow is transactional across registries. Recover the exact published npm tarball, validate its integrity and identity against the logged build artifact/checksum, and attach those bytes in a separately authorized GitHub Release operation. A rerun will honestly fail npm's immutable-version check; it never substitutes different bytes for the same version.

CI also runs portable behavioral checks and an explicit isolated real packaged-upgrade smoke on macOS/Linux/Windows. Native service registration still requires authorized platform acceptance; no CI step installs a real login service. Physical APNs acceptance is independent of npm/release acceptance.

## Verified action pins and primary sources

Official tag refs were resolved read-only from each official upstream with `git ls-remote`:

- [`actions/checkout` v6.0.2](https://github.com/actions/checkout/tree/de0fac2e4500dabe0009e67214ff5f5447ce83dd): `de0fac2e4500dabe0009e67214ff5f5447ce83dd`.
- [`actions/setup-node` v6.1.0](https://github.com/actions/setup-node/tree/395ad3262231945c25e8478fd5baf05154b1d79f): `395ad3262231945c25e8478fd5baf05154b1d79f`.
- [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/): npm11.5.1+, supported hosted runners, exact workflow/environment binding, initial configuration expiry, automatic public provenance and token restrictions.
- [GitHub publishing Node packages](https://docs.github.com/en/actions/tutorials/publish-packages/publish-nodejs-packages): package/repository metadata, scoped public publication and provenance. OIDC follows npm's newer instructions, not GitHub's optional token example.
- [GitHub OIDC hardening](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect).

Do not claim a package/trusted publisher/release exists from checked-in workflow source alone. Current observed public availability/authentication and exercised checks belong in STATE.md, with no private account identifiers or credentials.
