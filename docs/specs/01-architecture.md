# 01 — MoRemote CLI architecture

**Status:** owner-approved notification/scoped-delivery iteration; implementation source pending independent verification
**Date:** 2026-11-10

## Purpose and boundaries

MoRemote CLI (`moremote-cli`) is the optional open-source enhancement layer for MoRemote.
It consumes official Paseo interfaces. It never patches, forks, replaces or
silently updates Paseo. The official daemon continues owning agents, sessions,
tools and approvals. Baseline MoRemote works without this companion.

This repository must build and run independently of the app repository, any
private automation workspace or a developer's personal machine configuration.
Documentation uses synthetic identifiers and credentials only.

The owner approved the full identity cutover on 2026-11-10. Repository, npm
package, executable, client/runtime ownership and managed-package identities
move together; no legacy alias or old-state adoption is provided. Configuration
and service names are listed in the configuration registry. Protocol role
`companionHello`, cryptographic salt/envelope schema, APNs categories and the
app/Keychain identities are deliberately preserved. Earlier local acceptance
predates the rename; STATE records fresh renamed-tree verification separately.

## Runtime

Use TypeScript on the supported Node 24 line, matching official upstream client
interfaces and avoiding a second host-protocol implementation where the SDK is
usable. Pin dependencies and test the explicit upstream compatibility range.
Support macOS, Windows and Linux through one program with platform adapters for
background-service registration; no separately maintained shell/batch products.

Foreground `run` is a first-class entry point. Installation and service enablement
are explicit, reversible operations; building or testing cannot register a service.
The program remains inspectable and never needs administrator access for ordinary
per-user operation.

## Components

- **Official adapter:** authenticated local daemon connection, bounded local notification discovery
  and authoritative event subscriptions; no fake user focus/read acknowledgements.
- **Attention projection:** completion, pending question/approval and supported
  errors from typed evidence; no prose classifiers or fabricated progress/usage.
- **Cloud transport:** separately authenticated registration, bounded retry and
  encrypted short-lived operations. Official access credentials never leave host.
- **Action executor:** explicit allowlisted message/question/approval actions,
  checked against current authoritative target before execution.
- **Durable local receipts:** operation identity and execution outcomes survive
  process restarts. An uncertain daemon write is never blindly resent.
- **Lifecycle/diagnostics:** check, configure, run, status, stop, update, uninstall;
  only companion-owned resources may be changed or removed.

## Pairing and privacy

Pair the phone through an expiring one-use offer that pins a separate per-phone
endpoint key out of band. The existing official pairing credential
is not a cloud login or companion enrollment token. Each paired phone has a
separate identity and can be revoked without replacing official credentials.

End-to-end encryption keys remain at endpoints. The service can route ciphertext,
not decrypt messages or authorize arbitrary commands. Pairing/transport details
and byte-level cryptographic vectors belong in the reviewed shared protocol
contract; no homemade cryptographic primitive is permitted.

Never log complete pairing links, user prompts, tool output, filesystem paths,
model credentials or private keys. A redacted diagnostic is explicit and includes
versions, capabilities, connection stages and error codes, not hidden user data.

## Action semantics

A command targets one paired computer, one official conversation and, for a
reply/approval, one currently pending request. Identity, expiry and exact content
are immutable across transport retries. Receipts distinguish cloud acceptance,
companion delivery, official acceptance, failure, expiry, cancellation and unknown
outcome. Do not promise exactly-once execution if the upstream interface cannot
establish it. No arbitrary shell, generic RPC or background approval automation.

Revocation prevents new execution when observed before the irrevocable execution
boundary; it cannot roll back an already accepted official action. Restart,
network loss and reconnect preserve identities and do not replay historical
attention as fresh notifications.

## User transparency

Users can inspect what runs at login, cloud destination, enabled features,
registered phones and data egress. Disabling cloud stops its transport without
breaking the official daemon. Stop/uninstall do not remove chat history, official
configuration, model credentials or unrelated services. Update offers state the
source/version and require an explicit action.

## Verification and release boundary

Core parsing, attention, crypto contracts and action/receipt transitions are
behavior-tested before implementation. Integration uses isolated official test
daemons and synthetic sessions, never a user's existing work conversation.

Real push requires a separately deployed service and Apple configuration. Local
protocol acceptance is not APNs delivery, physical battery behavior or a tested
background-service installer on another OS. No package publication, public Git
repository, automatic installer execution or production service registration is
implied by implementation approval. The owner selected Apache-2.0; public
publication remains separately authorized.

## Notification-only cloud boundary — November 14

The optional companion publishes only current question/approval forms and their
exact occurrence bindings. It does not request provider usage or upload task
titles, host/project labels or a conversation directory. Accepted source reads
retain pending requests outside the bounded recent discovery page; stale reads
and resolved/replaced occurrences cannot restore them. Publication changes are
deduplicated; only pending hydration renews near expiry, and one empty publication
clears the last resolved request. Unknown acknowledgements retain immutable bytes.
No activity interests, WidgetKit registrations or dedicated surface APNs calls
remain. Notification control, explicit reply/approval execution, immutable action
journals and outcome reconciliation retain their original safeguards.
