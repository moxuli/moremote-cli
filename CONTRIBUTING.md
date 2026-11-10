# Contributing

Use Node 24.13+ (Node 24), npm ci --ignore-scripts, then npm run check. See docs/conventions.md for module boundaries and docs/STATE.md for external gates. Add a focused behavioral regression before changing security, timing, request ownership, dedupe or receipt semantics. Use only synthetic fixtures and temporary state directories.

Document user-visible/protocol changes in the relevant living spec, configuration registry and CHANGELOG. Protocol consumers ship independently: propose and agree exact wire deltas before changing shared 02/03/04. No runtime imports from sibling repositories. Keep UI/notification claims tied to real evidence; local simulated delivery does not prove APNs.

Do not submit credentials, pairing links, real task text, official data, private infrastructure, generated node_modules/dist or local databases. Report security issues privately to the project maintainer until a public security intake is configured; do not publish exploitable endpoint secrets. Contributions are under Apache-2.0 unless explicitly agreed otherwise. Remote CI/issue/release setup is not yet authorized or configured.
