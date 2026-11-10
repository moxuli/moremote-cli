# 03 — Relay HTTP API, version 1

**Status:** implementation detail of the owner-approved first notification/scoped-delivery iteration; review against the accepted architecture before coding

## Common rules

Base path is `/v1`. JSON is UTF-8 with bounded body parsing (128 KiB). Responses
use `{ok:true,...}` or `{ok:false,error:{code,message}}`; errors contain concise
codes, never raw private payloads. TLS is required except explicit loopback dev.
UUID identifiers are lowercase canonical strings. Timestamps are integer epoch
milliseconds. See [[02-encrypted-delivery]] for exact envelopes.

Bearers are independent32-byte random canonical unpadded-base64url capabilities.
Persist only SHA256 over the UTF-8 bytes of that canonical bearer TEXT, not the
decoded random bytes; serialize hashes as lowercase64-character hex. Compare
fixed-length hashes without early exit. Host, enrollment and phone roles are distinct. Companion-host authentication
is not an official daemon credential. Unauthenticated enrollment creation is
bounded by configured per-origin/IP rate and record limits; an arbitrary ID is
never read authority. No permissive CORS or browser-cookie authentication.

An API origin is operator/application configuration, never derived from a signed
host's human-readable name. Loopback plaintext requires explicit development
configuration at both endpoints; ordinary enrollment rejects plaintext URLs.

## Enrollment

### POST /pairs

Companion creates local UUID `pairId`, root key and host/enrollment capabilities.
Body: `{pairId,hostTokenHash,enrollmentTokenHash,expiresAt}`. Hashes are lowercase
64-character SHA256 hex; expiry is at most ten minutes from now. Creation is
atomic and rejects a conflicting identity, including after revocation. Exact
same-configuration retry returns the same enrollment state without allocating
another record. No endpoint key is transmitted. Host bearer proves subsequent
ownership. Server refuses an already expired offer.

### POST /pairs/{pairId}/claim

Enrollment bearer. Body: `{claimId,phoneTokenHash,proof}`. Phone generates and
retains its token and claim ID before the first request. `proof` is an enrollment
channel envelope with ID `claimId`; encrypted JSON is
`{type:"phoneHello",claimId,phoneTokenHash}`. One claim wins atomically. Exact
retry by the same claim/token/proof succeeds; changed bytes or another claimant
conflict. The server records only a pending phone, not execution authority.
Proof issuedAt/expiresAt must be within the original offer interval (no earlier
than expiresAt minus600seconds and no later than the original offer expiresAt).

### GET /pairs/{pairId}

Host or phone bearer. Returns role-appropriate bounded pairing state. Host sees
pending claim ID/token hash/proof. Phone sees pending/active/revoked and the
activation proof, not host credentials. Enrollment bearer cannot read this API.
The companion verifies the phone proof under its endpoint key and confirms that
the decrypted token hash matches this exact pending claim.

### POST /pairs/{pairId}/activate

Host bearer. Body `{claimId,proof}`. Activation envelope ID equals `claimId`,
channel `activation`. Encrypted JSON contains `{type:"companionHello",claimId,
phoneTokenHash,daemonServerId,hostName}`. An exact active retry is idempotent.
Changed claim/proof conflicts. Companion locally persists its accepted phone
before any official mutation; phone independently decrypts/validates the proof
before trusting cloud active state. App associates only an exact authenticated
saved host identity, not a name match.
Activation must complete before the original offer expiry and its proof must be
inside that original interval. A completed exact retry is audit only, never an
expiry extension. Endpoint proof validation applies the same original deadline.

### DELETE /pairs/{pairId}

Host or phone bearer. Revokes relay authority for the exact pairing and queued
operations. Returns `{ok:true,status:"revoked",authority:"relay"}`, never endpoint
confirmation. Other pairings remain unchanged; dispatched official writes cannot
be undone. Remove device, viewing lease, snapshot and user-message ciphertext
immediately, but preserve minimal encrypted receipts and narrow original-role
control/outcome access through retention. The phone first sends the encrypted
revoke control described in04 and waits for its exact authenticated companion
controlReceipt before reporting computer-confirmed revocation. Offline or withheld
controls remain waiting/unknown. Host stop/uninstall can stop local execution
without contacting cloud.

