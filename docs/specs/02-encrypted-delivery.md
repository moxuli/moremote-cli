# 02 — Scoped encrypted delivery contract

**Status:** owner-approved first notification/scoped-delivery contract; local implementation pending integration verification
**Date:** 2026-11-10

## Scope and endpoint authority

One pairing joins one companion installation and one phone. A host can own
several independent pairings. Cloud authentication credentials grant access to
bounded relay records only, not official Paseo access. End-to-end authentication
is independent of those cloud credentials.

Use AES-256-GCM and HKDF-SHA256, implemented by standard platform cryptographic
libraries. The companion generates a random 32-byte per-pair root key locally;
only the QR-enrolled phone receives it. The service never receives that root key.
Separate direction/purpose keys are derived with versioned protocol, pairing and
channel context. Use a fresh cryptographically random 12-byte nonce per envelope;
never derive it from clocks, operation IDs or retry counters. Retransmission
reuses the original immutable envelope rather than re-encrypting an operation.

This is an authenticated paired-device channel, not a claim of forward secrecy,
ratcheting or authenticated cloud metadata. A cloud compromise can observe
routing/timing, delay or drop work, but cannot manufacture an accepted encrypted
command. Endpoint compromise is outside that guarantee. Re-pairing creates a new
root key and identities; revocation does not rotate unrelated phones' keys.

## Enrollment

The companion requests a bounded enrollment record and receives separately
scoped host and one-use enrollment credentials. The locally rendered QR contains
the HTTPS API origin, enrollment/pairing identity, enrollment credential, root key,
protocol version and expiry. It contains no official host password or model key.
The proposed offer lifetime is ten minutes.

A phone claim is atomic, expiring and tied to a stable phone-generated claim ID;
a retry of the same claim cannot create another phone. Claiming alone does not
grant execution authority. The companion must verify an encrypted challenge /
phone-acceptance handshake under the QR root key before activating commands.
The phone verifies the companion's matching authenticated response. A service
that knows its own enrollment/authentication tokens cannot complete this proof
without the endpoint key. Unsupported/expired/claimed-by-another offers do not
replace an existing pairing.

Transport uses HTTPS, except explicit loopback development. QR origin changes,
new host associations, key replacement and public network destinations remain
visible user decisions. A mobile host identifier is resolved through its existing
verified identity, never guessed from its display name.

The canonical version-1 enrollment offer is compact JSON
`{version:1,apiOrigin,pairId,enrollmentToken,rootKey,expiresAt}`. Both secret values
are canonical unpadded-base64url encodings of independent 32-byte random values.
The companion's JSON output uses that exact object; the QR/link wraps its UTF-8
bytes as `moremote://enhance#<unpadded-base64url(JSON)>`. The phone can also accept
explicit raw-JSON paste. The offer/root key is never uploaded. Activation binds
only an existing verified daemon server identity, never a host-name match.



### Byte-level version 1

Envelope fields are `version: 1`, lowercase UUID `pairId`, lowercase UUID `id`,
`channel`, integer `issuedAt`, integer `expiresAt`, `nonce`, and `ciphertext`.
Milliseconds are nonnegative safe integers. Channels are `enrollment`,
`activation`, `command`, `receipt`, `state`, `attention`, `control` and
`controlReceipt`, with independent HKDF purpose separation.

HKDF input is the 32-byte endpoint root key. Salt is UTF-8 `MoRemote pairing v1`;
info is the compact UTF-8 JSON array `[1,pairId,channel]`, with quoted strings and
no whitespace. Derive 32 bytes with HKDF-SHA256. GCM additional authenticated data
is compact UTF-8 JSON `[1,pairId,id,channel,issuedAt,expiresAt]`. The restricted
ASCII identifiers and channels eliminate platform-dependent escaping. Nonce and
ciphertext use canonical unpadded base64url. Ciphertext is encrypted bytes followed
by the 16-byte authentication tag. GCM nonce is exactly 12 bytes.

The maximum envelope JSON request is 128 KiB; decrypted command content is at
most 64 KiB. Reject oversized input, invalid/canonical-encoding mismatches,
unknown fields/version/channel, invalid UUIDs and invalid integer/time intervals.
Command/control TTL is300seconds; enrollment/state/attention TTL is600seconds.
Both endpoint enrollment proofs are additionally bounded by the original offer
interval. Receipt/controlReceipt headers attest at current time, with at most
600seconds between issuedAt and expiresAt; serialized minimal envelopes are at
most8KiB. Their ciphertext is retained until the original operation/control expiry
plus24hours for historical authenticated read-only audit, even after revocation.
This does not extend an operation's authority or its original payload TTL.
Clock tolerance is120seconds for future issue times, never expired execution
grace. Recipients check expiry immediately before dispatch. All limits are
centralized documented constants. [04](04-control-and-receipt-lifecycle.md)
specifies control/receipt lifecycle and authenticated revision watermarks.
## Envelope

