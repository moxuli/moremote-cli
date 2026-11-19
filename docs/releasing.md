# Releasing @moxuli/moremote

The public `moxuli/moremote-cli` repository releases `@moxuli/moremote`.
The installed command is `moremote-cli`. Keep credentials outside the
repository, release assets and package contents.

## Existing publishing authority

The owner already provisioned organization secret `NPM_TOKEN`, restricted to this selected public CLI repository. Reuse that configuration. Do not create another token, require a new login, or block release on a web-only trusted-publisher migration. The workstation's protected publishing credential is separately loaded at point of use; do not echo it or commit an authenticated npm configuration.

The release job uses environment `npm-release`. Only its publish step receives the existing secret as `NODE_AUTH_TOKEN`; checks, dependency installation, builds and package scripts do not receive it. The temporary npm configuration contains the literal environment placeholder, pins both default and `@moxuli` registries to npmjs, has private permissions and is removed after publishing. No authentication file is packaged. Token authority/expiry and required interactive provider checks still apply; never bypass them or claim acceptance from a valid identity read alone.

Configure the release environment to accept authorized `v*` tags. Branch/tag protection and required reviewers remain owner-governed settings. Token replacement/revocation is a separate account action. npm trusted publishing remains an optional future migration, not an additional prerequisite for the current owner's existing setup.

## Prepare and publish

Use Node 24.13.0, Git and an authenticated GitHub CLI. Review the public
package and changelog, update `package.json` and only the lockfile root
version fields, then land the approved candidate on `main`. Preserve the
compatibility tuple when storage and wire rollback are genuinely safe.
Set `RELEASE_SHA` to the full reviewed Git SHA and `RELEASE_TAG` to the tag
matching the exact stable package version, such as `v0.1.9`.

```sh
npm run release -- plan --sha "$RELEASE_SHA"
npm run release -- prepare --sha "$RELEASE_SHA"
```

`plan` is offline. `prepare` clones the reviewed commit into a temporary
checkout with isolated npm configuration and runs dependency installation,
the complete check, packaged upgrade smoke and deterministic packer. Keep the
printed SHA256 with the acceptance evidence.

On macOS the isolated directory uses a short path under `/tmp`. The native
smoke tests create Unix sockets and can hit the path limit when nested under
the long, per-user temporary directory.

After the owner authorizes that commit and tag, trigger the existing release
workflow with the command below. The operator requires a clean reviewed
checkout, the exact remote main SHA, a passing three-platform CI run, an active
release workflow, an unused remote tag, and a 404 for the exact registry
version. It repeats the local preparation and remote checks before pushing
one annotated tag from its temporary checkout. Before sending, it records
that attempt under `moremote-release-intents/` in the Git common directory.
Any existing intent for the tag blocks another push even if the remote tag
is still absent. Worktrees sharing a common directory share this guard.
Locate it with `git rev-parse --path-format=absolute --git-common-dir`.

```sh
npm run release -- publish --sha "$RELEASE_SHA" --confirm "$RELEASE_TAG"
```

GitHub Actions validates the tag and package identity, checks the source,
builds two byte-identical packs and publishes the tested tarball to npm.
After npm accepts it, the workflow creates the public GitHub Release with
the same tarball and `SHA256SUMS`. Only the hosted publish step has the scoped
npm secret. The operator's tag result confirms the trigger.

## Verify the public release

```sh
npm run release -- verify --sha "$RELEASE_SHA" --tag "$RELEASE_TAG"
npm run release -- verify --sha "$RELEASE_SHA" --tag "$RELEASE_TAG" --expect-sha256 "$RELEASE_DIGEST"
```

Use the second form with `RELEASE_DIGEST` set to the retained SHA256. Both forms
check the remote tag and exact hosted release run, read the exact
version anonymously from npm, read the public GitHub repository, release and
both assets without GitHub credentials, compare the tarball and checksum,
and install the verified archive into a disposable npm prefix with scripts
disabled. The isolated frontend must report the exact
version. Record the source SHA, hosted CI and release run URLs, npm/GitHub
artifact SHA256 and installation evidence in [STATE](STATE.md) or the journal.
Managed-runtime activation, platform service admission and physical APNs
delivery have their own evidence.

## Recovery and observed releases

- [v0.1.9](https://github.com/moxuli/moremote-cli/releases/tag/v0.1.9)
  resolves to `3dfb1986db11cbcdb91f00e5656aef5a2fe18aa6`. The
  [main CI](https://github.com/moxuli/moremote-cli/actions/runs/44493968482)
  and [release run](https://github.com/moxuli/moremote-cli/actions/runs/44493968462)
  passed. The npm and GitHub archives match at 171,886 bytes with SHA256
  `7671890a2e14db8b91bf63f782be7ea2d3f18b6bf495e4d519a33675d8fee954`.
- [v0.1.8 acceptance](journal/2026-11-15-title-provenance-release.md) records
  an early failing Ubuntu CI run. The tag was withheld until the fixed SHA
  passed all three hosted platforms. npm then briefly returned 404 while
  processing the accepted upload. The receiver waited for the exact version,
  verified matching bytes and installed it with empty npm configuration.
- If the tag push times out or the registry version is pending, inspect the
  existing remote tag, release job and npm version. Resume the read-only
  verification once the provider exposes the package. Preserve the local
  intent as evidence. Only move its record aside under release authorization
  after GitHub and npm authoritatively confirm the attempt had no effect.
- If npm has accepted a version and GitHub Release creation failed, recover
  the same validated public bytes and checksum under the original release
  authorization. Re-run only `verify`. It accepts the original hosted
  failure after reading the exact tag and SHA and confirming that npm
  publication succeeded and GitHub Release creation was the only failed
  step. Recovered GitHub assets must pass the same anonymous reads, digest
  checks and isolated install as a normal release. npm versions and the
  established tag are immutable.
- For a faulty public package, retain the existing artifacts and coordinate a
  new reviewed version. The packaged-upgrade smoke tests the managed
  runtime's own fallback to its previous local version.

See the [operator implementation plan](plans/2026-11-19-release-operator.md)
for the integration and verification order.

## Related releases

Use the corresponding repository's procedure for other components.

- [MoRemote iOS App](https://github.com/moxuli/moremote/blob/main/docs/releasing.md)
- [MoRemote Cloud](https://github.com/moxuli/moremote-cloud/blob/main/docs/releasing.md)
- [MoRemote website](https://github.com/moxuli/moremote-site/blob/main/docs/releasing.md)
- [Moxuli Studio website](https://github.com/moxuli/moxuli-site/blob/main/docs/releasing.md)

## Verified action pins and primary sources

- [`actions/checkout` v6.0.2](https://github.com/actions/checkout/tree/de0fac2e4500dabe0009e67214ff5f5447ce83dd): resolved official tag.
- [`actions/setup-node` v6.1.0](https://github.com/actions/setup-node/tree/395ad3262231945c25e8478fd5baf05154b1d79f): resolved official tag.
- [GitHub publishing Node packages](https://docs.github.com/en/actions/tutorials/publish-packages/publish-nodejs-packages): scoped public publishing, token use and provenance.
- [npm provenance](https://docs.npmjs.com/generating-provenance-statements): hosted build identity is separate from npm publishing authority.
- [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/): optional future short-lived authentication migration.

Never infer a registry package, hosted workflow result, release or protection setting from checked-in YAML alone. Record only exercised facts, without private accounts or credential values.
