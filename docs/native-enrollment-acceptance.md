# Native enrollment and request delivery acceptance

Date: 2026-11-13. Scope: unpublished source candidate with an unmodified official Paseo0.15.4 development daemon and its built-in mock provider, an isolated computer home, production cloud transport and a physical iPad. No paid model or ordinary user conversation was exercised.

## Observed results

- The native app retains its existing official host connection. An installed companion exchanges the per-phone offer over official authenticated file APIs and activates the production endpoint without another QR code or pasted invitation. An explicitly disabled previous endpoint still requires deliberate re-enablement; disabled history is not silently overwritten.
- A pending endpoint initially receives409 from active-only control routes. Runtime must validate official identity and original enrollment authority, activate in an activation-only cycle, and acquire fresh controls on the next cycle before commands or state publication. The production continuation activates the original pending offer after this correction.
- Official request snapshots can retain an older completion attention timestamp/reason while containing a new pending approval. Request notification authority therefore uses the persisted current occurrence, independently of that global completion hint. Unchanged occurrences retain their original clock and immutable notification bytes; resolution/replacement must not renew old authority.
- A real production permission notification opens the exact native request-review surface. Approve and deny are exercised on two distinct, still-pending official mock requests. Each produces one official resolution, no remaining pending request, and a resolved companion operation with revision1 acknowledged to cloud. Notification invalidation is acknowledged once for each occurrence.
- Production task tracking creates a subscription; a genuine terminal APNs activity update renders on the iPad and opens the exact task. Foreground terminal cleanup removes the subscription.

## Focused local proof

The stricter pending-endpoint fixture reproduces the activation deadlock before repair. The focused enrollment selection passes22 tests; the existing runtime quota-pause consumer also passes with the controls-first fence. Three real SDK request-notification wire consumers reproduce stale completion hints, absent attention flags and stale permission clocks. The final selected notification/attention/official-wire set passes14 tests, typecheck and build. These are scoped results, not a claim that all later concurrent release-candidate changes were checked here.

## Deliberately incomplete claims

An unlocked Notification Center text reply is submitted once, but native status remains unknown and no corresponding companion execution is observed. It is not replayed or reported as delivered. A hardware lock command has no conclusive lock-state evidence; this is not locked-reply acceptance. Full foreground/background/terminated delivery, cancellation, ActivityKit token rotation, widget remote token lifecycle, Siri, physical Action Button and interrupted file-share coverage remain separate gates. The test iPad has no physical Action Button.

Keep real task/host identifiers, endpoint tokens, device exports and raw receipts outside this public repository. Production deployment and cost limits are unchanged. No npm, TestFlight or cloud release is established by this document.
