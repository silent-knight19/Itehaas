# Itehaas — Architecture

## Overview

Two connected systems on one machine (Vivobook Ryzen 5 3500U, 20GB, NVMe+HDD, Ubuntu Server 24.04.3 LTS):

```
Browser
  → Next.js (3000)
  → Fastify (3001)
  → PostgreSQL (5432)  — platform metadata only
  → Rust VCS engine (itehaas binary) — authoritative repo truth on filesystem (.itehaas/objects)
```

Modular monolith. Monorepo: `vcs/` (Rust), `server/` (Fastify/TS), `web/` (Next.js), `database/migrations/`. `docker-compose.yml` optional; local bare-metal dev supported.

## Constraints

- Self-hosted on single old laptop: limited CPU (4c/8t), bounded concurrency (Tokio 4 workers, spawn queue 8), no K8s/Kafka/ES.
- Start minimal: CLI boundary for Node↔Rust, measure before RPC.
- Content-addressable separation: Postgres never stores file content; VCS never stores permissions.

## Component Responsibilities

- **VCS (Rust)**: hashing (trait, SHA-256), framing, object store, refs/HEAD (`refs.rs`), index/staging (`index.rs`), tree building (`tree_builder.rs`), checkout (`checkout.rs`), diff (`diff.rs` via `similar`), merge (`merge.rs` common ancestor, 3-way, fast-forward, conflicts), status/log, remotes. See `object-model.md`, `storage.md`. Phase 2 implements `add`/`commit`/`status`/`log` with `Working Tree → Index → Objects` flow; Phase 3 adds `branch`/`checkout`/`switch` (symbolic/detached HEAD, DAG, hierarchical); Phase 4 adds `diff` (wt vs index, --staged, HEAD vs branch, unified) and `merge` (fast-forward, up-to-date, 3-way O/A/B, markers, MERGE_HEAD, binary), CLI `itehaas` (`vcs/src/main.rs:1`).
- **Server (Fastify)**: auth (Argon2, httpOnly cookies, CSRF), repo/metadata CRUD, permission checks, spawn wrapper `server/src/lib/vcs.ts`.
- **Web (Next.js)**: dashboard, repo browser (reconstructs trees via VCS), commits/branches/issues/PRs.
- **Deploy**: NVMe for hot, HDD for backups; Tailscale for remote (replaceable with Headscale).

## Decisions

See `docs/decisions/` ADRs 001-004 and invariants in `object-model.md` / `storage.md`.