## State and attention

### PUT /pairs/{pairId}/state; GET /pairs/{pairId}/state

Host writes, phone reads. Body/response contains `{envelope}` with `state` channel.
Only the latest nonexpired snapshot is retained, monotonic by issuedAt then
immutable ID. Exact retries succeed; conflicting IDs/older snapshots never
replace newer state. Encrypted state is a versioned object with verified daemon
identity, host name, measured timestamp and bounded actual tasks/available usage.
No complete chat, code files or credentials.

### PUT /pairs/{pairId}/device

Phone bearer, active pairing. Body `{token,environment,locale}`; token is bounded
nonempty hex, environment `sandbox|production`, locale `zh-Hans|en`. The service
binds to the configured app topic, not an arbitrary caller-controlled bundle.
Device replacement invalidates only the former exact token/environment. Registration
never requests notification permission from the server side.
Keep one current registration per active pair without age-based expiry: a phone
staying background24hours does not invalidate an APNs token. Replacement, exact
authoritative provider invalidation or pair disable/revoke removes it. An internal
unique registration identity prevents stale retirement even when token/environment
and millisecond registration timestamps are equal.

### PUT /pairs/{pairId}/presence; DELETE /pairs/{pairId}/presence

Phone bearer. Put `{topic,expiresAt}` where topic is a keyed opaque conversation
tag and lease lasts at most60seconds. Clear on scene inactivity or route exit;
refresh only while genuinely viewing the exact conversation. Topic is base64url
HMAC-SHA256 using a separately HKDF-derived `presence` key over UTF-8 agentId;
HKDF info is compact `[1,pairId,"presence"]`. Companion computes the same tag.
No official heartbeat/read acknowledgement is sent by the companion.

### POST /pairs/{pairId}/attention; GET /pairs/{pairId}/attention/{eventId}

Host writes, phone reads exact event. Body `{id,kind,topic,envelope}`; kind is
`finished|question|permission|error`, envelope channel `attention` and ID `id`.
Encrypted content contains `{agentId,requestId?,requestBinding?,kind,timestamp}`;
question/permission attention includes the exact companion-issued requestBinding.
Event identity is stable across reconnect/retry. Exact retry does not send another
push; conflicting bytes are rejected. Only currently valid events get attempts.
Suppress this app's push if a genuine unexpired matching presence lease exists.
No inference from the official shouldNotify flag. APNs copy is generic/localized.

Persist notification attempt state before I/O. A lost APNs response is uncertain,
not proof of failure; retries reuse the same apns-id/collapse identity with bounded
backoff/expiry and do not promise exactly-once display. Retire a token only if it
still equals the exact failed registration and APNs result is authoritative.

Logical event outcome is separate from the latest attempt result and retry
eligibility. Persist an unresolved-attempt marker before provider I/O. A later
definite rejection, unavailable configuration/registration, presence suppression,
retry-budget limit or payload expiry cannot disprove an earlier request whose
response was lost: retain logical `uncertain` and stop scheduling independently.
An actual provider acceptance can establish `accepted`; explicit resolve/revoke
remain lifecycle transitions and do not claim to retract earlier notifications.
Known first-attempt failures stay known failures, not blanket uncertainty.
`delivery.reason` describes the latest observed attempt, not proof that an
earlier uncertain attempt was rejected. Expired ciphertext is still removed on
schedule while the bounded delivery outcome identity remains.

## Scoped commands

### POST /pairs/{pairId}/commands

Phone bearer, active pairing. Body `{envelope}` with `command` channel. Plaintext
is `{type:"send",agentId,text,messageId}` or
`{type:"permission",agentId,requestId,requestBinding,response}`. For send, `messageId` equals
envelope ID. Permission response is the verified upstream response shape, with
current-request/action validation on the companion; no arbitrary RPC escape.
The recipient rejects unknown types/fields and content outside supported bounds.
The binding identifies the exact observed request occurrence, original input and
actual actions, not merely requestId. Question replies use the current question's
permission response and original-header answer mapping defined in04, not a new
send or arbitrary reply RPC. Endpoint validation retires changed/replaced bindings.

