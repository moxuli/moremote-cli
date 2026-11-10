# Contributor automation rules

Read docs/STATE.md, docs/specs/01-architecture.md, the versioned 02/03/04 contracts, and docs/conventions.md before changing behavior. This repository must stand alone; no sibling runtime imports, symlinks, private paths, credentials or workstation dependencies.

Node 24.13+ on the Node 24 line. Install with npm ci --ignore-scripts. Pin direct dependencies and preserve package-lock.json. Core security/state-machine changes require behavioral tests first. Keep cohesive source files below 500 lines. Run npm run check only after all changes are complete; never register real services or connect to real work sessions through tests.

Never send official client heartbeats, clear attention/read state, register Expo tokens, write official files, auto-approve, expose arbitrary RPC/shell, or replay uncertain mutations. Preserve durable dispatch and immutable operation identity across restarts. Update affected specs/config registry/changelog with permanent changes. Public examples must be synthetic. Publishing, deployment, Apple capability/key changes and everyday service installation need separate authorization.
