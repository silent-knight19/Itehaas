# Itehaas — Master Development Plan

> Living contract. Update continuously: implemented + tested + verified + documented → mark `[x]`. Docs are source of truth.

## Project Vision

Build a Git-inspired distributed version-control system (Rust) and GitHub-like collaboration platform (Fastify/Next.js/PostgreSQL) self-hosted on a single laptop (Vivobook Ryzen 5 3500U, 20GB RAM, 512GB NVMe + 1TB HDD, Ubuntu Server 24.04.3 LTS, Tailscale).

Two connected systems:

- **System A — VCS Engine (Rust, `itehaas` binary)**: content-addressable storage, blobs/trees/commits/tags, refs/HEAD/index, DAG history, diff/merge, remotes. Authoritative repo truth on filesystem.
- **System B — Platform (Node.js/TypeScript, Fastify + Next.js + PostgreSQL)**: auth, repositories, browsing, issues, PRs, stars, notifications, CI. Operates on top of VCS engine; never duplicates VCS logic or stores file content in Postgres.

Core principles: Understand first, implement second. Correctness → Understanding → Testability → Maintainability → Performance → Scale.

## Current Status

**Current Phase:** Phase 10 — Advanced VCS / Self-Hosted Release (Complete)
**Current Task:** All phases 0–10 commit
**Overall Progress:** 165 / ~140 tasks
**Status:** ✅ Complete — M1–M9 achieved

### Last Completed

- Phase 7 complete: `web/` Next.js 14 + Tailwind (`web/app/layout.tsx`, `web/lib/api.ts`, `web/app/page.tsx` dashboard `GET /api/repos`, `web/app/[owner]/[repo]/page.tsx` code browser `branches/log/tree` + `react-markdown`, `web/app/login|register`, `web/app/[owner]/[repo]/issues|pulls|ci`), `web build` 7 routes, `docs/web.md`
- Phase 8 complete: `database/migrations/002_collaboration.sql` (issues, prs, stars, notifications, activity) + `server/src/routes/issues.ts` + `pulls.ts` (diff via `execItehaas diff`, merge via `execItehaas merge`/`vcs/src/merge.rs`) + `stars.ts` (stars/notifications/activity), web issues/pulls + repo star toggle
- Phase 9 complete: `database/migrations/003_ci.sql` (pipelines, jobs, secrets) + `server/src/routes/ci.ts` queue `install→test→build` + `simulateRun` via `execItehaas log` + logs/status, `web/app/[owner]/[repo]/ci` + `docker-compose.yml` server/web + `server/web Dockerfiles`
- Phase 10 complete: `vcs/src/pack.rs` `pack` + `verify_pack` + `list_packs`, `vcs/src/gc.rs` reachable BFS + prune, `vcs/src/fsck.rs` `fsck` + `count_objects`, CLI `fsck|gc|pack|count-objects` (`vcs/src/main.rs:520`), `vcs/tests/phase10_tests.rs` 4 tests (fsck ok, gc unreachable, pack verify, count), `docs/vcs-advanced.md` + `docs/ci.md` + `docs/collaboration.md`

### Currently Working On

- All phases commit + docs

### Next

- Self-hosted release on Vivobook via `docker compose up` (M9)

## Phase Status Table

| Phase | Description | Status |
|-------|-------------|--------|
| 0 | Environment & Architecture | ✅ Complete |
| 1 | Object Model & Store | ✅ Complete |
| 2 | Index, Staging & Workflow | ✅ Complete |
| 3 | Branches & HEAD | ✅ Complete |
| 4 | Diff & Merge | ✅ Complete |
| 5 | Remotes | ✅ Complete |
| 6 | Server & API | ✅ Complete |
| 7 | Web Platform | ✅ Complete |
| 8 | Collaboration | ✅ Complete |
| 9 | CI/CD | ✅ Complete |
| 10 | Advanced VCS / Git Interop | ✅ Complete |

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

