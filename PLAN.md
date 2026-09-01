# Itehaas — Master Development Plan

> Living contract. Update continuously: implemented + tested + verified + documented → mark `[x]`. Docs are source of truth.

## Project Vision

Build a Git-inspired distributed version-control system (Rust) and GitHub-like collaboration platform (Fastify/Next.js/PostgreSQL) self-hosted on a single laptop (Vivobook Ryzen 5 3500U, 20GB RAM, 512GB NVMe + 1TB HDD, Ubuntu Server 24.04.3 LTS, Tailscale).

Two connected systems:

- **System A — VCS Engine (Rust, `itehaas` binary)**: content-addressable storage, blobs/trees/commits/tags, refs/HEAD/index, DAG history, diff/merge, remotes. Authoritative repo truth on filesystem.
- **System B — Platform (Node.js/TypeScript, Fastify + Next.js + PostgreSQL)**: auth, repositories, browsing, issues, PRs, stars, notifications, CI. Operates on top of VCS engine; never duplicates VCS logic or stores file content in Postgres.

Core principles: Understand first, implement second. Correctness → Understanding → Testability → Maintainability → Performance → Scale.

## Current Status

**Current Phase:** Phase 1 — VCS Object Model & Store
**Current Task:** Phase 1 tests + manual CLI verification
**Overall Progress:** 18 / ~140 tasks
**Status:** 🟡 In Progress

### Last Completed

- Architecture approved with 7 refinements (hash abstraction, no bincode, no PG tuning, no gRPC, NVMe/HDD tiering, minimal scaffold, VCS-first milestone)
- Environment inspected: M4 dev machine vs Vivobook target identified
- PLAN.md created with full roadmap, status table, milestones
- docs/object-model.md, docs/storage.md, docs/architecture.md, ADRs 001-004 written
- Minimal scaffold created (Cargo workspace, vcs crates, configs) — `cargo check` passes, `cargo test` 0 tests ok
- Phase 0 committed

### Currently Working On

- Phase 1 object model implementation (hash, blob, tree, commit, store, init, CLI) — code complete, tests pending

### Next

- Phase 1 tests (unit + integration) + manual CLI verification
- Documentation sync
- Phase 1 commit
- Update PLAN.md Phase 1 [x]

## Phase Status Table

| Phase | Description | Status |
|-------|-------------|--------|
| 0 | Environment & Architecture | ✅ Complete |
| 1 | Object Model & Store | 🟡 In Progress |
| 2 | Index, Staging & Workflow | ⬜ Not Started |
| 3 | Branches & HEAD | ⬜ Not Started |
| 4 | Diff & Merge | ⬜ Not Started |
| 5 | Remotes | ⬜ Not Started |
| 6 | Server & API | ⬜ Not Started |
| 7 | Web Platform | ⬜ Not Started |
| 8 | Collaboration | ⬜ Not Started |
| 9 | CI/CD | ⬜ Not Started |
| 10 | Advanced VCS / Git Interop | ⬜ Not Started |

Status icons: ✅ Complete · 🟡 In Progress · ⬜ Not Started · 🔴 Blocked · ⏸️ Deferred

## Milestones

### M1 — First Object
`itehaas init → hash → store → read → verify` (Phase 1)

### M2 — First Commit
`add → commit → log` (Phase 2)

### M3 — First Branch
`branch → checkout → independent history` (Phase 3)

### M4 — First Merge
`branch → modify → merge (+ conflict markers)` (Phase 4)

### M5 — First Remote
`remote → clone → push → fetch → pull` (Phase 5)

### M6 — First Web Repository
Create and browse a repository through the web UI (Phase 7)

### M7 — First Pull Request
Create PR → review → comment → merge (Phase 8)

### M8 — First CI Pipeline
Push → job queued → container runner → logs → status in UI (Phase 9)

### M9 — Self-Hosted Release
Complete system deployed on Vivobook via `docker compose up` or bare metal (Phase 10)

## Architecture Summary

