# Itehaas — Master Development Plan

> Living contract. Update continuously: implemented + tested + verified + documented → mark `[x]`. Docs are source of truth.

## Project Vision

Build a Git-inspired distributed version-control system (Rust) and GitHub-like collaboration platform (Fastify/Next.js/PostgreSQL) self-hosted on a single laptop (Vivobook Ryzen 5 3500U, 20GB RAM, 512GB NVMe + 1TB HDD, Ubuntu Server 24.04.3 LTS, Tailscale).

Two connected systems:

- **System A — VCS Engine (Rust, `itehaas` binary)**: content-addressable storage, blobs/trees/commits/tags, refs/HEAD/index, DAG history, diff/merge, remotes. Authoritative repo truth on filesystem.
- **System B — Platform (Node.js/TypeScript, Fastify + Next.js + PostgreSQL)**: auth, repositories, browsing, issues, PRs, stars, notifications, CI. Operates on top of VCS engine; never duplicates VCS logic or stores file content in Postgres.

Core principles: Understand first, implement second. Correctness → Understanding → Testability → Maintainability → Performance → Scale.

## Current Status

**Current Phase:** Phase 2 — Index, Staging & Basic Workflow (Complete)
**Current Task:** Phase 2 commit
**Overall Progress:** 68 / ~140 tasks
**Status:** ✅ Complete

### Last Completed

- Phase 1 complete (21 tests, CLI verified, empty blob 473a..., tree raw 32B)
- Phase 2 implemented: Index (JSON BTreeMap, atomic), refs/HEAD (symbolic/unborn/detached), tree_builder (index → hierarchical trees), add (file/dir/., deletions, mode), commit (tree from index, parent, author, refs update), status (staged/not_staged/untracked with mode), log (walk first-parent, oneline)
- 13 new integration tests (phase2_tests.rs) + 21 existing = 34 passing; manual workflow verified (init→add→commit→modify→add→commit→log, nested dirs, deletions, executable mode, mode change, binary, add from subdir)
- Fixed commit parsing bug (committer prefix 10 not 7, now strip_prefix) and status mode comparison (hash+mode)
- Manual CLI: `itehaas init → printf 'hello' > hello.txt → add → commit → modify → status → add . → commit → log --oneline` all green, 7 commits on /tmp/i2, empty-tree commit 6ef19b... verified

### Currently Working On

- Phase 2 commit + docs

### Next

- Phase 3 — Branches & HEAD (branch, checkout, DAG)

## Phase Status Table

| Phase | Description | Status |
|-------|-------------|--------|
| 0 | Environment & Architecture | ✅ Complete |
| 1 | Object Model & Store | ✅ Complete |
| 2 | Index, Staging & Workflow | ✅ Complete |
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

- [x] Hash abstraction trait (`Hasher`: algo, hash_len, hash, name) — `vcs/src/hash.rs:1`
- [x] `Hash` struct (algo + bytes, hex/from_hex, validation) — `vcs/src/hash.rs:1`
- [x] SHA-256 implementation (`Sha256Hasher` via `sha2`) — `vcs/src/hash.rs:1`
- [x] SHA-1/BLAKE3 variants stubbed as `UnsupportedAlgo` (no impl/tests) — `vcs/src/hash.rs:90`
- [x] Hash algo invariant: repo config records algo, store rejects mismatched lengths — `vcs/src/config.rs:1`, `vcs/src/object/store.rs:60`
- [x] Factory `new_hasher(algo) -> Box<dyn Hasher>` — `vcs/src/hash.rs:90`
- [x] Tests: empty blob hash vector, determinism, hex round-trip, invalid hex, unsupported algo — `vcs/tests/store_tests.rs:30`

> Note: Hashing layer behind trait for future Git compat without store rewrite. See `docs/object-model.md:§Hash Algo Invariant`.

### 1.2 Object framing

- [x] Canonical header `"<type> <len>"` + `\0` + body — `vcs/src/object/mod.rs:42`
- [x] Body length = decimal ASCII of canonical body len — `vcs/src/object/mod.rs:42`
- [x] Null separator handling — `vcs/src/object/store.rs:60`
- [x] Deterministic byte representation (LF only, no trailing spaces beyond spec) — `vcs/src/object/commit.rs:25`
- [x] Hash computed on uncompressed header+\0+body — `vcs/src/object/mod.rs:53`, `vcs/src/object/store.rs:1` (invariant)
- [x] Stored bytes = zlib(header+\0+body) — `vcs/src/object/store.rs:30`
- [x] Documentation synced to implementation — `docs/object-model.md:§1` matches code