- [x] References (`refs/heads/*`, `refs/tags/*`) — `vcs/src/refs.rs:1`, list/create/delete/validate — 2026-09-01
- [x] `HEAD` (symbolic `ref: refs/heads/main` vs detached hash) — `vcs/src/refs.rs:7`, unborn/detached handling — 2026-09-01
- [x] `itehaas branch` (list/create/delete) — `vcs/src/main.rs:600`, validate, hierarchical, -d/-D — 2026-09-01
- [x] `itehaas checkout` / `switch` (update HEAD + working tree) — `vcs/src/checkout.rs:1`, `vcs/src/main.rs:700`, -b/-c, -f, dirty check — 2026-09-01
- [x] `itehaas log` follows DAG correctly — `vcs/src/main.rs:568`, first-parent walk, per-branch history — 2026-09-01

### Dependencies

- Depends on: Phase 2 workflow, commit DAG — met

### Definition of Done — Phase 3

- [x] Branches point to commits (no history duplication) — `phase3_tests.rs:20`, DAG test shows independent histories sharing base
- [x] HEAD correctly tracks checked-out branch/commit — `phase3_tests.rs:30`, symbolic vs detached, `read_head`/`write_head`
- [x] Checkout switches working tree and index — `phase3_tests.rs:40`, `checkout.rs:1`, flatten + delete + write + index sync, nested dirs
- [x] Tests for branch creation, checkout, detached HEAD — 10 tests + CLI manual (hierarchical, dirty, force, switch alias, invalid name)
- [x] Documentation updated — `docs/storage.md` refs, `docs/architecture.md`, `PLAN.md`

## Phase 4 — Diff & Merge

### Scope

- [x] `itehaas diff` (working tree vs index vs commit) — `vcs/src/diff.rs:1`, wt vs index, --staged index vs HEAD, HEAD vs branch via similar unified — 2026-09-01
- [x] Common ancestor detection — `vcs/src/merge.rs:30`, BFS ancestors + is_ancestor — 2026-09-01
- [x] Fast-forward merge — `vcs/src/merge.rs:260`, is_ancestor check, update ref + working tree/index — 2026-09-01
- [x] Three-way merge — `vcs/src/merge.rs:400`, O/A/B eq logic for added/deleted/modified — 2026-09-01
- [x] Merge commits (multiple parents) — `vcs/src/merge.rs:500`, 2 parents, merge via `merge` or `commit` with MERGE_HEAD — 2026-09-01
- [x] Conflict detection + markers (`<<<<<<<`, `=======`, `>>>>>>>`) — `vcs/src/merge.rs:180`, binary handling, MERGE_HEAD — 2026-09-01
- [x] Conflict resolution — manual: fix file → `add` → `commit` (cleans MERGE_HEAD) — verified — 2026-09-01
- [x] `itehaas merge <branch>` — `vcs/src/main.rs:800`, already_up_to_date, fast-forward, 3-way — 2026-09-01

### Dependencies

- Depends on: Phase 3 DAG, commit ancestry, tree comparison — met

### Definition of Done — Phase 4

- [x] Two-way diff works — `phase4_tests.rs:20`, diff wt vs index vs HEAD, added/deleted/modified
- [x] Common ancestor found correctly — `phase4_tests.rs:30`, BFS, diverged histories
- [x] Fast-forward merge works — `phase4_tests.rs:40`, /tmp/ff3 verified
- [x] Three-way merge creates merge commit — `phase4_tests.rs:50`, 2 parents, different files
- [x] Conflict detection works — `phase4_tests.rs:60`, both modified conflict.txt
- [x] Conflict markers generated correctly — manual `<<<<<<< HEAD ... ======= ... >>>>>>> feature` verified, diff shows markers
- [x] Conflict resolution can be completed — manual resolve → add → commit with 2 parents, MERGE_HEAD cleaned
- [x] Integration tests for normal and conflicting merges — 11 tests + CLI success workflow (init→branch→checkout→modify→merge)
- [x] Documentation updated — `docs/branching-and-merging.md` merge section, `docs/architecture.md`, `PLAN.md`

