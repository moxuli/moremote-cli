# 06 — Managed updates and release identity

## Scope and ownership

Public npm identity is exactly `@moxuli/moremote`; executable/repository/service/data names remain `moremote-cli`. Only this package is requested from `https://registry.npmjs.org`. Node24.13.0 is the pinned build/release runtime; supported runtime is Node24.13+ within Node24. Never upgrade Node, npm globally, official Paseo, its daemon registration or official data.

An actual scoped npm installation is identified by its resolved module location (`node_modules/@moxuli/moremote`), exact manifest identity and current-user resource ownership, not cwd or a matching directory substring. A source checkout stays foreground/manual until explicit `update` or `service-install --yes`. A root/foreign-owned scoped installation is rejected rather than implicitly adopted; install the public package in a user-owned npm prefix. Read-only global package bytes are never modified: the updater uses only the separately owned private state directory. Unwritable or foreign private state is an error, not success.

The retained/global frontend dispatches raw arguments to the verified selected CLI before option parsing, so newer flags and `--version` execute the selected package without replacing package-manager files. Compare canonical real paths, not raw entry strings: Node ESM canonicalizes its import URL, and a parent-directory alias must not cause recursive delegation to the same executable. A supervisor child bypasses this frontend redirection while an uncommitted candidate is being assessed.

Delegating frontends forward termination and wait for the selected process. Their OS child IPC channel also proves parent lifetime: parent disconnect/death shuts down the selected supervisor, which drains its runtime and waits for ownership release. Check already-disconnected startup as well as future disconnect events. Initialization cleanup starts immediately after acquiring runtime control ownership; a SQLite constructor/schema failure closes any opened database and releases the server/lock before reporting startup failure, allowing rollback to proceed.

Managed npm arguments pin **both** the default registry and `@moxuli:registry` to npmjs; an inherited scoped registry cannot redirect selected public-package installation.

Readiness observers use the runtime's positive parent IPC acknowledgement after journal initialization, relayed through the supervisor/frontend. They do not inspect staged socket ownership before publication or treat a partial filesystem snapshot as readiness. Terminal child exit rejects readiness immediately; bounded test/command cancellation remains in force. Read-only control discovery retains its strict foreign/unproven-stage protections.

An empty control EOF or reset is `CONTROL_CONNECTION_CLOSED` while the previously validated owner still exists, not a raw JSON parser exception or a successful stop. A malformed/nonobject reply is `CONTROL_INVALID_RESPONSE`. Only observed retirement/replacement of that exact validated record can classify an empty disconnect as not-running. No control or official mutation is retried because of a lost reply.

Ephemeral control transport compatibility: `managed/runtime-transport.json` is a marked version1, private/no-follow descriptor binding `json-lines-v1` to instanceId, pid, startedAt and SHA256(token). It is durably published before the runtime record. The original strict runtime.lock/runtime.json shapes remain unchanged, so retained0.1.0 readers and crash recovery can still read them; the existing marked managed directory contains the additional descriptor. Cleanup removes only the matching descriptor inode/generation.

The controller chooses one transport from that fact before sending: a matching descriptor means bounded4KiB newline frames and a duplex connection; no descriptor or a valid descriptor from another generation means the known0.1.0 EOF/unframed transport on POSIX. Invalid/linked/foreign descriptors are terminal, not an excuse to guess or probe. Ownership and selected framing are revalidated immediately before the single write. There is no timeout-based fallback, second connection or action replay.

Historical Windows boundary: unchanged published0.1.0 EOF-only control cannot provide a reliable duplex named-pipe reply. A live such generation reports `LEGACY_WINDOWS_CONTROL_UNAVAILABLE`, never fake status/stopped. It remains an explicit selectable candidate. The retained supervisor's separate child IPC can still drain, roll back or stop it. A managed stop waits for supervisor retirement and positive runtime retirement evidence before reporting success; an unsupervised live historical runtime remains unavailable/unknown. New framed runtimes retain full Windows support. An absent PID or retired record is evidence, not permission to signal an arbitrary PID.

