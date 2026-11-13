# Configuration registry

## Local ownership

Config schema1 lives in config.json beneath the companion state directory. It contains a distinct persisted clientId, explicit target (optional), paseoHome, apiOrigin (optional), allowLoopbackHttp, cloudEnabled, pinned daemonServerId, and at most16 independent per-phone pair records. Pair root keys and relay host capabilities are endpoint secrets. API target/official credentials remain private local configuration; diagnostics redact the target and home. config is atomic-replaced and flushed before activation. journal.sqlite uses WAL and synchronous=FULL. runtime.lock/runtime.json/runtime.sock are companion-only control resources; stop authenticates the local IPC request, never kills a PID supplied by a stale file.
Existing resource ownership is checked before mutation, not inferred from filenames. SQLite application_id remains 0x4d524331 (MRC1, MoRemote CLI v1); the journal schema is unchanged. Read it through an immutable read-only probe before opening a writer; foreign/unmarked databases are rejected, never migrated/adopted. Unreleased development databases without that identity require a fresh temporary CLI state directory, not changes to official data. Runtime locks/records carry versioned CLI ownership and instance/token identity; socket cleanup requires matching provenance/inode. Atomic JSON replacement flushes file data and the POSIX parent directory before dependent tombstone cleanup. CLI root/managed markers, runtime owners and client prefixes change together; preserving the SQLite identity does not authorize old-state adoption.
Each pairing retains its explicit API origin through retirement. Local revokedAt and original child audit deadlines are never renewed by retries. Retired-key cleanup durably removes credentials before their no-longer-needed tombstones; no old pairing is resurrected. Expired pending offers are pruned24hours after original expiry. Managed selection is separate from pairing/config JSON: `managed/update.json` records only verified exact scoped packages, retained bootstrap/previous, candidate/error/compatibility and persisted discovery deadlines. `managed/auto-disabled` is an independent marked opt-out that wins during staging. Roots and managed directories retain separate ownership markers, foreign entries block purge, and official/companion data paths must not overlap.

MOREMOTE_CLI_HOME or --data-dir overrides platform state defaults: ~/Library/Application Support/MoRemoteCLI on macOS, LOCALAPPDATA/MoRemoteCLI on Windows, XDG_STATE_HOME/moremote-cli (fallback ~/.local/state/moremote-cli) on Linux. PASEO_HOME selects the official read-only home, PASEO_PASSWORD matches official CLI password precedence. Only paseo.pid and local-credential are read under the official home, only at an explicit connection. No credential discovery scans or official writes. The unpublished former moremote-companion identity has no command/env aliases or automatic state adoption.

Unreleased single-pairing onboarding uses explicit `setup --yes`: stop only the
owned CLI runtime/service, reload its latest configuration, authenticate the
existing official daemon and preserve its exact identity, then enable cloud and
local enrollment before installing/starting the existing owned service.
Configured custom HTTPS origin/target, existing active/revoked phones and update
policy are preserved. An absent origin selects
`https://moremote-cloud-ingress.pages.dev`. Source checkout without managed state
binds its own current frontend and stays manual-update. Installed packages and
retained managed state use capability-aware setup: if selected code predates
enrollment, explicit setup installs/verifies the exact current version before
enabling the feature, then moves active/bootstrap while retaining previous
packages, pairs/custom origin and the independent auto-update opt-out.
`SETUP_CURRENT_PACKAGE_UNAVAILABLE`/`SETUP_CAPABILITY_REQUIRED` are failures,
never enabled success or an older-package fallback. Nothing patches/upgrades
official Paseo or global tools. This capability requires CLI0.1.4 or later.

Optional schema-1 fields are `localEnrollment:{home:<absolute user home>}` and
at most16 `enrollmentRequests`. Only explicit setup supplies that home; ordinary
`run`/tests with legacy configuration never create discovery in the real HOME.
Each durable record stores the exact request bytes, SHA256 fingerprint, parsed
request, original pair/offer, exact cloud-create JSON bytes and confirmed-create
flag. Per-pair `automaticClientId` and `automaticRequestId` retain app/request
identity without replacing an old pair. Runtime-cycle ownership serializes all enrollment/config changes;
there is no second config writer or background watcher.

Config reads, owned-resource validation and atomic writes share a524288-byte
bound, including the serialized trailing newline. This accommodates16 maximum
4096-byte requests even when literal tab/newline bytes expand during JSON
serialization. Oversize writes fail before replacing any config. Fresh `run`
initializes config only after acquiring runtime ownership; duplicate `run`
refuses without rewriting a live enrollment snapshot.