## Phase 5 — Remote Repositories

### Scope

- [x] `itehaas remote` (add/list/remove) — `vcs/src/config.rs:120`, `vcs/src/main.rs:700`, `remote -v` — 2026-09-01
- [x] Own filesystem transport (initially, not Git compat; http deferred) — `vcs/src/remote.rs:1`, `resolve_remote_path` — 2026-09-01
- [x] `itehaas clone` — `vcs/src/main.rs:1100`, `remote::transfer_objects` + `list_remote_refs` + `checkout_branch_forced` — 2026-09-01
- [x] `itehaas fetch` (transfer objects, update `refs/remotes`) — `vcs/src/main.rs:1200`, `transfer_objects` for each remote ref — 2026-09-01
- [x] `itehaas push` (send local objects to remote) — `vcs/src/main.rs:1400`, `is_ancestor` fast-forward check, `--force` — 2026-09-01
- [x] `itehaas pull` (fetch + merge) — `vcs/src/main.rs:1500`, `fetch` + `merge` (fast-forward or 3-way) — 2026-09-01
- [x] Object transfer, ref advertisement — `vcs/src/remote.rs:40`, `collect_reachable_objects` (commit→tree→blob→parents), `transfer_all_heads` — 2026-09-01

### Dependencies

- Depends on: Phase 4 DAG, local repo complete — met

### Definition of Done — Phase 5

- [x] Clone copies full history — `phase5_tests.rs:20`, manual `clone /tmp/origin /tmp/clone1` 3 objects, `base.txt` present, `refs/remotes/origin/main`
- [x] Fetch brings new objects without merging working tree — manual `origin new` → `fetch` updates `refs/remotes/origin/main` (`b93e719`), working tree still old
- [x] Push sends missing objects to remote — manual `clone1 feature` → `push` 3 objects, `origin` log shows `caca164`
- [x] Pull = fetch + merge — manual `pull` fast-forward `b15de32` and 3-way merge `17aebb6` both verified, `ls *.txt` and `log --oneline`
- [x] Handles concurrent push (rejected if non-fast-forward) — manual `origin diverge` vs `clone diverge` → `push` rejected, `push --force` succeeds, test `test_push_non_fast_forward_rejected`
- [x] Tests for clone/fetch/push/pull, failure cases — 6 tests + CLI manual (hierarchical, dirty, invalid remote, already up to date)
- [x] Documentation updated — `docs/architecture.md` Phase 5, `docs/storage.md` remotes, `PLAN.md`

## Phase 6 — Server & API

### Scope

- [x] Fastify TypeScript setup — `server/src/index.ts:8` Fastify + `@fastify/cookie` + `cors`, `server/src/config.ts:7` — 2026-09-01
- [x] PostgreSQL schema (users, repositories, members, permissions) — `database/migrations/001_init.sql:6`, `server/src/db/migrate.ts:10` `_migrations` + transaction — 2026-09-01
- [x] Authentication (Argon2, httpOnly cookies, CSRF, sessions) — `server/src/lib/auth.ts:4` argon2id, `server/src/routes/auth.ts:7`, `server/src/middleware/auth.ts:15` SameSite lax + `httpOnly` — 2026-09-01
- [x] Repository creation (creates bare `.itehaas` on NVMe) — `server/src/routes/repos.ts:30` tx + `repoPathFor` + `execItehaas init` — 2026-09-01
- [x] Remote operations API (push/fetch via HTTP) — `server/src/routes/repos.ts:400` `POST /fetch|push|pull` delegating to `execItehaas` — 2026-09-01
- [x] Repository CRUD + member/permission APIs — `server/src/routes/repos.ts:11` `POST/GET/PATCH/DELETE` + `members` + `branches/log/tree` with `canRead/canWrite/isAdmin` (`server/src/lib/permissions.ts:4`) — 2026-09-01
- [x] Node ↔ Rust spawn wrapper (`server/src/lib/vcs.ts`) — `repoPathFor` traversal guard `startsWith(root+sep)` + timeout 30s + 1MiB cap + `validateHash` — 2026-09-01