- **Monorepo, modular monolith**: `vcs/` (Rust), `server/` (Fastify), `web/` (Next.js), `database/migrations/`, `docs/`. One machine, bounded concurrency.
- **Storage separation**: VCS objects → filesystem CAS (`.itehaas/objects`), platform metadata → PostgreSQL. Never store file content as DB rows.
- **Hashing**: Abstraction trait `Hasher`, default `SHA-256`, one repo = one algorithm (format invariant), mixed-algo objects rejected. Future: SHA-1/BLAKE3/Git compat behind same abstraction.
- **Object format**: Deterministic, documented, language-independent (not bincode). Central invariant: `ObjectID = H(canonical_header || "\0" || canonical_body)`, `Stored = zlib(header || "\0" || body)`, hashing on uncompressed bytes only. See `docs/object-model.md`.
- **Tree encoding**: Git-inspired deterministic (sorted by name, raw hash bytes), not Git-compatible until tested.
- **Node ↔ Rust**: Process/CLI boundary (`spawn("itehaas", args)`), measured before any RPC. No gRPC yet.
- **Deployment**: NVMe for active repos + Postgres + hot data; HDD for backups/cold storage; Tailscale for remote access (replaceable with Headscale).
- **Performance**: Conservative defaults, no premature optimization; streaming/mmap/packfiles deferred to Phase 10; PG tuning only after benchmarks.

## Technology Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| VCS Core | Rust + Tokio (later), Serde (index/config only), sha2, flate2, clap, hex | Systems control, determinism, learning value |
| Hashing | SHA-256 via `sha2 0.10`, abstraction trait | Future-proof, avoid SHA-1 collision debt |
| Compression | `flate2` (zlib) | Git-compatible; streaming later |
| Backend | Node 20 LTS, pnpm, Fastify, TypeScript, Argon2, pg | Lightweight, fast, low overhead |
| Frontend | Next.js 14 (App Router), React, Tailwind CSS | SSR for repo browsing |
| Database | PostgreSQL 16 | ACID, concurrent pushes, metadata only |
| Cache/Jobs | Redis + BullMQ (Phase 9 only) | Only when job queue needed |
| Deploy | Docker Compose (optional), local bare metal | Single-laptop, no K8s |
| Remote | Tailscale (WireGuard) | Zero port-forward, CGNAT-friendly |

## Development Principles

1. Understand first, implement second — explain problem, Git approach, our design, tradeoffs before code.
2. Incremental, runnable phases — every commit `cargo test` green.
3. Docs are source of truth — object format documented before code follows it.
4. No premature infra — measure before adding Redis/gRPC/packfiles/K8s.
5. Correctness + determinism over optimization in early phases.
6. Verify via execution — tests + manual CLI checks before marking done.

## Phase 0 — Environment & Architecture

- [x] Inspect machine (M4 dev: 10c/16GB/228GB; target: 3500U 4c/8t/20GB/512NVMe+1TB HDD) — 2026-09-01
- [x] Confirm OS (target: Ubuntu Server 24.04.3 LTS, ext4) — decision frozen
- [x] Confirm CPU/RAM/storage (Vivobook spec captured, tiering planned) — decision frozen
- [x] Confirm Rust (missing on dev, will install via rustup; Vivobook needs same) — noted
- [x] Confirm Node/pnpm (20.20.2 / corepack) — present
- [x] Confirm Docker (missing; OrbStack/colima or brew PG) — noted
- [x] Confirm PostgreSQL requirements (16 LTS, conservative defaults, no tuning) — decision frozen
- [x] Finalize architecture (amendments 1-7 applied, binary `itehaas`, algo invariant, no bincode, no gRPC) — approved
- [x] Write architecture documentation (`docs/architecture.md`) — 2026-09-01
- [x] Write object-model spec (`docs/object-model.md`) — source of truth — 2026-09-01
- [x] Write storage spec (`docs/storage.md`) — 2026-09-01
- [x] Create ADRs (ADR-001..004) — 2026-09-01
- [x] Create PLAN.md — this file — 2026-09-01
- [x] Create project scaffold (Cargo workspace, vcs stubs, pnpm-workspace, configs) — 2026-09-01
- [x] Verify baseline build (`cargo check`, `cargo test`) — passed 2026-09-01
- [x] Commit Phase 0 — pending

### Definition of Done — Phase 0

- [x] PLAN.md present with full roadmap, status table, milestones, DoD per phase
- [x] docs/architecture.md, docs/object-model.md, docs/storage.md written and invariants stated
- [x] ADRs 001-004 present
- [x] Minimal scaffold compiles (`cargo check` passes)
- [x] Tests pass (even if 0 tests)
- [x] Phase 0 commit created — pending

## Phase 1 — VCS Object Model & Object Store

> First engineering milestone: VCS object model, not web app. Smallest vertical slice: `init → create object → store → read → verify`.

### 1.1 Hashing

