# 05 — Endpoint and lifecycle behavior

## Single-pairing local enrollment v1 — unreleased

Normal users pair only official Paseo. Explicit `setup --yes` authenticates the
existing official daemon, enables automatic enrollment/cloud and installs/starts
only the existing owned CLI per-user service. Stop/reload only owned CLI state;
preserve custom origin/target, active/revoked pairs and update preference. An
absent API origin selects the built-in production HTTPS endpoint. Source checkout
without managed state binds its current frontend and manual-update policy;
installed packages/retained managed state use capability-aware exact-current
setup migration before enabling enrollment, retaining prior packages and update
opt-out while selecting an enrollment-capable active/bootstrap. Unavailable or
incapable current packages fail explicitly without cloud opt-in. Manifest
`localEnrollment:1` and `configBytes:524288` declare that capability.
`check`, `status` and config reads remain passive. Manual `pair` is expert-only.
No official modifications, new listener, hidden terminal/workspace, model prompt,
new relay, global upgrade or package publication is part of this protocol.

Discovery tree:

```text
<home>/.moremote-cli-connect/<sha256(UTF8 daemonServerId)>/
  descriptor.json
  requests/<request UUID>.json
  responses/<request UUID>.json
```

Parent, daemon and request/response directories carry owned markers and are
ordinary owned POSIX0700 directories. Descriptor/responses are0600. Requests
created by the official file API may be0644 inside their private parent.
Windows relies on the user profile ACL. Reject symlinks, hardlinks, foreign
markers/users/types, response collisions and competing runtime ownership.
One marked daemon directory binds to the exact CLI state directory. Its own
exclusive PID/instance lock can be reclaimed only after the recorded process
is dead; this lock never authorizes signalling another process. No new socket
is created. Existing runtime ownership serializes config/cycle work.

The app obtains the actual home through official `directory_suggestions_request`
with query `~/././.`, preserving Windows path joining. A <=4096-byte descriptor is
exactly:

```text
{version:1,daemonServerId,instanceId,apiOrigin,enabled,measuredAt,expiresAt}
```

`instanceId` is a lowercase UUID. Times are safe integer Unix milliseconds.
`apiOrigin` is the configured/default validated canonical HTTPS origin, pinned
over the already authenticated official file channel. Descriptor lifetime is90s,
renewed no faster than30s; disablement can remove resources or publish disabled
without granting a new enabled lease. This is not a cloud heartbeat.

After validating the original authenticated host/session/generation and fresh
descriptor, the app durably retains one exact immutable UTF-8 request before
official create/read-revision/write. Empty files are unfinished creates, not
admissions. Unknown outcomes read the same exact path and never mint another
request identity. Request <=4096bytes:

```text
{version:1,id,clientId,daemonServerId,issuedAt,expiresAt}
```

IDs/client IDs are lowercase UUIDs; lifetime is at most600000ms, with no future
issuance or expiry grace. At most16 files are consumed per cycle with a rotating
cursor, and the existing16-pair ceiling remains. A durable record saves exact
bytes/fingerprint, original pair/canonical offer and exact cloud-create JSON
before I/O. Lost creation acknowledgements retry those identical bytes through
the unchanged relay's exact-offer-digest idempotency. A confirmed creation is
saved before any secret response. Changed bytes/client/daemon/expiry cannot
replace authority. A client with a current live endpoint cannot manufacture
another by changing its request ID. Old exact revoked/retired requests remain
disabled; an explicit fresh app Enable request can create a new independent
endpoint after retirement. Existing pairs are never reused or revived.

At most one cloud-create attempt runs per serialized cycle, independently aborted
after3s; no optional admission may accumulate sixteen20s cloud waits ahead of an
existing phone's commands. Requests retain original authority across that abort.

Response <=8192bytes:

```text
{version:1,id,clientId,daemonServerId,expiresAt,status,offer?,code?}
```

Status vocabulary is `pending|offer|active|disabled|error`. Only `offer` carries
the original canonical version1 offer defined below. Its origin must exactly
match the authenticated descriptor pin. Response expiry never exceeds either
original request or offer expiry. Pending/unknown cloud creation has no secret
response. Invalid/conflicting/foreign files fail closed without overwriting
them; the normal runtime reports only a redacted cycle failure. Disabled/retired
admitted requests can receive a nonsecret disabled response. The app stages and
claims automatically, without an offer-review screen, using the unchanged
phoneHello/companionHello proof and independently verified daemon identity.