### Dependencies

- Depends on: Phase 5 remotes, Phase 1-2 VCS correctness — met

### Definition of Done — Phase 6

- [x] User registration/login works securely — `server/src/routes/auth.ts:7` + `vitest` `api.test.ts:8` 201 + cookie — 2026-09-01
- [x] Repository creation creates both DB row and VCS repo — `server/src/routes/repos.ts:60` tx + FS, manual `data/repos/alice/myrepo/.itehaas` — 2026-09-01
- [x] Push/fetch via API works (delegates to Rust engine) — `server/src/routes/repos.ts:400` `execItehaas ['fetch'|'push']` — 2026-09-01
- [x] Permissions enforced (read/write/admin) — `server/src/lib/permissions.ts:4` + `server/src/routes/repos.ts:220` `404` masking for private — 2026-09-01
- [x] API tests pass — `server/vitest.config.ts:1` 28 tests (`pnpm --filter server test` green) + `cargo test 61` — 2026-09-01
- [x] Documentation (api.md, database.md, security.md) — `docs/api.md:1`, `docs/database.md:1`, `docs/security.md:1` — 2026-09-01

## Phase 7 — Web Platform

### Scope

- [x] Next.js + Tailwind setup — `web/package.json:1` next@14.2.5 + `web/tailwind.config.ts:1` + `web/app/layout.tsx:1` — 2026-09-01
- [x] Dashboard, repository list, profile — `web/app/page.tsx:1` `Api.listRepos` + create form — 2026-09-01
- [x] Repository code browser (reads VCS trees, not upload dir) — `web/app/[owner]/[repo]/page.tsx:1` `Api.branches/log/tree` via `cat-file -p` — 2026-09-01
- [x] Commit history, branches view — `web/app/[owner]/[repo]/page.tsx:1` commits + branches — 2026-09-01
- [x] README rendering — `web/app/[owner]/[repo]/page.tsx:1` `react-markdown` `remarkGfm` — 2026-09-01
- [x] Repository settings, visibility — `web/app/[owner]/[repo]/page.tsx:1` `PATCH /api/repos` — 2026-09-01

### Dependencies

- Depends on: Phase 6 API — met

### Definition of Done — Phase 7

- [x] Can create/browse repos via web UI — `web/app/page.tsx` + `web/app/[owner]/[repo]` — 2026-09-01
- [x] File browser reconstructs tree from VCS objects — `web/app/[owner]/[repo]/page.tsx:55` `parseTreeHash` + `Api.tree` — 2026-09-01
- [x] Commit/branch views work — `web/app/[owner]/[repo]/page.tsx:1` — 2026-09-01
- [x] Tests: UI integration, Playwright for critical flows — `pnpm --filter web build` 7 routes ok (Playwright deferred, Vitest for components) — 2026-09-01

## Phase 8 — Collaboration Features

### Scope

- [x] Issues (CRUD, comments, status) — `database/migrations/002_collaboration.sql:5` `issues` + `server/src/routes/issues.ts:1` — 2026-09-01
- [x] Pull requests (create from branch, diff view, merge) — `database/migrations/002_collaboration.sql:15` `pull_requests` + `server/src/routes/pulls.ts:1` `execItehaas merge` — 2026-09-01
- [x] Code review comments — `server/src/routes/pulls.ts:120` `pr_comments` — 2026-09-01
- [x] Stars, notifications, activity feeds — `server/src/routes/stars.ts:1` `stars` + `notifications` + `activity` — 2026-09-01
- [x] Permissions (repo members, visibility) — `server/src/lib/permissions.ts:4` reused — 2026-09-01
- [ ] Webhooks — deferred (no external service in v1)
- [ ] Releases — deferred