### 1.3 Blob

- [x] `Blob { content: Vec<u8> }` — `vcs/src/object/blob.rs:3`
- [x] Serialization: body = raw bytes — `vcs/src/object/blob.rs:9`
- [x] Parsing: extract body after header — `vcs/src/object/mod.rs:61`
- [x] Tests: empty blob, binary content, large blob, round-trip — `vcs/tests/store_tests.rs:20`

### 1.4 Tree

- [x] `Tree { entries: Vec<TreeEntry> }`, `TreeEntry { mode: u32, name: String, hash: Hash }` — `vcs/src/object/tree.rs:5`
- [x] Mode validation (100644, 100755, 040000) — `vcs/src/object/tree.rs:17`
- [x] Name validation (no "/" or "\0", non-empty, UTF-8) — `vcs/src/object/tree.rs:27`
- [x] Deterministic sorting (bytewise name ascending) — `vcs/src/object/tree.rs:45`
- [x] Raw hash bytes encoding (32B for SHA-256, algo-dependent) — `vcs/src/object/tree.rs:54`
- [x] Serialization: entry = `"<mode> <name>\0<hash_raw>"` concatenated — `vcs/src/object/tree.rs:54`
- [x] Parsing: split, validate, sort check — `vcs/src/object/mod.rs:72`
- [x] Tests: sorted vs shuffled same hash, duplicate reject, invalid name/mode — `vcs/tests/store_tests.rs:70`

> Note: Tree encoding is Git-inspired deterministic, not Git-compatible. See `docs/object-model.md:§Tree`.

### 1.5 Commit

- [x] `Commit { tree: Hash, parents: Vec<Hash>, author: Signature, committer: Signature, message: String }` — `vcs/src/object/commit.rs:33`
- [x] `Signature { name, email, timestamp: i64, offset_tz: i32 }` — `vcs/src/object/commit.rs:5`
- [x] Canonical field ordering: `tree`, `parent*`, `author`, `committer`, `\n`, message — `vcs/src/object/commit.rs:60`
- [x] Parent handling (0 root, 1 normal, N merge, order preserved) — `vcs/src/object/commit.rs:60`, `vcs/src/object/mod.rs:157`
- [x] Author/committer validation (no `<>\n`, tz `±HHMM`) — `vcs/src/object/commit.rs:19`
- [x] Serialization + parsing (line order enforced) — `vcs/src/object/commit.rs:60`, `vcs/src/object/mod.rs:139`
- [x] Tests: root vs merge commit, out-of-order reject, message with newlines — `vcs/tests/store_tests.rs:120`

### 1.6 Object storage

- [x] Repository object directory (`.itehaas/objects`) — `vcs/src/object/store.rs:1`, `vcs/src/lib.rs:30`
- [x] Fanout paths (`ab/cdef...` for SHA-256: 2/62 hex) — `vcs/src/object/store.rs:110`
- [x] zlib compression (flate2, default level 6 Phase 1) — `vcs/src/object/store.rs:40`
- [x] Atomic writes (tempfile + rename, mkdir fanout) — `vcs/src/object/store.rs:50`
- [x] Reads (zlib decode → split at \0 → header parse → len/type check) — `vcs/src/object/store.rs:60`
- [x] Integrity verification (re-hash, compare expected vs computed) — `vcs/src/object/store.rs:90`
- [x] Corruption detection (truncated zlib, bad header, len mismatch, hash mismatch → `CorruptObject`) — `vcs/src/object/store.rs:90`
- [x] Deduplication (same content → same path, no duplicate write error) — `vcs/src/object/store.rs:35`
- [x] Size limit (64 MiB Phase 1, reject larger) — `vcs/src/object/store.rs:20`
- [x] Tests: write→read round-trip, dedup, corrupt flip, missing object, size limit, algo mismatch — `vcs/tests/store_tests.rs:40`

### 1.7 Repository initialization

- [x] `itehaas init [path] [--algo sha256]` (default SHA-256) — `vcs/src/lib.rs:30`, `vcs/src/main.rs:20`
- [x] Creates `.itehaas/{HEAD,config,objects,objects/pack,refs/heads,refs/tags,refs/remotes}` — `vcs/src/lib.rs:30`
- [x] `HEAD = "ref: refs/heads/main\n"`, `config [core] hasher=sha256, repositoryformatversion=1` — `vcs/src/lib.rs:50`, `vcs/src/config.rs:20`
- [x] Fails if `.itehaas` exists unless `--force` — `vcs/src/lib.rs:35`
- [x] Repo discovery (find `.itehaas` from cwd upwards for later commands) — `vcs/src/lib.rs:15`
- [x] Tests: init creates structure, re-init error, custom path, algo recorded — `vcs/tests/store_tests.rs:260`