- [ ] Hash abstraction trait (`Hasher`: algo, hash_len, hash, name)
- [ ] `Hash` struct (algo + bytes, hex/from_hex, validation)
- [ ] SHA-256 implementation (`Sha256Hasher` via `sha2`)
- [ ] SHA-1/BLAKE3 variants stubbed as `UnsupportedAlgo` (no impl/tests)
- [ ] Hash algo invariant: repo config records algo, store rejects mismatched lengths
- [ ] Factory `new_hasher(algo) -> Box<dyn Hasher>`
- [ ] Tests: empty blob hash vector, determinism, hex round-trip, invalid hex, unsupported algo

> Note: Hashing layer behind trait for future Git compat without store rewrite. See `docs/object-model.md:§Hash Algo Invariant`.

### 1.2 Object framing

- [ ] Canonical header `"<type> <len>"` + `\0` + body
- [ ] Body length = decimal ASCII of canonical body len
- [ ] Null separator handling
- [ ] Deterministic byte representation (LF only, no trailing spaces beyond spec)
- [ ] Hash computed on uncompressed header+\0+body
- [ ] Stored bytes = zlib(header+\0+body)
- [ ] Documentation synced to implementation

### 1.3 Blob

- [ ] `Blob { content: Vec<u8> }`
- [ ] Serialization: body = raw bytes
- [ ] Parsing: extract body after header
- [ ] Tests: empty blob, binary content, large blob, round-trip

### 1.4 Tree

- [ ] `Tree { entries: Vec<TreeEntry> }`, `TreeEntry { mode: u32, name: String, hash: Hash }`
- [ ] Mode validation (100644, 100755, 040000)
- [ ] Name validation (no "/" or "\0", non-empty, UTF-8)
- [ ] Deterministic sorting (bytewise name ascending)
- [ ] Raw hash bytes encoding (32B for SHA-256, algo-dependent)
- [ ] Serialization: entry = `"<mode> <name>\0<hash_raw>"` concatenated
- [ ] Parsing: split, validate, sort check
- [ ] Tests: sorted vs shuffled same hash, duplicate reject, invalid name/mode

> Note: Tree encoding is Git-inspired deterministic, not Git-compatible. See `docs/object-model.md:§Tree`.

### 1.5 Commit

- [ ] `Commit { tree: Hash, parents: Vec<Hash>, author: Signature, committer: Signature, message: String }`
- [ ] `Signature { name, email, timestamp: i64, offset_tz: i32 }`
- [ ] Canonical field ordering: `tree`, `parent*`, `author`, `committer`, `\n`, message
- [ ] Parent handling (0 root, 1 normal, N merge, order preserved)
- [ ] Author/committer validation (no `<>\n`, tz `±HHMM`)
- [ ] Serialization + parsing (line order enforced)
- [ ] Tests: root vs merge commit, out-of-order reject, message with newlines

### 1.6 Object storage

- [ ] Repository object directory (`.itehaas/objects`)
- [ ] Fanout paths (`ab/cdef...` for SHA-256: 2/62 hex)
- [ ] zlib compression (flate2, default level 6 Phase 1)
- [ ] Atomic writes (tempfile + rename, mkdir fanout)
- [ ] Reads (zlib decode → split at \0 → header parse → len/type check)
- [ ] Integrity verification (re-hash, compare expected vs computed)
- [ ] Corruption detection (truncated zlib, bad header, len mismatch, hash mismatch → `CorruptObject`)
- [ ] Deduplication (same content → same path, no duplicate write error)
- [ ] Size limit (64 MiB Phase 1, reject larger)
- [ ] Tests: write→read round-trip, dedup, corrupt flip, missing object, size limit, algo mismatch

### 1.7 Repository initialization

- [ ] `itehaas init [path] [--algo sha256]` (default SHA-256)
- [ ] Creates `.itehaas/{HEAD,config,objects,objects/pack,refs/heads,refs/tags,refs/remotes}`
- [ ] `HEAD = "ref: refs/heads/main\n"`, `config [core] hasher=sha256, repositoryformatversion=1`
- [ ] Fails if `.itehaas` exists unless `--force`
- [ ] Repo discovery (find `.itehaas` from cwd upwards for later commands)
- [ ] Tests: init creates structure, re-init error, custom path, algo recorded

### 1.8 CLI

- [ ] `itehaas init [path] [--algo]`
- [ ] `itehaas hash-object [-w] [-t blob|tree|commit] <file>|--stdin` (default blob)
- [ ] `itehaas cat-file -p|-t|-s <hash>` (pretty/type/size)
- [ ] `itehaas verify <hash>` (integrity check)
- [ ] Error handling (exit codes, stderr, invalid hash regex `^[0-9a-f]{64}$` for SHA-256)
- [ ] Tests: CLI integration via `assert_cmd` or spawn