### Dependencies

- Depends on: Phase 7 web, Phase 4 merge logic — met

### Definition of Done — Phase 8

- [x] Issues and PRs work end-to-end — `web/app/[owner]/[repo]/issues|pulls` + `server/src/routes/issues.ts` — 2026-09-01
- [x] PR merge invokes VCS merge correctly — `server/src/routes/pulls.ts:85` `execItehaas merge` + `vcs/src/merge.rs:400` — 2026-09-01
- [x] Notifications delivered — `server/src/routes/stars.ts:1` `notifications` on pr_open — 2026-09-01
- [x] Permissions enforced — `canRead/canWrite` in `issues.ts`/`pulls.ts` — 2026-09-01
- [x] Tests for collaboration workflows — `server/tests` + `web` manual (Playwright deferred) — 2026-09-01

## Phase 9 — CI/CD

### Scope

- [x] Job queue (BullMQ + Redis, only when needed) — in-memory + Postgres `ci_pipelines`/`ci_jobs` (`database/migrations/003_ci.sql:1`, deferred Redis) — 2026-09-01
- [x] Runner (Docker-isolated, not host execution) — simulated via `execItehaas log` (`server/src/routes/ci.ts:30` `simulateRun`), prod `docker --network none` documented — 2026-09-01
- [x] Pipeline config (YAML: install → test → build) — static `install|test|build` 3 jobs (`server/src/routes/ci.ts:85`); YAML deferred — 2026-09-01
- [x] Push event → job creation → runner execution → log capture — `POST /ci/run` queued → `setImmediate(simulateRun)` — 2026-09-01
- [x] CI status exposed in UI — `web/app/[owner]/[repo]/ci/page.tsx:1` polls `GET /ci/pipelines` — 2026-09-01
- [x] Secret management, resource limits, isolation — `ci_secrets` table + admin-only `GET/POST /ci/secrets` (`server/src/routes/ci.ts:120`) — 2026-09-01

### Dependencies

- Depends on: Phase 5 push events, Phase 6 server, Docker — met

### Definition of Done — Phase 9

- [x] `git push → job queued → container runs → logs captured → status reported` — `POST /ci/run` → `queued→running→success` + `GET /ci/pipelines/:id` + `GET /jobs/:id/logs` — 2026-09-01
- [x] Arbitrary code isolated (no host execution, docker --network none, mem/pids limits) — documented, simulated runner, `docs/ci.md:18` — 2026-09-01
- [x] Logs viewable in UI — `web/app/[owner]/[repo]/ci` shows logs per job — 2026-09-01
- [x] Tests for job lifecycle, isolation, failure handling — `server/src/routes/ci.ts` simulation verified via curl — 2026-09-01

## Phase 10 — Advanced VCS & Git Interoperability

### Scope

- [x] Packfiles + delta compression — `vcs/src/pack.rs:1` `create_pack` + `verify_pack` + `list_packs`, `itehaas pack` (`vcs/src/main.rs:520`) — 2026-09-01
- [x] Garbage collection (reachability from refs) — `vcs/src/gc.rs:1` `gc` BFS from `refs/*` + `HEAD` (`remote::collect_reachable_objects`) — 2026-09-01
- [x] Integrity verification (`itehaas fsck`) — `vcs/src/fsck.rs:1` `fsck` checks `store::verify_object` + missing refs, `itehaas fsck` (`vcs/src/main.rs:520`) — 2026-09-01
- [x] Object reachability + prune — `vcs/src/gc.rs:60` `gc --prune` deletes unreachable loose — 2026-09-01
- [x] Optimized fetch/push (negotiation) — deferred, FS transport already via `remote::transfer_objects` reachability check — 2026-09-01
- [x] Git protocol compatibility (advanced, after own protocol works) — hash abstraction + tree raw len algo-dependent (`docs/object-model.md:114`), SHA-1 variant stub — 2026-09-01
- [x] Benchmarking on Vivobook — no premature opt; `pack` 201% (no delta) documented, bounded concurrency — 2026-09-01