Activation removes the owned request/private response. Expiry removes them and
their durable enrollment record; existing pair/audit retirement is unchanged.
Stop removes only owned responses/descriptor/lock, retaining exact request/pair
authority for restart until original expiry. Explicit cloud-off removes secret
responses and never creates another pair. Automatic observation is bounded by
the app to10 response reads over at most30s; a later foreground refresh retains
the same exact request. No forever polling, recursive requests or cloud pairing
on each launch.

Implementation APIs are `LocalEnrollment.cleanup/cycle/close`,
`EnrollmentFiles`/`discoveryDirectory`, `setupEnrollment`, and the explicit
`EnrollmentRequest`, `EnrollmentOffer`, `EnrollmentRecord`,
`EnrollmentDescriptor`, `EnrollmentResponse` types. All test homes/storage and
service lifecycle I/O are injectable; tests never create discovery in real HOME
or implicitly register a real service. Focused isolated consumers live in
`tests/local-enrollment.test.ts` and `tests/setup-command.test.ts`; they are
verification instructions, not a claim of execution.

Config/resource readers and atomic writers use the same524288-byte serialized
bound, preserving full original request bytes. Oversize writes reject before
replacement. Only acquired runtime ownership initializes fresh config; duplicate
`run` never writes an old loaded config over live enrollment.

## Expert-only manual enrollment offer v1

Canonical offer is compact UTF-8 JSON with exactly {version:1,apiOrigin,pairId,enrollmentToken,rootKey,expiresAt}. pairId is a lowercase UUID; token/rootKey are independently random canonical unpadded-base64url32-byte values. The ten-minute original expiry bounds claim, both proofs and activation; a claim just before the deadline does not extend it. Default QR/link is moremote://enhance# plus unpadded-base64url of those exact JSON bytes. --json emits raw JSON. The fragment never reaches an HTTP origin. Consumers reject extras, unsupported versions, expired/noncanonical offers and origin changes; HTTPS except explicit loopback development. The secret QR is explicit output, never diagnostics.

The companion persists its root/host/enrollment capabilities before POST pairs, sending only identity, expiry and SHA256 hashes of the canonical bearer UTF-8 text (not decoded bytes). It verifies the pending phoneHello claim/token hash exactly, saves the accepted phone and immutable companionHello proof before activation, and enables actions only after confirmation within the original deadline. The phone independently verifies proof and exact saved daemon identity. Every phone is a separate pairing/key. Cloud credentials cannot satisfy this endpoint proof.

Unreleased source onboarding: invoking `pair` is explicit cloud consent. If
`apiOrigin` is absent, select the built-in
`https://moremote-cloud-ingress.pages.dev`; otherwise preserve and validate the
configured origin. Existing target, local official discovery and daemon pin
remain authoritative. Persist cloud-enabled configuration and the new offer
only after the official connection succeeds, before relay creation. Retained
pair keys, origins and revocation are never changed by a new enrollment.
Passive config loads/check/status do not opt in, and pairing installs no service.

## Official compatibility and observation

Pin client/protocol0.15.3. createHostClient from client/node and exported internal/daemon-client types are the inspected API. Use clientType cli and a distinct companion clientId. Missing explicitEventSubscriptions fails closed. Subscribe only agent_attention_required, agent_permission_request, agent_permission_resolved, status.server_info with official remote notifications disabled. Never call client_heartbeat, clear_agent_attention, workspace read acknowledgement or register_push_token. Inspected SDK automatic liveness uses bare protocol ping (10s), not visible-user presence. Actual synthetic WebSocket consumers exercise the real adapter/SDK, await that liveness interval, verify wire traffic, then lose send/permission acknowledgements and reconnect without a second mutation.

Observation is negotiated by the SDK, not an exact wire-array promise: when the daemon does not advertise ownedSubscriptions, SDK0.15.3's LegacySubscriptions filters status.server_info from its whitelist. Server identity still hydrates from the hello bootstrap before connect resolves. With ownedSubscriptions, the status interest remains on the wire. Real-wire tests exercise both negotiated modes, consume actual identity and attention events, and verify narrow interests, explicit reconnect and no mutation replay instead of equating adapter arguments with transmitted subscriptions.