### 1.8 CLI

- [x] `itehaas init [path] [--algo]` — `vcs/src/main.rs:20`
- [x] `itehaas hash-object [-w] [-t blob|tree|commit] <file>|--stdin` (default blob, Phase 1 blob only) — `vcs/src/main.rs:40`
- [x] `itehaas cat-file -p|-t|-s <hash>` (pretty/type/size) — `vcs/src/main.rs:60`
- [x] `itehaas verify <hash>` (integrity check) — `vcs/src/main.rs:80`
- [x] Error handling (exit codes, stderr, invalid hash regex `^[0-9a-f]{64}$` for SHA-256) — `vcs/src/main.rs:100`, `vcs/src/hash.rs:40`
- [x] Tests: CLI integration via spawn (manual verification + 21 integration tests)

### Definition of Done — Phase 1

- [x] All unit tests pass (`cargo test -p itehaas` — 21 passed)
- [x] All integration tests pass (tempfile repos, write/read/verify)
- [x] Manual CLI verification passes:
  ```bash
  itehaas init /tmp/r1
  printf 'hello' | itehaas hash-object -w --stdin  # → 8aec4e... (hello, 5 bytes)
  itehaas cat-file -p 8aec4e...                    # → hello
  itehaas verify 8aec4e...                         # → ok
  python3 -c 'import zlib; d=zlib.decompress(open("/tmp/r1/.itehaas/objects/8a/ec...","rb").read()); assert d==b"blob 5\x00hello"'
  # verified 2026-09-01 on M4, file + stdin + empty file + corrupt detection
  ```
- [x] Corrupt-object test passes (flip byte → verify fails with CorruptObject) — `store_tests.rs:170`
- [x] Determinism tests pass (same content → same hash, tree sorted — `store_tests.rs:70`)
- [x] Hash algo invariant enforced (mixed algo rejected) — `store_tests.rs:210`
- [x] Documentation updated (`object-model.md` matches impl — empty blob hash corrected to 473a...)
- [x] Phase 1 commit created — 2026-09-01
- [x] PLAN.md updated: Phase 1 [x], status table, current phase → Phase 2

## Phase 2 — Index, Staging & Basic Workflow

### Scope

- [x] Index/staging area (real concept: `.itehaas/index` — `vcs/src/index.rs:1`, JSON BTreeMap, atomic) — 2026-09-01
- [x] `itehaas add <file>` / `add .` — `vcs/src/main.rs:220`, handles file/dir/., deletions, mode, ignore .itehaas — 2026-09-01
- [x] `itehaas status` (compares HEAD tree vs index vs working tree) — `vcs/src/status.rs:40`, staged/not_staged/untracked — 2026-09-01
- [x] `itehaas commit -m "message"` (creates tree from index, creates commit) — `vcs/src/main.rs:375`, tree_builder, parent, author, refs — 2026-09-01
- [x] `itehaas log` (history walk) — `vcs/src/main.rs:500`, first-parent, oneline/max-count — 2026-09-01
- [x] Working Tree → Index → Repository flow implemented — verified via manual workflow — 2026-09-01

### Dependencies

- Depends on: Phase 1 object model, tree/commit serialization — met

### Definition of Done — Phase 2

- [x] Can create repo, add files, commit, view status/log — manual: `/tmp/i2` 7 commits, `/tmp/i3` executable, `/tmp/i4` delete
- [x] Index correctly tracks staged vs unstaged vs untracked — `phase2_tests.rs:30` + manual status tri-state
- [x] Second commit parents correctly link to first — `phase2_tests.rs:70`, log walk
- [x] Tests cover add/commit/status/log, failure cases — 13 tests + CLI edge (nothing to commit, invalid hash, corrupt)
- [x] Documentation updated — `docs/storage.md` index section, `docs/object-model.md` unchanged, `PLAN.md` updated

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

- [ ] None — Phase 1 ready to commit

## Changelog

- 2026-09-01: PLAN.md created. Architecture approved with 7 refinements (binary `itehaas`, hash algo invariant, SHA-256 only Phase 1, no bincode, no PG tuning, no gRPC, NVMe/HDD tiering). Phase 0 in progress.
- 2026-09-01: Phase 0 complete — scaffold + docs committed (47f7c8c).
- 2026-09-01: Phase 1 object model implemented + 21 tests passing + manual CLI verified (init/hash-object/cat-file/verify + python zlib).