Every envelope has a protocol version, pairing ID, opaque record/operation ID,
channel, issued-at and expiry milliseconds, nonce and ciphertext including GCM
authentication tag. The bounded fixed-order metadata tuple is authenticated as
additional data. Specify its exact UTF-8 JSON-array representation, base64url
encoding and integer bounds in shared known-answer vectors before code. Never
rely on arbitrary object key iteration or a platform's JSON pretty-printer.

Channels are independently keyed: phone command, companion receipt, companion
state and pairing proof. Unknown version/channel is rejected, not downgraded.
Recipient validates metadata and decrypted identifiers before dispatch. Payload
bounds and TTL checks apply before unbounded parsing or storage.

Plaintext command data contains the exact official conversation ID, action,
request identity where needed and original user content. No arbitrary RPC,
shell script, filesystem action or executable native bridge is accepted.

## Operations

Supported meanings are message send, pending-question response and approval
response. Question/approval content follows the verified upstream schema and is
revalidated against the current request. Transport identity is not an official
permission request ID. Do not infer a request by title/text.

The maximum operation lifetime is five minutes, with a documented
bounded clock-skew allowance. An expired operation cannot become live after a
restart or reconnect. Longer user tasks do not extend a short command's authority.

Cloud acceptance atomically records immutable operation ID and envelope bytes.
An exact retry returns the existing outcome; the same ID with different bytes is
a conflict. Claim/delivery does not mean execution. Relay cancellation/revocation
and relay dispatch serialize on the authoritative record; a cloud DELETE only
confirms that relay boundary, not computer revocation. Independently encrypted
controls and companion-persisted tombstones/receipts establish endpoint facts
as specified in04. Dispatched work is too late to undo; a dispatched-but-
unconfirmed operation never becomes executable again through lease expiry.

The companion durably records its execution boundary before sending an official
mutation. It must not use an SDK's automatic reconnect queue to replay an
uncertain send. On transport loss it reconciles canonical source facts and
reports unknown if acceptance cannot be established. A matching provider message
identity is evidence only when exact target/content and upstream meaning match;
absence from a bounded timeline is not proof the action was never accepted.

## Receipts and state

Receipts distinguish relay accepted, delivered, official admission accepted,
request resolved, rejected, expired, revoked and outcome unknown. Agent task
completion is a different event; a message admission receipt never claims the
agent finished or that the user read its answer.

Cloud-visible transport state is not authoritative execution proof. The phone
accepts execution facts only from the companion's authenticated encrypted receipt
for its exact immutable operation. A receipt cannot be copied to another pairing,
operation or request. Terminal receipts do not regress to queued after restart.

Minimal operation receipts carry a persisted positive revision; the phone retains
an authenticated monotonic watermark. Confirmed admission never regresses to
unknown. Only minimal outcome attestations (identity/revision/state/bounded code)
survive payload TTL for24hours after original expiry, including after revoke.
Historical decoding is read-only and cannot extend command authority. After
retention, the outcome is unavailable/unverifiable, not a cloud-only success.

State is encrypted, size-bounded notification hydration: verified daemon identity
and exact current request forms/bindings only. Directory, titles and usage are
excluded. A stale form is never execution authority; the host must validate the
current occurrence again before an explicit notification response. State is display-only, not an operation
outcome audit: only the latest nonexpired snapshot keeps ciphertext, while each
immutable state ID/digest survives supersession only through that envelope's
original expiry. Exact retries do not renew it; expired snapshots cannot be newly
admitted. State does not inherit the operation/control/attention expiry+24hour
audit window. Those records and minimal authenticated outcomes keep their
original retention unchanged.

## Notifications

Cloud event ingestion accepts only paired companion credentials and bounded
attention kinds/identities, with immutable event dedupe. Push copy is generic by
default. APNs custom data contains only routing/opaque identities and necessary
bounded encrypted state; full prompts/history are never required for an alert.

Own genuine foreground viewing leases may suppress own notifications. A stale
lease expires; companion observation alone never counts as user presence. APNs
sandbox and production registrations are distinct. Invalid-token retirement,
bounded transient retry and ActivityKit update lifecycle use actual Apple results.
No APNs provider private key reaches endpoints or repository files.

APNs custom data includes `pairId`, `eventId`, `kind`, and the full encrypted
attention envelope as `route`. Total serialized UTF-8 payload, including generic
localized `aps`, must fit 4,096 bytes; oversized events are explicitly rejected,
never sent with an omitted route. This allows authenticated read-only navigation
to an already-saved exact host/conversation while offline or after the route's
expiry. Endpoints expose this as a separate authenticated navigation decoder;
it does not execute or renew an expired command, question or approval. The normal
command decoder and recipient pre-dispatch expiry checks remain strict.


## Required evidence

Cross-runtime vectors cover exact encryption/decryption and authenticated metadata;
wrong keys, modified routing, expired envelopes and unsupported versions fail.
State-machine tests cover conflicting reuse, restart at each execution boundary,
revocation races, stale requests and uncertain official acceptance. An isolated
real daemon must confirm adapter event/receipt meanings; local transport tests
cannot prove production APNs HTTP/2 or device delivery.
