# Engineering conventions

Correctness and six-month maintainability first. TypeScript ESM on Node24; strict compiler; pinned direct dependencies and lockfile. Source modules are cohesive and below500 lines. No shell command composition, generic RPC gateway, sibling imports or developer-specific defaults. Native service control uses argument arrays and only owned registrations.

crypto owns exact wire validation/standard primitives; pairing owns endpoint proof; official-client owns the pinned official SDK; operations owns action validation and dispatch; journal owns SQLite durability; runtime owns observation/transport; cli owns explicit user intent. Mutation paths cannot bypass operations/journal. SDK reconnection is disabled; read-only reconnection is orchestrated by runtime. The pinned SDK sendAgentMessage/respondToPermissionAndWait methods internally use skipQueue:true; connected-state checks and no reconnect ensure no SDK mutation replay.

Tests assert consumer-visible crypto, byte vectors, timing, receipts, restart, revocation, current request/action authority, lifecycle ownership and real CLI behavior. Never assert copied prose or mock echoes as implementation evidence. Do not run live provider calls in tests. Use temp data/home and synthetic target identifiers.

Diagnostics contain version/capability/stage/error codes, never raw SDK errors, credentials, pairing offers, prompts or private paths. Display of a QR is explicit secret output, not routine diagnostics. Snapshots are bounded truthful measurements, not inferred progress or full histories. Cross-repo contracts are source-controlled copies and shared public fixtures, never runtime dependencies.