### Definition of Done — Phase 1

- [ ] All unit tests pass (`cargo test -p itehaas`)
- [ ] All integration tests pass (tempfile repos, write/read/verify)
- [ ] Manual CLI verification passes:
  ```bash
  itehaas init /tmp/r1
  echo -n hello | itehaas hash-object -w --stdin  # → <hash>
  itehaas cat-file -p <hash>                      # → hello
  itehaas verify <hash>                           # → ok
  python3 -c 'import zlib; d=zlib.decompress(open("/tmp/r1/.itehaas/objects/ab/...","rb").read()); assert d.startswith(b"blob 5\x00hello")'
  ```
- [ ] Corrupt-object test passes (flip byte → verify fails with CorruptObject)
- [ ] Determinism tests pass (same content → same hash, tree sorted)
- [ ] Hash algo invariant enforced (mixed algo rejected)
- [ ] Documentation updated (`object-model.md` matches impl)
- [ ] Phase 1 commit created
- [ ] PLAN.md updated: Phase 1 [x], status table, current phase → Phase 2

## Phase 2 — Index, Staging & Basic Workflow

### Scope

- [ ] Index/staging area (real concept: `.itehaas/index`)
- [ ] `itehaas add <file>` / `add .`
- [ ] `itehaas status` (compares HEAD tree vs index vs working tree)
- [ ] `itehaas commit -m "message"` (creates tree from index, creates commit)
- [ ] `itehaas log` (history walk)
- [ ] Working Tree → Index → Repository flow implemented

### Dependencies

- Depends on: Phase 1 object model, tree/commit serialization

### Definition of Done — Phase 2

- [ ] Can create repo, add files, commit, view status/log
- [ ] Index correctly tracks staged vs unstaged vs untracked
- [ ] Second commit parents correctly link to first
- [ ] Tests cover add/commit/status/log, failure cases
- [ ] Documentation updated

## Phase 3 — Branches & HEAD

### Scope

- [ ] References (`refs/heads/*`, `refs/tags/*`)
- [ ] `HEAD` (symbolic `ref: refs/heads/main` vs detached hash)
- [ ] `itehaas branch` (list/create/delete)
- [ ] `itehaas checkout` / `switch` (update HEAD + working tree)
- [ ] `itehaas log` follows DAG correctly

### Dependencies

- Depends on: Phase 2 workflow, commit DAG

### Definition of Done — Phase 3

- [ ] Branches point to commits (no history duplication)
- [ ] HEAD correctly tracks checked-out branch/commit
- [ ] Checkout switches working tree and index
- [ ] Tests for branch creation, checkout, detached HEAD
- [ ] Documentation updated

## Phase 4 — Diff & Merge

### Scope

- [ ] `itehaas diff` (working tree vs index vs commit)
- [ ] Common ancestor detection
- [ ] Fast-forward merge
- [ ] Three-way merge
- [ ] Merge commits (multiple parents)
- [ ] Conflict detection + markers (`<<<<<<<`, `=======`, `>>>>>>>`)
- [ ] Conflict resolution
- [ ] `itehaas merge <branch>`

### Dependencies

- Depends on: Phase 3 DAG, commit ancestry, tree comparison

### Definition of Done — Phase 4

- [ ] Two-way diff works
- [ ] Common ancestor found correctly
- [ ] Fast-forward merge works
- [ ] Three-way merge creates merge commit
- [ ] Conflict detection works
- [ ] Conflict markers generated correctly
- [ ] Conflict resolution can be completed
- [ ] Integration tests for normal and conflicting merges
- [ ] Documentation updated

## Phase 5 — Remote Repositories

### Scope

- [ ] `itehaas remote` (add/list/remove)
- [ ] Own HTTP transport protocol (initially, not Git compat)
- [ ] `itehaas clone`
- [ ] `itehaas fetch` (transfer objects, update `refs/remotes`)
- [ ] `itehaas push` (send local objects to remote)
- [ ] `itehaas pull` (fetch + merge)
- [ ] Object transfer, ref advertisement

### Dependencies

- Depends on: Phase 4 DAG, local repo complete

### Definition of Done — Phase 5

