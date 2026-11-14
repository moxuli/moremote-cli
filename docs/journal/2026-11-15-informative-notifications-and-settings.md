# Informative encrypted notifications — local, unreleased

## Root cause and correction

Released alerts contain generic provider copy; the app had no notification service
extension. Renaming that fallback cannot identify a private conversation without
endpoint display support. Attention now optionally carries separately encrypted
bounded session/computer/current-content presentation, with unchanged legacy
route plaintext, exact identity, independent nonce, expiry and durable retries.
Only current assistant prose or exact current questions/approvals/errors enter
presentation. Generated UI source, reasoning and tool output are excluded.

The official SDK may optionally read one30-entry canonical tail per completion,
with five-second timeout and two concurrent tails. Live and snapshot/reconnect
recovery use the same current-turn/terminal identity fence; recovery does not
block control/directory polling. Existing successful authenticated relay responses
passively advertise support; old relays receive legacy events without another
request. Once journaled, the original exact bytes remain immutable.

## Evidence and review

The added presentation tests initially failed against the absent module. The real
SDK recovery-body regression then failed against the empty snapshot preview; its
final legacy/owned wire tests pass2/2, including independently decrypted durable
preview and unchanged legacy route. Full frozen `npm run check` passes types,
243 tests with zero failures and compilation. The first full run had one timed
quota fixture failure under concurrent load; the exact isolated test passed, and
this fresh complete243-test run is the accepted final gate. No assertion or
production timeout was weakened.

Independent read-only review found the recovery omission and an app workspace
name precedence issue. Both are fixed and independently re-reviewed. Three
external-provider attempts produced no usable review (account hold, network reset,
timeout); the completed independent-context review is not a multi-vendor approval.

## Boundary

Source remains on `fix/notification-content-1115`, unreleased after0.1.6. No
package/tag publication, real everyday service installation or real host/session
mutation occurred. Cloud/APNs transport and physical extension display are
separate acceptance gates; tests use synthetic wire/keys/temp journals only.
