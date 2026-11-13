# 04 — Endpoint revocation, request instances and verifiable receipts

**Status:** required implementation corrections from independent specification review
**Date:** 2026-11-10

This capability refines02/03; implementations must apply these requirements before
claiming the first delivery complete. A relay acknowledgement is never endpoint
execution or endpoint revocation proof.

## Endpoint-authenticated control

Add independently derived envelope channels `control` and `controlReceipt` using
the exact existing v1 HKDF/AAD framing. A control has a fresh UUID, at most300s
expiry, and encrypted payload `{type:"cancel",operationId}` or `{type:"revoke"}`.

- `POST /pairs/{pairId}/controls`: phone bearer, `{envelope}`. Accept while active
  or during that pairing's retained revocation state. Exact-ID/bytes retries are
  idempotent; conflicting bytes reject. Persist before replying.
- `GET /pairs/{pairId}/controls`: original host bearer, bounded valid controls.
  Original credentials retain this narrow read/ack surface after relay revocation,
  not permission to admit/dispatch another normal command.
- `POST /pairs/{pairId}/controls/{controlId}/receipt`: original host bearer,
  `{envelope}` with channel controlReceipt and ID controlId. Encrypted receipt is
  `{controlId,type,operationId?,state,revision}`; state cancelled|revoked|tooLate,
  revision is1. This is one immutable final sealed result: persist before ack;
  exact retry succeeds, different bytes return409. No visible revision is required.
- `GET /pairs/{pairId}/controls/{controlId}`: original phone bearer, returns
  `{ok:true,control:{controlId,envelope,receipt,expiresAt}}` while retained.
- List response is `{ok:true,controls:[{controlId,envelope,receipt,expiresAt}]}`.

Phone sends encrypted control before issuing existing cloud DELETE (the latter
stops honest relay dispatch immediately). Cloud DELETE alone returns relay
revocation/cancellation facts only. The phone reports endpoint-confirmed state
only after verifying the exact companion controlReceipt. When the computer is
offline or the relay withholds a control, show waiting/unknown rather than claim
instant endpoint revocation. An already dispatched action returns tooLate; it
cannot be undone. These physical limitations do not justify a false success.

Companion processes controls before ordinary dispatch in each acquisition cycle,
and persists pair/operation tombstones before producing authenticated receipts.
Recheck local tombstones immediately before daemon I/O. Pair revocation disables
all subsequent local dispatch, independent of any later cloud active flag. A
crash after local revocation cannot restore execution. Persist the sealed control
receipt so it can be retransmitted without retaining executable authority.

Revoked pair records keep original hashed role credentials only for narrow control
receipt and minimal outcome reads, for the documented24h retention. Remove device
registration, viewing leases, snapshots and user-message ciphertext immediately.
Do not erase the only outcome evidence while claiming durable verifiability.
Endpoint key material needed for read-only final verification remains protected
until acknowledgement/retention cleanup; no automatic re-enrollment.

## Exact permission/request-instance binding

Every pending request offered for enhanced question/approval use has an opaque
`requestBinding` (canonical base64url32bytes) created by the companion. Include it
inside authenticated attention/state. Permission command plaintext becomes
`{type:"permission",agentId,requestId,requestBinding,response}`.

Binding represents the exact observed request occurrence, kind, original input,
advertised actions and suggestions. The companion stores an occurrence identity
and canonical source fingerprint, and derives an authenticated pairing-specific
binding. The phone echoes it unchanged, not recomputes or chooses an occurrence.

On connection-generation change, resolution/removal or any canonical source
change, retire the old occurrence/binding. If continuity cannot be established,
require fresh state and a new user decision; an old notification still navigates
read-only but cannot approve a replacement. Before dispatch, refresh the actual
pending request, match its binding/source and validate the selected actual action.
Do not depend on requestId never being reused.

Request notifications use the exact current occurrence's first-observed clock,
independent of a task's older completion or global attention timestamp. Keep that
clock stable across repeated observations. A request/resolution event or a newer
accepted observation fences older in-flight reads of that agent before journal
synchronization or notification; delayed responses cannot recreate a retired
occurrence, replace newer authority or supply a fresh notification clock.
The official adapter owns synchronization into its exact journal; binding callers
do not observe the returned request array again. They match its generation/source
fingerprint and recheck currentness after binding. Queued internal request events
capture their occurrence when observed, so delayed draining cannot attach an old
event's clock to a replacement occurrence or consume its notification identity.

Reject response fields outside the real upstream response shape. Any remembered
permissions must be an actual offered suggestion explicitly selected by the user;
never accept an arbitrary new grant or silently set remember. Edited input is
limited to existing editable string fields plus supported question answers.

### Question response wire mapping