The first installed-package `run` or explicit service installation obtains its exact current version into `managed/versions/<version>/node_modules/@moxuli/moremote`. Lifecycle scripts are disabled. npm network retries are disabled, fetches have a60second limit and installation has a120second process limit. Package name/version, ordinary nonsymlinked build/entry files and directory ownership are verified before an atomic staging rename. Existing version directories are immutable and reverified. Failed installations never change selection. There is no global npm self-overwrite or sudo.

## Durable selection and bounded discovery

`managed/update.json` has owner `MoRemote CLI updater v1`, enabled, active, bootstrap, optional previous/pending/pendingManual/activating/failed/manualRequired, lastCheck/nextCheck and a sanitized error code. Private atomic writes flush file and POSIX parent directory. A no-follow exclusive writer lock serializes installation and selection. A separate supervisor lock prevents two launchers. A stale marked lock is recoverable only after its PID is definitely absent; PID reuse conservatively reports busy, never authorizes signalling.

Automatic discovery requests bounded latest metadata once per six hours, persists the next deadline **before** network I/O, allows no redirects, has a20second request deadline and256KiB body cap.429/503 Retry-After can delay the original next check up to24hours; it never creates a renewed sliding deadline.404/unpublished, malformed identity and network failure preserve active selection and record a sanitized error until a later bounded attempt. Supervisor restart retains deadlines and failed-version suppression. Automatic selection accepts only strictly newer stable X.Y.Z versions; explicit update accepts exact semver including prereleases. No ranges, tags, URLs or alternate npm identities are accepted.

`auto-update --disable` writes a separate durable marked private opt-out even while another writer is staging/draining. Readers immediately report disabled. No queued candidate activates while disabled, including an explicit manual candidate; `auto-update --enable` resumes eligible queued work. An automatic pending candidate is cancelled when the writer is available; a concurrent installation may finish staging but cannot activate. Enabling never resets discovery deadlines or failed-version suppression. `status` distinguishes package bootstrap required, source-checkout manual mode, and the managed active/pending/previous/error/check facts.

## Explicit setup capability migration — source0.1.3, unpublished

`setup --yes` authorizes a specific owned CLI migration, not a global package,
Node or official daemon upgrade and not a change to automatic-update policy.
The current frontend recognizes its `localEnrollment:1` capability and routes
setup to selected code only when that selected package supports the same
enrollment/config-bound capability. A retained public0.1.2 handler cannot swallow
the command as unknown before the new handler runs.

After stopping only the owned runtime/service and authenticating official
identity, setup stages/verifies its exact current version when necessary.
Unavailable current packages or missing capability fail before feature/cloud
enablement; no old npm fallback is accepted. Then active/bootstrap move to the
capable package, previous/immutable packages and pair/custom-origin state remain,
and the independent update opt-out still wins for future automatic updates.
Source checkout without managed state instead binds its current own frontend.
No publication is implied by the local0.1.3 source version.

All current config readers/resource validators/writers share524288bytes and
reject an oversized serialized replacement before publication. Original request
bytes are retained even when JSON control-character escaping expands them.
This explicit capability migration does not assert that a directly invoked old
128KiB config reader can consume larger state. Retained public frontends route
subsequent commands to selected capable code rather than invoking old handlers.

## Compatibility and activation

Every publish declares `moremote: {updateProtocol:1,journalSchema:1,wireProtocol:1}`. Both staging selection and the retained supervisor independently check this exact compatibility tuple. Missing/different compatibility remains pending with manualRequired and `UPDATE_MANUAL_COMPATIBILITY_REQUIRED`; it never drains or executes. Automatic-release validation also rejects another tuple. A compatible release MUST preserve all older retained versions' ability to read/write the same config/journal, mutation tombstones and wire lifecycle. A mere startup survival window cannot prove this property. Breaking storage/wire changes require a separately designed, owner-approved migration/release process; do not relabel an incompatible schema as1 or promise arbitrary downgrade safety. The existing FULL-sync journal, occurrence, revoke and no-replay contracts are unchanged.