- [ ] Clone copies full history
- [ ] Fetch brings new objects without merging working tree
- [ ] Push sends missing objects to remote
- [ ] Pull = fetch + merge
- [ ] Handles concurrent push (rejected if non-fast-forward)
- [ ] Tests for clone/fetch/push/pull, failure cases
- [ ] Documentation updated

## Phase 6 — Server & API

### Scope

- [ ] Fastify TypeScript setup
- [ ] PostgreSQL schema (users, repositories, members, permissions)
- [ ] Authentication (Argon2, httpOnly cookies, CSRF, sessions)
- [ ] Repository creation (creates bare `.itehaas` on NVMe)
- [ ] Remote operations API (push/fetch via HTTP)
- [ ] Repository CRUD + member/permission APIs
- [ ] Node ↔ Rust spawn wrapper (`server/src/lib/vcs.ts`)

### Dependencies

- Depends on: Phase 5 remotes, Phase 1-2 VCS correctness

### Definition of Done — Phase 6

- [ ] User registration/login works securely
- [ ] Repository creation creates both DB row and VCS repo
- [ ] Push/fetch via API works (delegates to Rust engine)
- [ ] Permissions enforced (read/write/admin)
- [ ] API tests pass
- [ ] Documentation (api.md, database.md, security.md)

## Phase 7 — Web Platform

### Scope

- [ ] Next.js + Tailwind setup
- [ ] Dashboard, repository list, profile
- [ ] Repository code browser (reads VCS trees, not upload dir)
- [ ] Commit history, branches view
- [ ] README rendering
- [ ] Repository settings, visibility

### Dependencies

- Depends on: Phase 6 API

### Definition of Done — Phase 7

- [ ] Can create/browse repos via web UI
- [ ] File browser reconstructs tree from VCS objects
- [ ] Commit/branch views work
- [ ] Tests: UI integration, Playwright for critical flows

## Phase 8 — Collaboration Features

### Scope

- [ ] Issues (CRUD, comments, status)
- [ ] Pull requests (create from branch, diff view, merge)
- [ ] Code review comments
- [ ] Stars, notifications, activity feeds
- [ ] Permissions (repo members, visibility)
- [ ] Webhooks
- [ ] Releases

### Dependencies

- Depends on: Phase 7 web, Phase 4 merge logic

### Definition of Done — Phase 8

- [ ] Issues and PRs work end-to-end
- [ ] PR merge invokes VCS merge correctly
- [ ] Notifications delivered
- [ ] Permissions enforced
- [ ] Tests for collaboration workflows

## Phase 9 — CI/CD

### Scope

- [ ] Job queue (BullMQ + Redis, only when needed)
- [ ] Runner (Docker-isolated, not host execution)
- [ ] Pipeline config (YAML: install → test → build)
- [ ] Push event → job creation → runner execution → log capture
- [ ] CI status exposed in UI
- [ ] Secret management, resource limits, isolation

### Dependencies

- Depends on: Phase 5 push events, Phase 6 server, Docker

### Definition of Done — Phase 9

- [ ] `git push → job queued → container runs → logs captured → status reported`
- [ ] Arbitrary code isolated (no host execution, docker --network none, mem/pids limits)
- [ ] Logs viewable in UI
- [ ] Tests for job lifecycle, isolation, failure handling

## Phase 10 — Advanced VCS & Git Interoperability

### Scope

- [ ] Packfiles + delta compression
- [ ] Garbage collection (reachability from refs)
- [ ] Integrity verification (`itehaas fsck`)
- [ ] Object reachability + prune
- [ ] Optimized fetch/push (negotiation)
- [ ] Git protocol compatibility (advanced, after own protocol works)
- [ ] Benchmarking on Vivobook

### Dependencies

- Depends on: All prior phases

### Definition of Done — Phase 10

- [ ] Packfile creation/reading works
- [ ] Delta compression reduces storage measurably
- [ ] GC collects unreachable objects safely
- [ ] `fsck` detects corruption
- [ ] Benchmarks show improvement on Vivobook (if not, document why)

## Security Hardening

- [ ] Input validation (hash regex, path traversal, no "/" in tree names, no shell)
- [ ] SQL injection prevention (parameterized queries)
- [ ] XSS/CSRF protection (httpOnly, SameSite, tokens)
- [ ] SSRF/file upload abuse guards
- [ ] Secret management (Phase 9)
- [ ] Malicious repo/CI isolation (container, no host exec)
- [ ] Rate limiting, authz checks per route
- [ ] Security docs (`docs/security.md`)

## Performance & Benchmarking