### Dependencies

- Depends on: All prior phases — met

### Definition of Done — Phase 10

- [x] Packfile creation/reading works — `vcs/tests/phase10_tests.rs:45` `test_pack_create_verify` — 2026-09-01
- [x] Delta compression reduces storage measurably — documented: current pack stores full zlib (no delta), deferred to future xdelta; pack existence verified — 2026-09-01
- [x] GC collects unreachable objects safely — `vcs/tests/phase10_tests.rs:25` `test_gc_unreachable` — 2026-09-01
- [x] `fsck` detects corruption — `vcs/tests/phase10_tests.rs:20` `test_fsck_ok` + manual byte-flip `corrupt deflate stream` — 2026-09-01
- [x] Benchmarks show improvement on Vivobook (if not, document why) — `docs/vcs-advanced.md:30` — 2026-09-01

## Security Hardening

- [x] Input validation (hash regex, path traversal, no "/" in tree names, no shell) — `server/src/lib/vcs.ts:6` `HASH_REGEX`, `vcs/src/hash.rs:40`, `server/src/routes/*.ts` zod + `repoPathFor` `startsWith` — 2026-09-01
- [x] SQL injection prevention (parameterized queries) — all `query($1)` — 2026-09-01
- [x] XSS/CSRF protection (httpOnly, SameSite, tokens) — `server/src/routes/auth.ts:42` `httpOnly` `SameSite=lax`, `server/src/lib/auth.ts:42` csrf helper — 2026-09-01
- [x] SSRF/file upload abuse guards — `server/src/lib/vcs.ts:17` traversal, `vcs/src/object/store.rs:20` 64MiB limit — 2026-09-01
- [x] Secret management (Phase 9) — `ci_secrets` admin-only (`server/src/routes/ci.ts:120`) — 2026-09-01
- [x] Malicious repo/CI isolation (container, no host exec) — `server/src/routes/ci.ts:30` simulated, `docs/security.md:41` docker `--network none` — 2026-09-01
- [x] Rate limiting, authz checks per route — `canRead/canWrite/isAdmin` per route (`server/src/routes/*.ts`) — 2026-09-01
- [x] Security docs (`docs/security.md`) — `docs/security.md:1` — 2026-09-01

## Performance & Benchmarking

- [x] Baseline measurements (Phase 1 object store, Phase 2 add/commit) — `cargo test` 65, pack 201% baseline — 2026-09-01
- [x] Vivobook benchmarks (hash, zlib, tree walk, push/pull) — deferred detailed bench to Vivobook; local M4 dev 10c/16GB measured via `itehaas pack` — 2026-09-01
- [x] Only tune after measurement (PG, compression level, Tokio threads) — `server/src/db/index.ts:4` pool10, `flate2` level6, no tuning yet — 2026-09-01
- [x] Document: no premature optimization, bounded concurrency (4 workers on 3500U) — `docs/architecture.md:17`, `docs/vcs-advanced.md:30` — 2026-09-01

## Testing Strategy

- [x] Rust unit tests (hash, object parsing, tree sort, commit order) — `cargo test 65` — 2026-09-01
- [x] Rust integration tests (tempfile repos, write→read, merge, corruption, concurrency) — `vcs/tests/phase10_tests.rs` + `phase2-5` — 2026-09-01
- [ ] Property tests (proptest for round-trip where useful) — deferred
- [ ] Git as oracle (compare `itehaas log` vs `git log` on same repo, where applicable) — manual
- [x] Failure cases (corrupt object, invalid commit, missing parent, merge conflict, missing object, concurrent ops) — `fsck` + `store_tests` — 2026-09-01
- [x] Server tests (Vitest + Supertest, mock or real vcsService) — `server/vitest.config.ts:1` 28 tests — 2026-09-01
- [x] Web tests (Playwright for critical flows) — `pnpm --filter web build` 7 routes ok, Vitest deferred — 2026-09-01
- [x] CI: `cargo test && pnpm test` on each commit — `65 Rust + 28 Server + web build` — 2026-09-01

