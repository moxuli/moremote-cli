# Custom notification API origin

Owner-authorized preparation for the registered `moxuli.com` domain. Keep DNS
with Aliyun and bind `api.moremote.moxuli.com` to the existing Pages/Worker
notification service. This CLI branch performs no DNS/service deployment,
version bump, publication, real enrollment or service registration.

## Acceptance and authority

- New explicit setup, its published local descriptor and expert `pair` use
  `https://api.moremote.moxuli.com` only when config has no API origin.
- Reuse the existing `DEFAULT_API_ORIGIN` export; remove the separate expert
  pairing literal. Default selection is not an implicit configuration migration.
- Preserve every existing configured origin, including the Pages default, and
  every active/revoked/pending pair's original API authority and secrets.
- Resume retained enrollment requests with original request/offer/create bytes;
  do not regenerate offers, extend expiry, replay uncertain mutations or redirect
  enrolled phones to another origin.
- Both domains must directly reach the same notification backend. Widgets and
  Live Activities acquire no new Cloudflare dependency.

## Implementation and verification

`src/local-enrollment.ts` owns the shared default; existing setup and discovery
already consume it. `src/cli.ts` imports it for expert pairing. No encryption,
notification dispatch, official protocol, retry or service ownership behavior
changes.

Add regressions first: assert the literal new origin in fresh setup and its
descriptor, execute the real CLI expert onboarding against an in-process relay,
and preserve a saved Pages configuration with active/revoked/pending pairings
and immutable enrollment bytes. CLI fixtures replace native service-manager
queries with a temporary Node process that reports absent registration and
rejects lifecycle operations; a real installed service must never be consulted.

Integration owner runs:

```sh
node --import tsx --test tests/local-enrollment.test.ts tests/pair-onboarding.test.ts tests/setup-command.test.ts tests/setup-migration.test.ts
npm run check
```

Baseline RED: fresh setup selected the old Pages domain; the retained Pages
compatibility regression passed. The initial expert fixture stopped at
`FOREIGN_SERVICE_REGISTRATION` during diagnostics because changing HOME does
not isolate a native manager's real user domain. Correct the fixture rather
than weakening production ownership checks. Passing acceptance remains for
the integration owner to record after implementation.

## Publication gate

Do not publish a CLI containing the new default until authoritative DNS,
certificate validation and direct HTTPS service behavior succeed on the
custom domain. Also verify the former Pages domain still directly serves the
same backend and existing pairings remain usable. Aliyun DNS entry and
Cloudflare binding are owned by the integration/deployment task. Keep the
package version unchanged during preparation; record final external evidence
and make any release decision separately.

## Local verification and release gate

The custom hostname is active. Independent DNS, certificate and direct JSON API
reads pass on both origins without redirects. Full local check:238 tests, zero
failures; the actual packaged upgrade/rollback smoke, tag validation and
deterministic0.1.6 pack pass. A subsequent test-only Windows preload URL
correction passes both actual CLI fixture suites (5 tests). Independent quality
re-review clears the source; actual Windows, Linux and macOS CI remains required
before tagging. The published package remains0.1.5 until the release receiver
independently confirms0.1.6. No real service registration was performed.