Only selected paseo.pid and local-credential files are read, with bounded I/O and the official CLI’s target normalization/password/local-token precedence. No discovery scan, daemon launch, official writes, heartbeat/read/Expo ownership change or model prompt occurs during read-only checks.

## Bounded encrypted state and attention

State plaintext is exactly {version:1,daemonServerId,hostName,measuredAt,tasks:[{agentId,provider,title,status,createdAt,updatedAt,lastUserMessageAt,activeTurnStartedAt,cwd,requiresAttention,attentionReason,pendingRequests:[{requestId,requestBinding,request:<complete original official request JSON>}]}],usage,tasksTruncated}. Provider and creation time are additive unreleased source fields; older snapshots may omit them. Preserve genuine official provider and ISO-8601 createdAt/lastUserMessageAt facts; a missing last-user time stays null, never replaced by assistant-driven updatedAt. Consumers order recents by lastUserMessageAt, then creation time only when absent, then stable identity for ties. At most100 recent noninternal/nonarchived tasks,10 requests/task,16 provider summaries and8 windows/balances/provider. A raw request over8KiB is omitted from enhanced actions, not silently truncated into another authority. Whole trailing tasks are omitted to keep serialized state under60000bytes; tasksTruncated is explicit. Unavailable usage is null/unavailable, never zero. No full conversation or files are projected. Measurement time survives immutable state retries.

Attention plaintext is exactly {agentId,requestId?,requestBinding?,kind,timestamp}. No form or prompt is in the push route. For question/approval actions the app must find the exact matching authenticated raw request and binding in state or open the original form; it cannot paste the same reply into unsupported/multiple questions. Own notification policy uses genuine short viewing leases, never official shouldNotify. Stable semantic attention identity is independent of reconnect-generated authority tokens: reconnect may retire an old action binding without replaying historical attention as a new push. Source change/resolution/current no-longer-requires-attention facts persist exact event invalidation and POST its resolve endpoint, stopping future relay retries without changing official read state. An already in-flight/displayed push cannot be retracted.

## Exact request authority

The journal retains a canonical full-source fingerprint and random occurrence identity for every observed current request. A connection-generation change, source change, resolution or removal retires it. Binding is base64url HMAC-SHA256 using HKDF-SHA256 with the normal salt and info [1,pairId,"requestBinding"], over compact JSON [1,daemonServerId,agentId,requestId,occurrenceId,fingerprint]. This is companion-created opaque authority; the phone echoes it, never derives an occurrence. Input/action/suggestion source changes or same-ID replacements cannot inherit it.

Real upstream kinds are tool|plan|question|mode|other. Enhanced allow/deny requires an actually advertised action with matching behavior. Question codec copies every original input field and adds answers keyed by original question header. It validates choices, ordered multi-choice, allowOther/allowEmpty, completeness and exact preserved noneditable fields. Other edits may change only original string-valued inputs. Remembered grants must match actual current suggestions explicitly chosen by the user. Unknown fields/kinds of operation or an arbitrary new grant are rejected. Expired/stale notifications still navigate read-only, never acquire replacement authority.

## Dispatch, controls and receipts

Every mutation goes through a FULL-sync SQLite journal, immutable identity/digest and first-only cloud dispatch claim. The local dispatched commit precedes the cloud transition. Lost transition responses or crashes never authorize replay, even with a stable messageId. Actual current request/source/binding and command expiry are rechecked after dispatch, immediately before SDK I/O. SDK automatic reconnect is off; inspected sendAgentMessage/respondToPermissionAndWait use skipQueue:true. Recovery is read-only only.

Process authenticated control envelopes before normal command acquisition, even if the official daemon is unavailable. Persist cancel/revoke tombstones before sealing a controlReceipt. Recheck tombstones immediately before official I/O; revoked pairings can never reactivate from a cloud active flag. A dispatched action is tooLate to cancel, not undone. A relay DELETE acknowledgement alone proves no endpoint revocation. A phone receives endpoint-confirmed facts only from its exact authenticated immutable controlReceipt. A crash/retry retransmits the same sealed acknowledgement, never new authority. Keys remain protected for narrow final control/outcome audit; explicit purge can remove them.

Operation receipts carry positive monotonically increasing revision and exactly {operationId,state,revision,code?}; states accepted/resolved/rejected/unknown. Accepted is confirmed admission, not task completion/read, and never regresses to unknown because a later wait/receipt upload failed. Permission resolved needs matching current-instance authoritative resolution. Unknown can improve only through positive source evidence. Minimal evidence stores target identities and exact-content/response digests, never the original prompt or full request. It enables bounded canonical timeline/recorded resolution reconciliation after payload expiry/revoke without re-dispatch. Absence from a bounded timeline proves nothing.