A service points at `bin/moremote-service.js` inside the retained immutable bootstrap package. That bootstrap and its dependencies are never removed automatically. The supervisor starts active's runtime as a child with an OS parent-child IPC channel. It requests `moremote-drain`, never a PID kill. Runtime finishes its **whole existing cycle**, including in-flight journalled writes and receipts, then closes the SDK/journal and authenticated runtime ownership. A paused sleep wakes for drain and cannot start another cycle. Losing the parent IPC channel also drains. Only after exit can another runtime start.

After old exit, candidate readiness requires journal creation and acquired runtime ownership; ten seconds of process survival commits active/previous. A failure or30second missing-ready deadline first drains the candidate and then starts the last-known-good active version. The failed candidate is persisted and not retried automatically; explicit `update --version ... --yes` authorizes another attempt. An interrupted activating marker on supervisor restart selects old active and suppresses the uncertain candidate. No rollback replays an official operation. All version directories are retained; there is no automatic garbage collection.

Opt-out during drain allows the old cycle to settle, then resumes old active without starting candidate. Opt-out during candidate startup drains it before resuming old active. Explicit stop signals only the owned service/runtime, writes a separate supervisor stop request, and waits for supervisor exit before managed deletion. Stop does not cause an internal respawn. A hung in-flight operation cannot be safely force-killed by an update: activation waits, status retains activating, and explicit operator stop remains separate. A staged package alone is never reported as active.

On Windows, the persistent ownership XML remains BOM-free UTF-16LE so unchanged
retained0.1.1 readers can validate shared state during startup and rollback.
Task Scheduler's file import instead receives an owned private transient copy
with the required UTF-16LE BOM, outside shared state. Remove that copy on every
normal success/failure path and before `/Run`; failed cleanup must not start the
runtime. Native registration acceptance must include unchanged public bootstrap
bytes, not only current code relabeled as an older QA version.

## Evidence entrypoints

`npm run check` exercises ordinary regression tests and compiles; `npm run smoke:upgrade` then packs three synthetic versions of the actual compiled package and installs them through real npm into isolated private prefixes. It starts the production retained service entry without registering an OS service, confirms9000.0.1→9000.0.2, exercises the retained frontend through a path alias, then queues compatible9000.0.3 whose disposable runtime exits before readiness. The supervisor must return to9000.0.2, retain bootstrap/previous, record the failed candidate and clear pending/activating before a clean stop. Only the disposable failed package bytes change. It contacts npm plus an intentionally unavailable localhost endpoint, never everyday official data or cloud. This is explicit acceptance, not an install hook. CI includes this smoke on macOS/Linux/Windows; observed results belong in STATE, not this specification.

The packaged smoke explicitly invokes the old frontend through a parent-directory symlink/junction and requires one selected-version response. Every network/subprocess/control/wait stage has a bounded deadline and a named checkpoint. Teardown retains handles to its own spawned processes, signals only their dedicated POSIX process groups or Windows PID subtrees, and awaits exit. Failure keeps the temporary root plus the last stage/selection; it never deletes an unexplained failed fixture or signals a PID discovered from an arbitrary state record.

## Official design references

- [Claude Code update behavior and package-manager boundaries](https://code.claude.com/docs/en/setup#update-claude-code): background checks, next-start activation, diagnostic visibility, opt-out; native versus Homebrew/WinGet/OS-package manager boundaries. This project borrows the owned-version/launcher boundary, not Claude's installer or global package-manager upgrade behavior. Our continuously running consumer needs an explicit cycle-safe handoff rather than a silent session restart.
- [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/): an optional future authentication migration, not a prerequisite for the owner's existing organization publishing secret.
- [GitHub Node package publication](https://docs.github.com/en/actions/tutorials/publish-packages/publish-nodejs-packages): exact identity, scoped public access and build-before-publish/provenance. Existing `NPM_TOKEN` is available only to this selected public repository and exposed as `NODE_AUTH_TOKEN` only during its release publish step.