Accept an exact immutable retry idempotently. A same-ID different-envelope retry
is409. New work cannot override terminal records. Admission is not execution.

### GET /pairs/{pairId}/commands

Host bearer. Returns a bounded page of available valid operations and pending
state; it does not create user presence or imply execution. Expired operations
are ineligible before response. Polling uses bounded backoff; no busy loop.

### POST /pairs/{pairId}/commands/{operationId}/dispatch

Host bearer. Atomically acquires the irrevocable execution boundary if operation
is active, nonexpired and not revoked/cancelled. Returns `dispatchAllowed:true`
only on the first successful transition. Repeated calls return the existing state
with `dispatchAllowed:false`. A crash after the boundary never reauthorizes a
second official write. The companion writes its local dispatch journal before
requesting this transition and never writes the daemon if the response is lost.
Unknown outcome is reconciled rather than resent.

### DELETE /pairs/{pairId}/commands/{operationId}

Phone bearer. Cancels only relay work not dispatched. Returns explicit cancelled
or too-late plus `authority:"relay"`; it never confirms endpoint cancellation or
undo. The phone first posts an authenticated encrypted cancel control and trusts
only the companion's exact sealed controlReceipt for computer-confirmed state.
Revocation blocks future relay dispatch but preserves minimal outcome evidence.

### POST /pairs/{pairId}/commands/{operationId}/receipt

Original host bearer, including narrow post-revoke reconciliation. Body
`{state,revision,envelope}`; state is `accepted|resolved|rejected|unknown`, revision
is a positive safe integer. Receipt-channel envelope ID equals operationId and
decrypted plaintext is `{operationId,state,revision,code?}`. Visible revision must
match encrypted revision at endpoints. Cloud rejects lower revisions and same-
revision conflicting bytes; exact retries are harmless. Admission accepted is not
agent completion. Allowed transitions: dispatched→accepted/resolved/rejected/unknown;
accepted→resolved/rejected; unknown→accepted/resolved/rejected after positive
reconciliation. Resolved/rejected are terminal. Never regress accepted to unknown.
The phone validates an authenticated persisted revision watermark and trusts the
minimal encrypted receipt, not cloud state. Details and question resolution rules
are in04.

This receipt POST accepts a first upload or unchanged retry after the receipt's
own header expiry while the original retained operation still exists before its
fixed expiry+24h deadline. It admits read-only historical attestation, never a new
action. Preserve the original sealed bytes; do not reseal to refresh transport.
All role, framing,8KiB size, at-most600s header interval, future-issue skew,
revision and state-transition checks still apply. A purged parent stays404; no
payload authority or retention is renewed. See04 for the shared historical rule.

### GET /pairs/{pairId}/commands/{operationId}

Original phone or host bearer, including narrow post-revoke outcome access.
Returns original envelope while live, transport state, revision and retained
minimal encrypted receipt. Command ciphertext expires at original TTL; receipt
ciphertext survives until original command expiry+24hours, independently of its
own600second header interval. Historical authentication is read-only. After
retention the record is404/unavailable, never an unverifiable cloud-only success.

## Retention, restart and testing

All authoritative transitions persist transactionally in SQLite-backed Durable
Objects. In-memory maps alone cannot establish dedupe, claim or revocation.
Payload TTL is not extended by read/retry. Expired payloads and device/presence
state are actively cleaned; bounded terminal/tombstone retention is24hours after
expiry. Keep no private body in HTTP logs or diagnostics. Limit per-pair operation
and attention counts; errors are explicit rather than silent eviction of live work.

Wire vectors and conformance tests are copied as versioned public protocol data
into independent endpoint repos; runtime imports must not reach sibling projects.
Local checks exercise actual Worker storage semantics, endpoints and companion
crypto/action transitions. No assertion that a local emulator is a production
APNs connection or real device delivery is permitted.

