# Remote Live Activity delivery — local acceptance

Status: local implementation, unreleased. Existing deployed versions are unchanged.
The owner explicitly authorized sharing Cloudflare notifications with Live Activity
updates; widgets and ordinary app/extension reads remain direct Paseo clients.

## Implemented behavior

Native rendering cannot network. The phone starts its normal aggregate activity,
observes ActivityKit token rotations, and registers that one activity across active
paired computers. Each source receives only a dedicated display key, encrypted
under its own pairing root. The local attribute seed never enters the service.
The CLI acquires a separate owned official read interest only when needed. It
publishes semantic candidates and notification attention in one bounded event
POST, retaining independent durable acknowledgements and immutable unknown retries.
Unchanged state creates no extra Worker request; display freshness renews at most
once per eight minutes. A definitively closed generation stops CLI retries.

An existing PAIRS namespace object arbitrates the phone-wide fair queue and last
opened fallback. A source-specific final sender fences APNs against current pair,
member, token and deadline authority. An unknown end cannot resume updates. Remote
APNs can update/end the existing activity while the app is suspended; a renderer
verifies ciphertext, subscription/generation, host/daemon/lifetime and route even
without a cached conversation. Foreground content has a bounded local lease.
Registration success alone never grants remote background writer ownership.

Token rotation reuses immutable interest. Cleanup compares registration AND client
revision, including compensating cleanup after a late PUT. A cold token wait is
not a disable; replacement snapshots are unknown, not empty/finished. Local
revocation writes throw before pairing-vault changes can commit. Explicit disable
also ends a restored native handle before its first directory publication.
A build with no signed push environment retains its original local activity type.

Only events and their private publish hop accept512KiB; other requests remain
128KiB. Sources are bounded to100candidates,16members/512aggregate candidates,
8KiB interests,2700byte individual ciphertexts and1,900,000byte aggregate storage. Native
APNs output is checked after final serialization against4KiB. A full100-target
long-Unicode fixture verifies the batch and does not widen command limits.

## Verification

- CLI complete types/tests/build:249passed, zero failures before the final clock
  tolerance correction; final affected7tests, fresh types/build also pass. An
  actual RED/GREEN case aligns phone-created time with the envelope120second
  tolerance, including future-clock refusal. Real pinned official
  SDK legacy and owned wire flows both pass, without notification-interest widening.
- Cloud complete types/tests/Worker+Pages dry-run:202passed, zero failures. Actual
  SQLite objects cover restart, two sources, shared acknowledgements, source revoke,
  late registration, clock skew, token rotation, bounded body parsing, uncertain
  APNs timestamps and irreversible end. Provider transport is synthetic, not Apple.
- Kit complete:554tests,5explicit environment skips, zero failures.
- Final hosted native regression:83passed, zero failures.
- Actual SpringBoard native journeys:2passed, zero failures; pending question
  outranks its running turn, and isolated compact glyph pixels keep moving after
  Home. Source-only DEBUG fixture reconnect ownership and Sendable capture were
  corrected without changing product admission checks.
- Final unsigned Release build succeeds. The main app and all3extensions are
  present; ActivityKit support and13loading fonts/30,040bytes independently verify.
- The real Node publisher's encrypted vector is decrypted by the bundled native
  renderer with an empty conversation catalog; changed lifetime, topic tampering,
  revoked grant and expiry fail closed.
- Read-only important-code review found and closed lifecycle/race/capacity defects;
  its final source review reports no remaining definite P1/P2. No external review
  service, real provider notification, device or Apple account was used.

Initial native UI attempts are retained: a push-unconfigured simulator exposed the
need to keep local creation; a real visible compact glyph exposed a test-only
minimum-width assumption (146.7pt versus177.3pt). The crop now follows actual native
container geometry and still requires isolated moving glyph pixels. Initial
unknown numeric system errors and directory-start timeouts are not erased. The
DEBUG reconnect factory now owns fresh streams for each foreground attempt.

Evidence is outside the repository at
`/Users/yangxiaoming/Documents/MoRemoteAcceptance/notification-content-20261115-eoaqf6yx`:
`remote-activity-cli-accepted-check.log`, `remote-clock-green.log`, `remote-activity-cloud-check.log`,
`remote-activity-kit-check.log`, native xcresults and the source manifest.

## Explicit remaining release boundary

No push-to-start is implemented: a new activity after termination/expiry still
needs the foreground app. Actual device APNs delivery and OS throttling behavior
have not been accepted. Complete rollout requires the corresponding App, CLI and
Worker versions; no new deployment, package publication or TestFlight delivery
was performed. Native APNs has separate alert/activity tokens/topics, so a shared
public event POST does not mean one Apple request or a claimed billing percentage.