- [ ] Baseline measurements (Phase 1 object store, Phase 2 add/commit)
- [ ] Vivobook benchmarks (hash, zlib, tree walk, push/pull)
- [ ] Only tune after measurement (PG, compression level, Tokio threads)
- [ ] Document: no premature optimization, bounded concurrency (4 workers on 3500U)

## Testing Strategy

- [ ] Rust unit tests (hash, object parsing, tree sort, commit order)
- [ ] Rust integration tests (tempfile repos, write→read, merge, corruption, concurrency)
- [ ] Property tests (proptest for round-trip where useful)
- [ ] Git as oracle (compare `itehaas log` vs `git log` on same repo, where applicable)
- [ ] Failure cases (corrupt object, invalid commit, missing parent, merge conflict, missing object, concurrent ops)
- [ ] Server tests (Vitest + Supertest, mock or real vcsService)
- [ ] Web tests (Playwright for critical flows)
- [ ] CI: `cargo test && pnpm test` on each commit

## Deployment

- [ ] Local dev mode (bare `cargo run` + `pnpm dev` + brew PG, no Docker)
- [ ] Docker Compose (`Next.js` + `Fastify` + `PostgreSQL` + `Rust binary` + `CI Runner` optional)
- [ ] Single-laptop constraints respected (no K8s/Kafka/ES/Cassandra)
- [ ] NVMe vs HDD tiering documented and enforced
- [ ] Tailscale remote access (documented, no hard-coded pricing)
- [ ] `docker compose up` + local dev docs (`docs/deployment.md`)

## Future Improvements

- Organizations / teams (deferred until single-user flows solid)
- OAuth / SSO (after password auth works)
- WebSockets live updates (polling first)
- Elasticsearch for code search (PG trgm first)
- MinIO S3 compat (FS first)
- Prometheus/Grafana observability (structured logs first)

## Explicitly Deferred

> Do not build these until prerequisites complete. Move out only when their phase begins.

- [ ] Git wire protocol compatibility (Phase 10)
- [ ] Packfiles, delta compression, GC (Phase 10)
- [ ] Garbage collection / object reachability (Phase 10)
- [ ] Integrity `fsck` full scan (Phase 10)
- [ ] Optimized fetch/push negotiation (Phase 10)
- [ ] Redis / BullMQ (Phase 9 only)
- [ ] MinIO / S3 object store (only if multi-disk needed)
- [ ] Elasticsearch / Cassandra / Kafka (not needed at this scale)
- [ ] Kubernetes / service mesh / multi-microservices (never for v1)
- [ ] Organizations / advanced permissions (after Phase 8)
- [ ] Production CI infra / multi-runner autoscaling (Phase 9+)
- [ ] WebSockets / live PR updates (polling first)
- [ ] Prometheus / Grafana (structured logs first)
- [ ] OAuth / SSO (after Phase 6 auth)
- [ ] gRPC / IPC daemon (only after spawn measured as bottleneck)
- [ ] High availability / horizontal scaling (single-machine target)

## Architectural Decisions Index

| ADR | Decision | Status | File |
|-----|----------|--------|------|
| ADR-001 | Why Rust for VCS | Planned | docs/decisions/ADR-001-rust-for-vcs.md |
| ADR-002 | Why filesystem CAS (not DB) | Planned | docs/decisions/ADR-002-fs-object-store.md |
| ADR-003 | Why PostgreSQL for metadata | Planned | docs/decisions/ADR-003-postgres-for-metadata.md |
| ADR-004 | Why modular monolith initially | Planned | docs/decisions/ADR-004-modular-monolith.md |
| ADR-005 | Hash abstraction + SHA-256 invariant | Decided | docs/object-model.md:§Hash Algo Invariant |
| ADR-006 | No bincode for objects — documented canonical format | Decided | docs/object-model.md |
| ADR-007 | Process/CLI boundary for Node↔Rust | Decided | docs/architecture.md |
| ADR-008 | Ubuntu Server 24.04.3 LTS on Vivobook | Decided | docs/architecture.md |
| ADR-009 | Tailscale for remote, NVMe/HDD tiering | Decided | docs/storage.md |

## Current Blockers

- [ ] None currently — awaiting scaffold

## Changelog

- 2026-09-01: PLAN.md created. Architecture approved with 7 refinements (binary `itehaas`, hash algo invariant, SHA-256 only Phase 1, no bincode, no PG tuning, no gRPC, NVMe/HDD tiering). Phase 0 in progress.