The private tree is `<home>/.moremote-cli-connect/<sha256(UTF8 daemonServerId)>/`;
its parent/host/request/response directories have owned markers and POSIX0700.
Descriptor and secret responses are0600; official-created requests may be0644
inside the private request directory. Reject links, foreign markers/owners,
collisions and competing runtime locks before cloud creation. Windows relies on
the user-profile ACL. Only this owned local tree is written, not official files.
The app gets the real home via official directory suggestions, never a guessed
path. Descriptor includes the configured/default validated HTTPS `apiOrigin`,
which pins the original canonical offer's origin.

Unchanged request bytes resume the same endpoint and idempotent create bytes
through lost acknowledgements/restarts; changed bytes/client/daemon/expiry fail
closed. No more than16 request files are consumed per cycle and no more than16
pairs exist. At most one optional cloud-create attempt runs per cycle with its
own3s abort deadline; existing phones retain ordinary controls/command handling.
Descriptor lifetime90s/renewal30s; request/offer lifetime at most600s.
Activation/expiry removes private responses, expiry removes durable request
records. An old exact request remains disabled after revocation; only the app's
explicit fresh Enable request may create a new endpoint after prior retirement.
Full schemas and ownership behavior:
[single-pairing contract](specs/05-endpoint-and-lifecycle.md#single-pairing-local-enrollment-v1-unreleased).

Loading config, `check` and `status` do not create discovery, enable cloud,
select an origin, enroll or install a service; `check --connect` is read-only.
Manual `pair` remains expert-only and installs no service. Published0.1.2 lacks
`setup` and still requires explicit origin/cloud configuration before manual
pairing; this source delta is not published.

## Central limits (src/limits.ts)

Envelope request128KiB; decrypted content64KiB; send text60000 UTF-8 bytes; command/control TTL300s; enrollment/state/attention maximum600s; receipt/controlReceipt maximum8KiB serialized envelope with600s attestation interval; future clock tolerance120s (never expiry grace). User payloads expire at original TTL, minimal encrypted receipts/evidence remain24h after original operation/control expiry. Receipt revision is persisted before I/O; control ack revision1 is immutable. At most1000 operations,1000 controls and1000 attention records per pairing,100 tasks/snapshot,10 pending requests/task,16 providers,8 windows/balances/provider. Raw enhanced request limit8KiB; whole state limit60000bytes. State refresh30s, polling3s backing off to30s, HTTP timeout20s, official connection/read15s, SDK mutation timeout per pinned upstream. Capacity errors never silently evict live authority.
HTTP response limit is5MiB, separately from the128KiB request limit; the relay count-bounds command/control pages to32. This permits real bounded acquisition pages without silently truncating valid large commands.
Local pair revocation tombstones are capped at4096, never evicting live protection. Exhaustion is an explicit failure. Running cleanup removes a tombstone only after its pairing credentials have been durably removed and all immutable child audit deadlines have passed. Offline configuration-only reads cannot prune revoked keys without their journal.

HTTP429/503 may carry Retry-After as seconds or a canonical HTTP-date. Validate
it, cap the wait at24hours and retain a fixed deadline per API origin. By default,
paused origins make no repeated3second HTTP attempts; unrelated origins keep
their own cadence. Only429 `daily_work_limit` with `x-moremote-budget:normal`
and a future numeric `x-moremote-reset` consistent with Retry-After pauses normal
requests alone. Recovery routes still require server admission; hints grant no
authority. Missing/malformed hints, outages, disable and recovery exhaustion
retain origin-wide fences. Once observed, a pause fences its scope for the
remainder of the cycle even if slow SDK work outlasts the deadline. The next
cycle first reacquires controls before publication, receipt recovery or command acquisition.
Never reseal/renew an action or automatically repeat an uncertain mutation.

A successful upload acknowledges only those exact state/receipt bytes and
revision. Lost acknowledgements retain immutable retry bytes; acknowledged
snapshots/receipt revisions are not retransmitted each poll. Relay disappearance
or retirement fences execution but is not authenticated endpoint revocation.
Retired recovery ends at original child audit deadlines without extending them.

## Optional activity and widget surfaces (unreleased)

Published `@moxuli/moremote` remains0.1.1; these are local source changes,
not a new release or a reason to alter service/runtime identities. There is no
new CLI enable flag or separate activity-device command. Existing cloud opt-in,
active pairing and a compatible phone/relay are prerequisites; official-only
use remains independent. No deployment or device acceptance is implied.

| Surface | Bound / behavior |
| --- | --- |
| Activity interests | Phone-selected, encrypted and pinned to pair/subscription/daemon/task; at most8 live interests per pair, original lifetime at most8h. |
| Optional host work | Interest discovery no faster than30s; one owned2s cancellation-bounded lane, at most8 exact SDK fallback reads, each bounded250ms. Commands/controls do not await it; drain/stop cancels and joins before closing SDK/journal. |
| Activity state | At most600s, capped by interest expiry; serialized encrypted envelope at most3000bytes, title160/hostName80 characters. APNs body at most4096bytes with512bytes reserved for static attributes. |
| Activity renewal | Only acknowledged nonterminal state renews from a fresh official measurement with120s remaining (about8min). Unknown admissions retry identical bytes until expiry; semantic transitions can supersede progress. Missing tasks do not imply completion. |
| Widget registration | One current WidgetKit token per pair;24h expiry, native foreground renewal around12h with a fresh registration ID. Not the alert/activity token. |
| Widget reload | Pair-keyed meaningful-change fingerprint on existing state PUT; clocks alone do not trigger reloads. One coalesced signal per changed fingerprint/current registration; legacy envelope-only uploads do not queue pushes. |

The phone registers/deletes tokens and encrypted interests; the CLI never
registers an official daemon push token or downloads full chat/timeline for
these surfaces. The relay sees token/environment, IDs, opaque topic/fingerprint,
envelope times/sizes and ciphertext. Only paired endpoints decrypt task/title,
host/project and genuine usage values. Apple receives encrypted activity state
in `ContentState.payload`, or exactly `{aps:{"content-changed":true}}` for widgets.
Activity/widget pushes do not depend on alert admission or presence suppression.

Terminal recovery uses cached authenticated unexpired interests and fresh
snapshot facts before optional normal discovery; it needs no normal GET/state
upload. Only end/delete routes are recovery-eligible, not ordinary updates,
interest reads or registration. A404/409 publication rejection invalidates that
cached target; it does not authorize a replacement or a blind replay. Conflicting
same-registration bytes are409; replacement needs a fresh registration ID.
Relay retired-identity guards share a1000-entry cap and fail closed rather than
evicting live protection; guards last through original8h activity/24h widget
expiry. Delayed registration PUTs cannot roll back replacements; identity-exact
widget DELETEs and stale provider results cannot retire newer registrations.
Activity DELETE targets the subscription itself. Expiry never renews through
retry; stale/offline is not success.

The relay needs explicit `APNS_WIDGET_TOPIC` for the widget extension plus
`.push-type.widgets`; Live Activity topic is main `APNS_TOPIC` plus
`.push-type.liveactivity`. Environments must match configured APNs sending.
These are relay settings, not CLI configuration keys. Default-off, global
budgets, kill deadline and existing receipt priority remain unchanged.
Provider signing is inside the original10s attempt deadline; after signing,
the durable caller rechecks enabled state, active pair, exact current
registration/publication and expiry immediately before transport.
APNs200 is provider admission, never display/delivery proof. Physical Live
Activity, widget reload/freshness/offline behavior and live cloud/APNs acceptance
for this delta remain pending. Exact routes/crypto: [[specs/03-api-contract]].

## Service resources

macOS: user Library/LaunchAgents/com.moremote.cli.plist. Linux: XDG_CONFIG_HOME/systemd/user/moremote-cli.service (fallback user .config). Windows: current-user task MoRemoteCLI and UTF-16 XML in CLI state, InteractiveToken/LeastPrivilege; built-in PowerShell checks exact existing task ownership before schtasks mutation. Marker binds the data-directory hash; manager registration/file ownership mismatch fails closed. A private CLI root marker refuses nonempty foreign directories and gates purge. No official Paseo service/resource is altered. Missing managers fail honestly.

## Update source

Only exact `@moxuli/moremote` versions from https://registry.npmjs.org are installed with lifecycle scripts disabled. Immutable private prefixes retain the bootstrap and last-known-good packages. Managed installed-package run and explicit per-user service installation use a retained supervisor, six-hour persisted checks, independent opt-out and whole-cycle IPC drain before candidate activation. Source checkout run stays manual; foreign/read-only resources fail honestly. `status` reports actual runtime version plus active/pending/previous/error/deadline facts. `auto-update --disable` prevents all queued activation until re-enabled. Compatible storage/wire protocol is checked before any drain; incompatible candidates remain manual. No official daemon/global package/Node upgrade. See [full lifecycle](specs/06-managed-updates.md) and [release prerequisites](releasing.md).
