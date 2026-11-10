# 0001 — Retained private bootstrap, not global self-overwrite

Status: owner-authorized design, implementation awaiting integration verification.

## Context

A continuously running scoped command consumer cannot safely replace itself or be stopped by an update during an uncertain official write. npm/global, source checkout and separately owned per-user service resources have different ownership boundaries. Manual staging without activation does not satisfy automatic updating.

## Decision

Keep exact scoped npm versions immutable in private state. Retain the first bootstrap package and point native login registrations at its supervisor entry. Use bounded persisted discovery, one writer, parent-child IPC drain at a complete journalled-cycle boundary, a declared storage/wire compatibility gate, positive readiness plus startup survival, and retained last-known-good selection. Persist opt-out independently so it can win during staging/drain. Never overwrite global package files, upgrade official Paseo or garbage-collect any referenced prefix.

Reject alternatives: global npm self-update (permission/package-manager ownership and vanished entry risk); merely staging a new prefix (never activates running service); force-kill/restart (can interrupt uncertain writes); arbitrary future-schema rollback (old binary may not understand new journal). Compatible automatic releases must remain jointly readable by all retained rollback candidates; incompatible changes remain manual and require their own migration design.

## Consequences

More disk is retained; the bootstrap's implementation remains fixed until explicit service maintenance. An update cannot force progress through a hung operation. This is preferable to corrupting authority or reporting false success. Package-manager installation, npm first publication/trusted-publisher setup, OS service acceptance and physical APNs delivery remain distinct gates.

Contracts: [managed updates](../specs/06-managed-updates.md), [release prerequisites](../releasing.md), [plan](../plans/2026-11-10-managed-updates.md).