Question replies use the same permission command, not a new send and not an
unknown `reply` operation. The exact target's kind must be `question`. The native
codec's upstream response is `{behavior:"allow",selectedActionId?,updatedInput}`,
where updatedInput preserves the original input and adds
`answers:{[originalQuestionHeader]:answerString}`. Use a currently advertised allow
action. All required questions must have valid answers; choices/multi-choice and
allow-other/allow-empty follow the original typed form, not an invented codec.

A notification text reply may answer a single supported question only if its
actual form permits that text. Multiple/unsupported structured questions open the
native original request form; do not duplicate the same text into several answers
or map it to a newer request. The companion validates the original question schema
again before sending the real official permission response. Explicit deny uses
its actual offered action and original request binding.

## Enrollment expiry

Claim, companion activation and both endpoint proof validation are bounded by
the original offer expiresAt, not a renewed proof TTL. Proof issuedAt/expiresAt
must fall within that offer's interval. A claim made just before expiry cannot
be activated after expiry. Retry never extends enrollment authority. An already
completed activation can be read/audited later without re-executing enrollment.

## Monotonic minimal receipts

Every encrypted operation receipt adds positive integer `revision`, persisted by
the companion before transmission and monotonically increasing per operation.
POST receipt also carries matching visible revision; it is not execution proof.
The cloud rejects a lower revision and conflicting same-revision bytes. The phone
persists its authenticated revision watermark and rejects older/replayed outcomes.
Exact duplicate same revision is harmless.

Receipt and controlReceipt envelopes use issuedAt=current attestation time and
expiresAt no later than issuedAt+600000ms, independently of original execution
TTL. Their serialized envelope maximum is8KiB (normal requests remain128KiB).
Retention is always anchored to original operation/control expiresAt+24hours;
fresh reconciliation never renews payload authority or that retention deadline.

Receipt/controlReceipt POST is read-only attestation admission, not action
admission. An immutable sealed receipt may be uploaded for the first time, or
retried unchanged, after its own header expires while its original operation/
control record remains inside the original expiry+24h audit window, including
after pairing revocation. Do not reseal or refresh bytes merely because an upload
was lost. An expired header alone is not a rejection reason on these two receipt
POST surfaces. Exact ID/pair/channel/version/field schema,8KiB size, at-most600s
header interval, future issuedAt skew, original role, operation revision/state
progression and fixed parent-retention checks remain mandatory. A final
controlReceipt remains one immutable revision1 result. At or after the original
retention deadline, an absent/purged parent is unavailable and cannot be recreated
by a receipt upload. Command/control/enrollment admission and actual action
dispatch still enforce live authority; historical receipt acceptance never
executes, renews, restores user ciphertext or extends any retention deadline.

A positive official admission fact cannot regress to unknown. For sends, accepted
means confirmed admission only; task completion is separate attention/state.
Unknown may become accepted/resolved/rejected only from positive reconciliation.
Accepted never becomes unknown merely because a later task wait/socket fails.
Resolved/rejected remain terminal. Permission resolution requires matching
current-instance authoritative resolution, not a changed pending-set guess.

Minimal receipt ciphertext contains only operation/control identity, revision,
state and bounded error code; no prompt, full request, file or history. Retain it
24h after the operation/control's original expiry, independently from short-lived
command ciphertext. The original phone may read and authenticate it after revoke.
Historical receipt authentication permits read-only audit past its action expiry;
never dispatch an expired operation because an audit decrypt succeeded. After
retention expires, report unavailable/unverifiable, never trust a naked cloud
success state as proof. Keep last positively verified local facts with their
original timestamps and no renewed authority.

## Attention invalidation

Add `POST /pairs/{pairId}/attention/{eventId}/resolve`, host bearer, with bounded
`{resolvedAt}`. It is idempotent and stops queued/retry attempts for the exact
known attention event. Companion invokes it on matching request resolution,
replacement or authoritative no-longer-requires-attention facts. Never clear
real official attention just to acknowledge our relay event.

Resolution competes transactionally with retry selection. An APNs request already
in flight cannot be retracted; old notifications must revalidate binding before
acting, and may still navigate read-only to the original conversation. Do not
claim a local resolve API erases a notification already displayed by iOS.

## Required regression cases

- Lost/withheld revoke reaches cloud but not companion: no endpoint-confirmed UI.
- Revoke/cancel persisted locally survives restart and blocks later dispatch;
  already-dispatched cancellation is tooLate, not falsely cancelled.
- Same requestId with changed action/input or a new connection occurrence rejects
  the former requestBinding; genuine same instance maps exact question answers.
- Claim at offer deadline minus1ms, activation after deadline is rejected at both
  endpoints even if an independently timestamped proof looks fresh.
- Accepted revision2 followed by unknown revision1 never loses admission proof.
- APNs transient failure then matching resolution before retry sends no stale retry.
- Phone returns after message TTL but before minimal-receipt TTL: verifies the
  endpoint-authenticated result, including after revoke; after retention, reports
  explicitly unverifiable outcome instead of trusting cloud state.