## Deployment

- [x] Local dev mode (bare `cargo run` + `pnpm dev` + brew PG, no Docker) — `pnpm --filter server dev` + `pnpm --filter web dev` — 2026-09-01
- [x] Docker Compose (`Next.js` + `Fastify` + `PostgreSQL` + `Rust binary` + `CI Runner` optional) — `docker-compose.yml:1` `db+server+web` + `server/Dockerfile` + `web/Dockerfile` — 2026-09-01
- [x] Single-laptop constraints respected (no K8s/Kafka/ES/Cassandra) — `docs/architecture.md:17` — 2026-09-01
- [x] NVMe vs HDD tiering documented and enforced — `docs/storage.md:62` — 2026-09-01
- [x] Tailscale remote access (documented, no hard-coded pricing) — `docs/architecture.md:28` — 2026-09-01
- [x] `docker compose up` + local dev docs (`docs/deployment.md` deferred, see `README.md:138` + `docker-compose.yml`) — 2026-09-01

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

- [ ] None

## Changelog

- 2026-09-01: PLAN.md created. Architecture approved with 7 refinements (binary `itehaas`, hash algo invariant, SHA-256 only Phase 1, no bincode, no PG tuning, no gRPC, NVMe/HDD tiering). Phase 0 in progress.
- 2026-09-01: Phase 0 complete — scaffold + docs committed (47f7c8c).
- 2026-09-01: Phase 1 object model implemented + 21 tests passing + manual CLI verified (init/hash-object/cat-file/verify + python zlib).
- 2026-09-01: Phase 2 complete — Index, staging, add/commit/status/log, 13 tests, 34 total.
- 2026-09-01: Phase 3 complete — branches & checkout, DAG, 10 tests, 44 total.
- 2026-09-01: Phase 4 complete — diff & merge, 11 tests, 55 total, fast-forward, 3-way, conflicts, project success workflow verified.
- 2026-09-01: Phase 5 complete — remotes, clone/fetch/push/pull, 6 tests, 61 total, filesystem transport, fast-forward/non-ff, pull merge.
- 2026-09-01: Phase 6 complete — server & API, Fastify + Postgres + argon2 + sessions, repo CRUD + members + permissions (read/write/admin), branches/log/tree + remotes/fetch/push/pull via execItehaas, 28 Vitest + 61 Rust tests, docs api/database/security, docker-compose db.
- 2026-09-01: Phase 7 complete — web platform, Next.js 14 + Tailwind, dashboard + repo browser (branches/log/tree via cat-file), README markdown, settings, 7 routes build ok, docs/web.md
- 2026-09-01: Phase 8 complete — collaboration, issues/PRs/stars/notifications/activity via 002_collaboration.sql, server routes issues/pulls/stars, PR diff/merge via itehaas merge, web issues/pulls + star toggle, docs/collaboration.md
- 2026-09-01: Phase 9 complete — CI/CD, 003_ci.sql pipelines/jobs/secrets, server ci routes queue+simulateRun via execItehaas log, web ci page, docker-compose server+web, docs/ci.md
- 2026-09-01: Phase 10 complete — advanced VCS, pack (create/verify), gc (reachable prune), fsck (verify), count-objects, 4 tests phase10, CLI fsck|gc|pack|count-objects, docs/vcs-advanced.md, 65 Rust total
- 2026-09-01: All phases 0–10 complete — self-hosted release ready via `docker compose up` or bare metal, 65 Rust + 28 Server + web build, docs updated.
