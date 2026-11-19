# CLI release operator plan

The operator connects existing package checks and the tag-triggered workflow
to a separate public receiver check. Keep the hosted publish workflow,
credential scope and deterministic packer.

1. **Ground the workflow.** Read the 0.1.8 release journal and the historical
   0.1.9 release recap. Query the actual hosted jobs with
   `gh run view 44493968482 -R moxuli/moremote-cli` and
   `gh run view 44493968462 -R moxuli/moremote-cli`. The output must show
   successful CI and Release runs for source `3dfb198` and tag `v0.1.9`.
   Use those receipts to document pending and complete states.
2. **Implement preflight and authorized publication.** Add
   `scripts/release-operator.mjs` and the `npm run release` entry.
   `plan` and `prepare` consume a full reviewed SHA on a clean checkout.
   They print the exact tag and, after local checks and deterministic packing,
   the archive SHA256. `publish` also consumes that tag as explicit
   confirmation. It verifies the exact upstream SHA and three-platform CI,
   writes an exclusive per-tag intent in the Git common directory, pushes
   one annotated tag and reads it back. A prior intent fences an uncertain
   request across operator processes.
3. **Implement receiver acceptance.** `verify` consumes the published SHA,
   tag and optional prepared SHA256. It reports the exact hosted run,
   artifact size, digest and installed frontend version. GitHub repository,
   release and asset GETs and npm reads are anonymous. GitHub's hosted-run and
   release metadata checks use the existing GitHub CLI credentials. A failed
   run can establish recovery only when the exact hosted npm publish completed
   and GitHub Release creation was the sole failed step.
4. **Verify the change.** Add `tests/release-operator.test.ts` with synthetic
   provider responses for wrong commits, published/partial states, retry
   fences, anonymous asset redirects and integrity mismatches.
   Run `node --import tsx --test tests/release-validation.test.ts tests/release-operator.test.ts`
   for nine passing release checks. Run `npm ci --ignore-scripts`,
   `npm run check` and `npm run smoke:upgrade` for clean install,
   typecheck, tests, build and the compatible/failed packaged update outcomes.
   Exercise the existing release with
   `npm run release -- verify --sha 3dfb1986db11cbcdb91f00e5656aef5a2fe18aa6 --tag v0.1.9 --expect-sha256 7671890a2e14db8b91bf63f782be7ea2d3f18b6bf495e4d519a33675d8fee954`.
   Expect 171,886 matching bytes and the isolated CLI reporting 0.1.9.
5. **Document and land.** Update `docs/releasing.md`, index, README, AGENTS,
   changelog and STATE with actual results. Review the release scope and
   implementation, then run `git diff --check`. Land the reviewed changes
   with a normal source commit. This plan authorizes source verification only.

## Verification record

The complete check passed 286 tests, typecheck and build. The packaged
upgrade smoke verified compatible activation and rollback of a failing
candidate. The operator independently verified the real public `v0.1.9`
archives and a disposable installation. Separate scope and quality
reviews confirmed identity, authorization and receiver evidence using fresh
Codex contexts after the cross-vendor route was unavailable.
