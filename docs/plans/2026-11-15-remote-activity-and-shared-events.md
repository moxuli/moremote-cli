# Remote Live Activities through shared notification delivery

Status: owner-requested implementation, unreleased. This supersedes only the
previous prohibition on ActivityKit APNs; widgets stay independent of cloud.

## User contract

Preserve one aggregate island per phone across paired computers. Pending new
questions/approvals and real completion/error occurrences receive fair sequential
presentation (eight seconds with ongoing work, fifteen seconds for final notices).
Without new notices choose the most recently opened ongoing conversation. No
confirmed ongoing work and no pending announcement means no activity; an unknown
source is never treated as proof of completion. No manual tracking, second
enablement, continued app execution requirement or extra sound is introduced. Existing
local-only behavior remains available without the optional computer CLI.

## Confirmed platform facts

Apple does not allow a Live Activity renderer to access the network. Native
ActivityKit APNs can start/update/end it without a continually running app.
Use token-based unicast, not public broadcast channels. Observe token rotations,
use the separate liveactivity APNs topic/type, and send only bounded content-state.
This implementation remotely updates/ends an activity that the foreground app
has already started. Push-to-start is not implemented or claimed. A new activity
after expiry/termination still requires opening the app; raw stateKey is never
uploaded in push-to-start attributes.
OS delivery budgets, disconnected phones, disabled activities and force-quit
behavior are system constraints, not an always-delivered guarantee.

References:
- https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities
- https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications

## Shared transport and ownership

Use the existing paired CLI observer, HTTPS ingress, PAIRS namespace, APNs signer
and retry machinery. A phone-installation aggregate coordinator serializes all
paired host contributions; independent hosts must never race the same token.
Reuse a paired event-batch request for notification attention and ActivityKit
changes. Control polling passively returns activity subscription metadata; no
new capability polling, widget feed or phone status polling is introduced.
Only semantic state changes publish; token registration/rotation and bounded
freshness renewal are separate infrequent operations. Spinning/prose streaming
never produce Worker requests. Ordinary notifications and silent activity pushes
may require distinct APNs requests; they cannot share an Apple token/type.

## Confidentiality and authority

No endpoint root, command/control key, provider credential, host password or
plaintext title/question/response enters the cloud. Each host contribution is
sealed with its pair's dedicated activity-state key. The renderer uses protected
local display-only keys, exact host/daemon/pair lifetimes and authenticated route
identities; a new background conversation need not already be in the local catalog.
Public minimal phase/occurrence routing metadata is documented separately from
encrypted labels and navigation. No display record can execute an operation.

Phone-scoped configuration binds the installation, coordinator capability,
ActivityKit type/environment/token generation and enabled host membership. Host
credentials only submit their own contribution; they cannot register another
phone or choose arbitrary provider topics. Local disable/delete/re-pair fences
rendering synchronously; durable cloud retirement and exact registration compare
prevent old retries from moving to a replacement token or reviving a stopped run.

## Lifecycle and ordering

Persist occurrence/fair queue and outbound attempt identity before provider I/O.
Exact retries retain bytes and APNs identity. Coalesce routine state while keeping
new questions/approvals/completions distinct. Late state generations cannot
regress a newer observation. APNs timestamps are monotonically ordered per
aggregate; return to foreground reconciles authoritative Paseo state and existing
system activities without duplicating them. Eight-hour activity expiry and
start/update token rotation must be explicit, including failed or delayed starts.

## Implemented bounds and ordering

The shared events ingress and private publish hop alone accept512KiB; ordinary
requests remain128KiB, each interest8KiB and each encrypted candidate2700bytes.
There are at most100candidates per source,512per aggregate,16paired sources,
and1,900,000bytes per aggregate storage row. CLI pending-publication storage is bounded to
1MiB. Real100-target long-label regressions cover the full budget end to end.
Token-only registration reuses immutable interest; replacement contributions are
unknown until observed. Cleanup binds member registrationId AND client revision.
A server wall clock never replaces the client's registration version. App local
background writes yield only after the native activity contains a valid v2
payload, not after HTTP registration. Foreground local rendering has a45second
lease refreshed by existing publication, with no network timer.

## Acceptance

Test real bundled decoder/routes, not a catalog-only replay. Cover two computers
and multiple conversations, pending question during running, sequential final
notices, last-opened fallback, app absent, cold new conversation, out-of-order
state, expiry, restart, token rotation, dismissal/disable/revocation races, full
four-kilobyte payload limits, immutable uncertain retries and zero polling for
unchanged state. Native simulated delivery is separate from real device APNs
acceptance. Publish actual request-count evidence for shared event ingress.

No new cloud deployment, public CLI package, Apple capability/key, persistent
service or TestFlight delivery is included in local implementation acceptance.