## Exact response names and notification routing

Successful responses carry `ok:true`. First pair creation returns
`{ok:true,pairId,status:"pending"}` (`201`). An exact existing retry is200 with
status `pending|active`; revoked/expired offers conflict409, never succeed with
those statuses. Claim returns `{ok:true,status:"pending"|"active",claimId}`;
there is no `claimed` status. Activation returns `{ok:true,status:"active"}`.
Revocation returns `{ok:true,status:"revoked",authority:"relay"}`.
`GET /pairs/{pairId}` returns:

```json
{"ok":true,"pair":{"pairId":"11111111-1111-4111-8111-111111111111","state":"pending","pendingClaim":null,"activationProof":null}}
```

Pair `state` is `pending|active|revoked|expired`. Only the host sees a non-null
`pendingClaim:{claimId,phoneTokenHash,proof}`. Phone reads always receive null for
that field. Both authorized roles see `activationProof:Envelope|null`, bounded by
its original expiry. Neither response includes host/enrollment bearer material.
The QR/raw JSON offer encoding is specified in02 and is never a cloud payload.

Command POST and exact GET return flattened fields
`{ok:true,operationId,state,digest,envelope,receipt,revision,expiresAt}`. Both encrypted
fields are `Envelope|null`; `digest` is a lowercase SHA256 hex digest of the
immutable accepted JSON body. Transport `state` is
`queued|dispatched|cancelled|expired|revoked|accepted|resolved|rejected|unknown`.
GET commands returns `{ok:true,commands:[<same command fields without ok>],
hasMore:boolean}`; the first32 available operations are ordered by expiry then
ID. After processing that page, polling exposes remaining queued operations.
Dispatch adds `dispatchAllowed:boolean` to the exact-command response. Cancel
adds `outcome:"cancelled"|"too-late"`. Receipt POST takes
`{state:"accepted"|"resolved"|"rejected"|"unknown",revision,envelope:<receipt>}`
and returns the exact-command response. A late positive reconciliation may update
minimal authenticated receipt/state after payload expiry/revocation, but never
restore user ciphertext or extend retention. Both DELETE responses explicitly
carry `authority:"relay"`; endpoint confirmation requires the04 control receipt.

State PUT/GET returns `{ok:true,envelope:Envelope|null}`; device PUT returns
`{ok:true,registered:true}`; presence PUT returns `{ok:true,expiresAt}`, and DELETE
returns `{ok:true,cleared:true}`. Attention POST/GET returns
`{ok:true,id,kind,topic,envelope,digest,resolvedAt,delivery:{state,attempts,reason?}}`.
Delivery states are `queued|inflight|retry|uncertain|accepted|rejected|unavailable|
suppressed|expired|revoked|resolved`; they never assert display or acknowledgement.
Missing configuration is `unavailable`, not provider acceptance.

APNs custom data is exactly `pairId,eventId,kind,route`, beside generic localized
`aps`. `route` is the original attention envelope, never a plaintext conversation
identifier. Attention ingestion rejects any event whose complete alert payload
would exceed4,096 UTF-8 bytes in either supported locale (`413`,
`apns_payload_too_large`), even before a device registers. No route is silently
omitted. The phone may authenticate/decrypt this envelope through an explicitly
read-only navigation path after expiry, to open an already-verified saved host
and conversation without a live cloud lookup. This never authorizes a mutation
or bypasses expiry/current-request checks on an action.

## Bounded identity non-resurrection policy

Revocation immediately removes device/presence and user-message/snapshot payloads.
Minimal authenticated receipt ciphertext remains separate. It retains
pair authentication hashes and operation outcome identities until at least
24hours after revocation and each retained child's original expiry. Terminal
records are then purged by alarms; this is not an eternal global UUID blacklist.
An identical old create request cannot recreate authority after purge: its
original ten-minute offer expiry is past and creation returns400. Old claim and
activation proofs are independently expired, and an old QR is never a fresh
enrollment instruction. Endpoints always generate new pair IDs, independent root
keys and capabilities for explicit re-pairing, and demand the fresh authenticated
handshake. An operator cannot claim perpetual global UUID non-reuse after the
bounded metadata has been deleted.

