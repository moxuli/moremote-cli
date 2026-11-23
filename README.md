# MoRemote CLI

Optional, independent Apache-2.0 computer companion for MoRemote and an **unmodified Paseo 0.15.3** daemon. Existing official-only clients keep working without this project or its cloud.

Canonical repository/command: `moremote-cli`; public npm package:
**`@moxuli/moremote`** (release **0.1.12**); source entry: `bin/moremote-cli.js`.
There is no unscoped npm alias or automatic adoption of foreign/old state.

## Install the published package

```sh
npm install -g @moxuli/moremote
moremote-cli --help
```

Requires an available public package and a user-owned npm prefix; never use sudo
or upgrade global Node/tools on this project's behalf. First installed-package
`run` or explicit `service-install --yes` creates an independently owned private
managed installation with automatic updates enabled. Source-checkout `run`
alone stays manual. When bound to a local `PASEO_HOME` (without `--target`),
`run` and the owned service automatically start or self-heal the local Paseo
daemon after a reboot or crash, while `stop` and `uninstall` leave Paseo untouched. No command upgrades or stops the official daemon.

## Build and foreground use

Requires Node **24.13.0 or later on Node 24** and npm. Dependency installation and builds do not register a service; only explicit lifecycle commands do.

```sh
npm ci --ignore-scripts
npm run build
node bin/moremote-cli.js --help
node bin/moremote-cli.js configure --target 127.0.0.1:6767
node bin/moremote-cli.js check --connect
node bin/moremote-cli.js run
```

The example endpoint is synthetic. Omit `--target` to use the official `paseo.pid` listen address under `PASEO_HOME` (otherwise the platform home’s `.paseo`). Auth follows the official CLI: target password, then `PASEO_PASSWORD`, otherwise a rotating local credential only when the selected target exactly matches the pid listen address after official normalization. Credentials are never printed or uploaded. No automatic daemon start or upgrade.

## Connect once through official Paseo

Single-pairing setup requires **MoRemote CLI0.1.4 or later**. Update an older
CLI before using this command. Publication and platform acceptance receipts are
recorded in `docs/STATE.md`.

With the official Paseo daemon already running:

```sh
moremote-cli setup --yes
```

This explicit command authenticates the existing official daemon, enables cloud
and automatic local enrollment, and installs/starts only the CLI's owned per-user
background service. It preserves configured targets/custom HTTPS origins, active
and revoked phones, and existing update preferences. With no origin configured,
it selects `https://api.moremote.moxuli.com`. It never starts, modifies
or upgrades Paseo or global tools. Source-checkout setup without managed state
binds the current source frontend and retains manual updates. Installed packages
or retained managed state require an enrollment-capable runtime: explicit setup
can install the exact current CLI version into owned private state, preserving
the automatic-update opt-out. A missing current package/capability fails clearly
before enabling enrollment, never by substituting old public code. The immutable
old package stays retained; its selected runtime/bootstrap move to capable code.

Existing installations keep their configured API origin, including
`https://moremote-cloud-ingress.pages.dev`. Retained pair origins and pending
offers remain unchanged; both domains must serve the same notification backend
directly, without an HTTP redirect or another pairing.

Pair the computer **only in official Paseo**. A compatible MoRemote app uses
that already authenticated connection's ordinary file channel to discover the
optional CLI and enroll its own phone automatically, even before a workspace
exists. There is no second QR, paste field, terminal, hidden workspace or relay.
Missing installation appears only in the enhancement surface. A previously
disabled/revoked phone is not silently re-enabled.