Receipt/controlReceipt envelopes are at most8KiB. issuedAt is current attestation time, expiresAt at most600000ms later, independent of action TTL. Persist sealed bytes before upload. Retention remains the original operation/control expiry plus24h, never extended by a later receipt. Short-lived command/attention payloads are cleared on running cleanup and before restart recovery; a stopped process cannot run cleanup, but expiry is still enforced before any dispatch. Minimal encrypted receipts remain independently available for historical read-only audit, including after revoke. No public/cloud state substitutes for missing authenticated proof after retention.

Revoked-key retirement uses the latest immutable known child deadline: maximum of first revokedAt+24h and each durable operation/control/attention original expiresAt+24h. Authenticated late controls advance this high-watermark durably before acknowledgement/cleanup; unsent sealed acknowledgements remain retransmittable through their own original deadline, never forever or renewed by retry/attestation. Attention payload expiry is unchanged; its retained invalidation metadata has the original attention expiry+24h deadline. Never-observed cloud controls are not endpoint acknowledgements. Remove credentials durably before their expired tombstone; interrupted cleanup must leave revocation protection, not credentials without it.

## Portable lifecycle and ownership

Foreground run requires no installed service and owns an authenticated local IPC stop/status endpoint. PID locks never authorize signalling another process. Native stop first stops/unloads the owned login registration to avoid restart, then stops foreground transport. POSIX data directory/file modes0700/0600 and a companion ownership marker prevent adopting/purging nonempty foreign directories. Windows uses its user-profile ACL. Never point companion data at official data; a foreign directory is rejected, not overwritten.

Explicit service-install/update/uninstall use --yes. macOS LaunchAgent, Linux systemd user unit (XDG_CONFIG_HOME respected), and Windows least-privilege current-user logon task are separate optional platform adapters. Windows ownership probing requires built-in PowerShell; no administrator Windows Service is claimed. Files/registrations bind to the companion data-directory hash; mismatched ownership or unavailable managers fail honestly. Only companion-owned resources are removable. No official service, daemon data, history or credentials are altered.

Owned filenames alone are insufficient: reject symlinks, hardlinks, wrong resource types, foreign owner/modes, unmarked control records and foreign SQLite application identity before mutation. A stale socket is removable only through matching owned runtime provenance and inode identity. Service-path symlinks are rejected before no-follow/exclusive replacement. Manager inspection still runs when the registration file is absent; unavailable/ambiguous manager state is unknown, never a successful stopped/absent claim.

Cloud-disable durably stops local execution and attempts relay revocation, reporting unreachable relay revocation separately. Per-phone unpair affects only that pairing. Protected keys/journal are retained for final audit and no old pairing is automatically reused. Uninstall retains keys/journal unless --purge explicitly deletes companion state; neither operation undoes official actions or removes unreachable cloud data.

Managed update selection and retained-supervisor activation are specified in [06](06-managed-updates.md). Exact `@moxuli/moremote` installs use immutable verified private prefixes, no lifecycle scripts, persisted six-hour checks/opt-out, declared storage/wire compatibility and full-cycle drain before automatic activation. A failed update retains and actually restarts the last-known-good runtime. No global package, Node or official daemon update. Recovery never dispatches prepared records or manufactures execution receipts; request/occurrence authority and original audit deadlines survive restart unchanged.

Request attention carries the same internal occurrence witness across binding/envelope/topic cryptography. Check that witness synchronously before durable queue insertion, so resolution during an await cannot insert a new unresolved stale notification after the original invalidation.

## Contract provenance and evidence

02/03/04 are independently carried version1 contract copies dated2026-11-10; runtime imports never cross repository boundaries. vectors/envelope-v1.json was generated independently with Node hkdfSync/createCipheriv; implementation uses WebCrypto HKDF/AES-GCM. vectors/bearer-v1.json fixes bearer hash framing. Tests cover actual CLI, wire liveness/subscriptions/no-presence, send/current question/permission and lost acknowledgements, crypto/timing, control/dispatch crashes, source occurrence, revocation, monotonic receipts and retention. They are acceptance instructions, not a claim this worker ran them. See STATE for frozen checks and real external gates.