## Endpoint controls and invalidation routes

[04](04-control-and-receipt-lifecycle.md) specifies authenticated control semantics
and exact encrypted plaintext. HTTP responses are:

- `POST /pairs/{pairId}/controls`, phone `{envelope}`: `201` first, `200` exact
  retry; `{ok:true,control:{controlId,envelope,receipt,expiresAt}}`.
- `GET /pairs/{pairId}/controls`, original host:
  `{ok:true,controls:[{controlId,envelope,receipt,expiresAt}]}`, at most32 live
  unacknowledged controls, ordered expiry thenID.
- `POST /pairs/{pairId}/controls/{controlId}/receipt`, original host `{envelope}`:
  `{ok:true,control:{controlId,envelope,receipt,expiresAt}}`; exact retry succeeds,
  different bytes409. A controlReceipt is one final encrypted revision1 result.
- `GET /pairs/{pairId}/controls/{controlId}`, original phone: same wrapped control.

Control envelopes have at most300seconds authority. Minimal receipt envelopes
have at most600seconds header interval, current attestation issuedAt and8KiB
serialized maximum. They remain available for historical verification until the
original control expiresAt+24hours. Original host/phone capabilities retain only
these surfaces, pairing status and exact command outcome/receipt reconciliation
after relay revocation; no new normal command or positive dispatch is admitted.

The controlReceipt POST has the same historical first-upload allowance: an
immutable sealed final receipt can arrive after its own header expires only while
the original control audit record remains retained. It cannot recreate a purged
control, change final bytes or extend original expiry+24h. Normal control POST,
command/enrollment admission and action dispatch retain strict live checks.

`POST /pairs/{pairId}/attention/{eventId}/resolve`, host `{resolvedAt}`, returns the
same attention view with the first persisted `resolvedAt` and
`delivery.state:"resolved"`. It stops future queued/retry selection transactionally.
An existing APNs request cannot be retracted. Already displayed notifications
still require current requestBinding validation before any action.

Generic alerts set `aps.category` to `moremote.enhancement.<kind>`, exactly one of
`finished|question|permission|error`. Permission actions open foreground review
only. Question text replies require the actual supported single-question form
and exact binding; unsupported forms open original review. Categories grant no
authority beyond explicit user action and strict endpoint validation.

## Public admission and interoperability bounds

All pair routing first consults a bounded admitted-ID catalog; an arbitrary UUID
read must not instantiate a new pair Durable Object. Only create admission can
reserve a new identity. The current centralized policy allows30 create attempts
(including exact-ID retries) per origin/trusted-IP hash per one-hour window,
10,000 admitted routable pair IDs, and10,000 concurrent source counters. Active
pairs remain catalogued; fixed internal retention probes retire expired records.
This is not a public arbitrary-target proxy and does not imply a complete
provider traffic/billing ceiling. Production ingress abuse/budget policy and
trusted client-IP propagation through Pages are explicit operator gates.

The public synthetic bearer framing vector uses43 literal `A` characters:
`AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`. SHA256 of its UTF-8 text is
`0f007385b6f9d4b7eeb2748605afe1a984a0a3bfa3f014d09e2a784ce9e5cd1a`.
SHA256 of the decoded32zero bytes would be
`66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925`,
which is explicitly the wrong framing. Versioned fixture
`tests/vectors/bearer-v1.json` was generated independently with Node:crypto.
This fixed public value is never a usable production credential.

## Response byte budget

The128KiB bound applies to JSON requests, not responses. Every complete JSON
response is at most5MiB (5,242,880 UTF-8 bytes), enforced by the service and
independently bounded by clients before parsing. Commands/control lists have at
most32 entries;32 near-maximum envelopes can approach4MiB. Exact command reads
may contain both original128KiB-bounded payload and a separate8KiB receipt; a
host pairing response may contain two bounded proofs. A128KiB response reader
would permanently reject valid work and is nonconforming. This larger response
budget never raises the128KiB request or64KiB decrypted command-content limits.