Discovery is private local state under
`<home>/.moremote-cli-connect/<sha256(daemonServerId)>/`. Descriptor origins are
pinned through that authenticated file channel; each bounded immutable request
gets its original per-phone offer and unchanged endpoint proof handshake. Secret
responses are never printed and are removed on activation/expiry. See the
[complete version-1 contract](docs/specs/05-endpoint-and-lifecycle.md#single-pairing-local-enrollment-v1-unreleased).

For an advanced custom authority, configure it before explicit setup:

```sh
moremote-cli configure --api-origin https://relay.example.test
moremote-cli setup --yes
```

Plain config loads, `check` and `status` stay passive; only `check --connect`
makes a read-only official connection. They do not enable cloud, enroll a phone,
create discovery or install a service.

### Expert-only manual enrollment

`moremote-cli pair` remains an explicit expert tool, not the normal app flow.
It prints a **secret**, ten-minute, one-phone QR/link (`--json` prints canonical
offer JSON), enables cloud on the configured/default origin and waits for the
original encrypted claim/activation proof. Never share screenshots or log its
output. It installs no service. Existing custom origins and per-phone authority
remain unchanged. Published 0.1.2 requires explicit origin/cloud configuration
before using that legacy manual path.

## Cloud boundary

Cloudflare supports notifications, explicit replies/approvals and optional
phone-authorized remote updates to an already-started Live Activity. Notification
and activity changes share one bounded event POST; unchanged observations add no
Worker request. Widgets and ordinary app/extension reads and sends use official
Paseo transport and shared device state. No general directory or usage feed is
uploaded. See the [configuration](docs/configuration.md) and rollout evidence in
[STATE](docs/STATE.md).

## What leaves the computer

The cloud sees pairing/operation/event identities, times, sizes, bounded transport states, scoped capability hashes and encrypted command/control/receipt/state/attention bodies. Attention routing includes a separately derived opaque conversation tag; provider fallback text is generic; supported native apps can decrypt the separately encrypted bounded alert preview. Endpoint-encrypted notification state includes only verified daemon identity and current occurrence-bound question/approval forms. Original supported question/approval forms are included only within strict bounds, to answer that exact request. No complete chat/history, code files, model keys or official Paseo passwords/local credentials are uploaded. The relay cannot decrypt or manufacture accepted commands. This is not forward secrecy.

Only exact message sends and responses to an **actual current** question/approval are supported. Admission accepted is not task completion. Unknown official outcomes are reconciled, **never blindly resent**, even when the same message ID is available.
Endpoint cancellation/revocation uses authenticated encrypted controls and durable local tombstones, not trust in a cloud DELETE result. An offline/withheld control is waiting/unknown, not endpoint-confirmed. A dispatched operation is too late to undo. Exact request-instance bindings retire on source/resolution/connection changes. Minimal revisioned encrypted receipts remain auditable for24h after original expiry, separately from short-lived user payloads; positive admission never regresses to unknown.

## Lifecycle and ownership

- `status` and `check` are redacted. Only explicit `check --connect` contacts the selected official daemon (read-only).
- `setup --yes`: explicit automatic-enrollment/cloud opt-in plus only the owned per-user background service; no second user pairing or official changes. Existing custom authorities, phone records and update opt-out survive.
- `service-install --yes`: explicit per-user LaunchAgent on macOS, systemd user unit (with best-effort `loginctl enable-linger`) on Linux, or least-privilege interactive-user **logon task** on Windows (not an administrator Windows Service). Foreground `run` needs none of these. No sudo/admin installation.
- `stop`: stop only the owned companion registration/runtime; never signal an official process. Linux/Windows registration remains available for a future login; macOS bootout leaves its owned plist available for explicit reinstallation.
- `unpair --pair-id <exact-id>`: revoke one phone, leaving other phones unchanged. Stop the runtime first.
- `cloud-disable`: stop the companion, persist local cloud-off and per-pair execution tombstones, then relay-revoke every own pairing when reachable. An unreachable relay is pending, not success; local execution remains off. Run again to retry relay revocation. Protected keys are retained for final read-only control/outcome audit; they do not restore execution authority.
- `update --version X.Y.Z --yes`: install only exact `@moxuli/moremote` into immutable private state with scripts disabled and queue a compatible candidate. A running managed supervisor drains only at a whole journalled-cycle boundary, starts the candidate and rolls back on startup failure; no service reinstallation is needed. Previously verified prefixes and bootstrap are retained. No global npm/Paseo/Node change. A staged package is never called active; use `status` for actual runtime.version and active/pending/previous/error/check facts.
- `auto-update --disable` / `auto-update --enable`: durable opt-out/in. Default managed checks are at most every six hours, including after restart; quota pauses can delay them. Disable wins during staging/drain and prevents queued activation until re-enabled. Foreign/read-only state fails visibly. Source-checkout/manual mode is explicit in status. See [update contracts](docs/specs/06-managed-updates.md).
- `uninstall --yes`: remove only owned registration/managed package; retain keys and dedupe journal. `--purge` explicitly deletes companion state too. It cannot erase cloud records while offline and does not undo dispatched actions. Disable/revoke cloud before purging. Source checkouts/global-package removal belongs to the tool that installed them.

Default CLI state uses `LOCALAPPDATA/MoRemoteCLI` on Windows, `~/Library/Application Support/MoRemoteCLI` on macOS, or `XDG_STATE_HOME/moremote-cli` (fallback `~/.local/state/moremote-cli`) on Linux. Override with `MOREMOTE_CLI_HOME` or `--data-dir`. Service identities are `com.moremote.cli` (macOS), `moremote-cli.service` (Linux) and `MoRemoteCLI` (Windows logon task). Private POSIX directory/file modes are 0700/0600; Windows relies on the user profile ACL, which operators must protect. Keep it separate from official Paseo data; never point it at an official data directory.

## Checks and real external gates

`npm run check` runs typecheck, behavioral tests and compilation. Tests use synthetic data/temp directories, no real host session, login registration, deployment or APNs call. Integration instructions and unexercised gates are in [STATE](docs/STATE.md). Real native notification delivery requires separately configured/deployed Cloudflare and Apple APNs credentials/capabilities, an authorized app build and a physical device. Cross-OS service installation and isolated real-daemon acceptance are separate checks; local tests cannot prove them.

[Docs](docs/README.md) · [Contributing](CONTRIBUTING.md) · [License](LICENSE) · [Notices](NOTICE)

Use the [release runbook](docs/releasing.md) for `npm run release`, public
package verification and the separate App, cloud and website runbooks.

Widgets and ordinary app/extension sends connect through Paseo and local device
state. Optional remote Live Activity delivery shares the notification service;
current request forms remain encrypted and exact-instance-bound. Full rollout
requires corresponding App and service versions; see STATE for actual availability.


### Informative encrypted alerts

Task notifications can carry a bounded endpoint-encrypted session title, computer
name and current answer/question/approval/error excerpt. A native app notification
extension decrypts on device, preserving navigation and actions. The service
never receives plaintext, endpoint keys or full transcripts. This adds no cloud
requests, widget feed or Live Activity dependency. Older versions retain safe
fallback behavior; see the delivery/API contracts and current STATE for rollout.

### Shared remote Live Activity updates

An optional phone-authorized v2 interest enables a separate owned Paseo directory
subscription. Semantic changes share one event request with pending notifications;
unchanged state adds no Worker request. The phone's already-started activity can
update/end through native APNs while the app is suspended. Each source computer
needs the corresponding CLI version. Local foreground behavior and direct Paseo
widgets remain available; push-to-start is not implemented. See
[[2026-11-15-remote-activity-and-shared-events]].
