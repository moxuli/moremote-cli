# MoRemote CLI

Optional, independent Apache-2.0 computer companion for MoRemote and an **unmodified Paseo 0.15.3** daemon. Existing official-only clients keep working without this project or its cloud.

Canonical repository/command: `moremote-cli`; public npm package:
**`@moxuli/moremote`** (published **0.1.1**); source entry: `bin/moremote-cli.js`.
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
alone stays manual. No command starts/upgrades the official daemon.

## Build and foreground use

Requires Node **24.13.0 or later on Node 24** and npm. No installer scripts or service registration run during setup.

```sh
npm ci --ignore-scripts
npm run build
node bin/moremote-cli.js --help
node bin/moremote-cli.js configure --target 127.0.0.1:6767
node bin/moremote-cli.js check --connect
node bin/moremote-cli.js run
```

The example endpoint is synthetic. Omit `--target` to use the official `paseo.pid` listen address under `PASEO_HOME` (otherwise the platform home’s `.paseo`). Auth follows the official CLI: target password, then `PASEO_PASSWORD`, otherwise a rotating local credential only when the selected target exactly matches the pid listen address after official normalization. Credentials are never printed or uploaded. No automatic daemon start or upgrade.

## Connect to the hosted MoRemote service

After the published package is installed, explicitly enable the optional cloud
connection while leaving the official Paseo daemon unchanged:

```sh
moremote-cli configure --api-origin https://moremote-cloud-ingress.pages.dev --cloud-on
moremote-cli check --connect
moremote-cli pair
moremote-cli run
```

Scan the private one-use offer in MoRemote's system integration setup. Keep
`run` in the foreground, or separately choose background installation with
`moremote-cli service install --yes`. Configuration and package installation do
not silently register a service. The hosted backend operates continuously;
cloud participation remains off until each CLI user explicitly enables it.
Production TestFlight tokens use production APNs, not a sandbox backend.


For a separately operated relay:

```sh
node bin/moremote-cli.js configure --api-origin https://relay.example.test --cloud-on
node bin/moremote-cli.js pair
node bin/moremote-cli.js run
```

`pair` explicitly prints a **secret**, ten-minute, one-phone QR/link. Do not share screenshots or put it in logs. `--json` emits the canonical offer for explicit paste. It waits for the one-use claim and verifies the phone’s encrypted proof before activating that phone, within the original offer deadline. Each phone gets its own local 32-byte root key; only the phone receives it, never the relay. See [wire contracts](docs/specs/02-encrypted-delivery.md), [endpoint controls](docs/specs/04-control-and-receipt-lifecycle.md) and [endpoint behavior](docs/specs/05-endpoint-and-lifecycle.md).

## Optional activities and widget reloads — unreleased source

Local source adds per-task encrypted Live Activity state and keyed widget-change
fingerprints. These changes are **not in published 0.1.1**; the package version
has not changed. They require a compatible native app and separately configured
relay/APNs capabilities; installing the CLI alone enables neither surface.
Cloud remains off by default.

The phone owns task selection, encrypted read-only interest and native push
tokens; the companion authenticates that interest against the pinned daemon and
publishes bounded official task measurements. Up to eight interests per pairing
expire within eight hours; activity states expire within ten minutes. Missing
tasks are not reported finished. Acknowledged ongoing state renews from fresh
measurements around every eight minutes; lost acknowledgements preserve exact
ciphertext until expiry. Commands and controls do not await the optional activity
lane. Widget reloads depend on meaningful snapshot changes, use the existing
encrypted snapshot and are opportunistic, not realtime delivery.

The relay sees opaque routing/equality tags, registration identities, tokens,
environment, envelope metadata and ciphertext—not decrypted task titles or
usage. Apple receives the token and push payload: encrypted activity content or
a generic widget-change signal. Device rendering, widget freshness/offline
behavior and APNs delivery for these new surfaces remain **pending acceptance**;
APNs HTTP 200 means provider admission only. See [operator limits and failure
semantics](docs/configuration.md#optional-activity-and-widget-surfaces-unreleased)
and the [living wire contract](docs/specs/03-api-contract.md#opt-in-task-activities-and-widget-reloads).

## What leaves the computer

The cloud sees pairing/operation/event identities, times, sizes, bounded transport states, scoped capability hashes and encrypted command/control/receipt/state/attention bodies. Attention routing includes a separately derived opaque conversation tag; default push text is generic. Endpoint-encrypted snapshots include verified daemon identity, host name, bounded task/title/current raw request metadata and actual available usage. Original supported question/approval forms are included only within strict bounds, to answer that exact request. No complete chat/history, code files, model keys or official Paseo passwords/local credentials are uploaded. The relay cannot decrypt or manufacture accepted commands. This is not forward secrecy.

Only exact message sends and responses to an **actual current** question/approval are supported. Admission accepted is not task completion. Unknown official outcomes are reconciled, **never blindly resent**, even when the same message ID is available.
Endpoint cancellation/revocation uses authenticated encrypted controls and durable local tombstones, not trust in a cloud DELETE result. An offline/withheld control is waiting/unknown, not endpoint-confirmed. A dispatched operation is too late to undo. Exact request-instance bindings retire on source/resolution/connection changes. Minimal revisioned encrypted receipts remain auditable for24h after original expiry, separately from short-lived user payloads; positive admission never regresses to unknown.

## Lifecycle and ownership

- `status` and `check` are redacted. Only explicit `check --connect` contacts the selected official daemon (read-only).
- `service-install --yes`: explicit per-user LaunchAgent on macOS, systemd user unit on Linux, or least-privilege interactive-user **logon task** on Windows (not an administrator Windows Service). Foreground `run` needs none of these. No sudo/admin installation.
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

Public release prerequisites, existing-secret setup and exact verification commands:
[releasing](docs/releasing.md). Checked-in workflows are not proof of a published package.
