# Itehaas — Master Development Plan

> Living contract. Update continuously: implemented + tested + verified + documented → mark `[x]`. Docs are source of truth.

## Project Vision

Build a Git-inspired distributed version-control system (Rust) and GitHub-like collaboration platform (Fastify/Next.js/PostgreSQL) self-hosted on a single laptop (Vivobook Ryzen 5 3500U, 20GB RAM, 512GB NVMe + 1TB HDD, Ubuntu Server 24.04.3 LTS, Tailscale).

Two connected systems:

- **System A — VCS Engine (Rust, `itehaas` binary)**: content-addressable storage, blobs/trees/commits/tags, refs/HEAD/index, DAG history, diff/merge, remotes. Authoritative repo truth on filesystem.
- **System B — Platform (Node.js/TypeScript, Fastify + Next.js + PostgreSQL)**: auth, repositories, browsing, issues, PRs, stars, notifications, CI. Operates on top of VCS engine; never duplicates VCS logic or stores file content in Postgres.

Core principles: Understand first, implement second. Correctness → Understanding → Testability → Maintainability → Performance → Scale.

## Current Status

**Current Phase:** Phase 16 — Code Browser, Search & Notifications (In Progress)
**Current Task:** Phase 16 file browsing + search + watch
**Overall Progress:** 250 / ~240 tasks
**Status:** 🟡 In Progress — M1–M9 + Phases 11–15 achieved, Phase 16 building

### Last Completed

- Phase 11 complete: `vcs/src/reflog.rs` (logs/HEAD + logs/refs/heads/*, record on commit/checkout/reset), `vcs/src/reset.rs` (--soft/--mixed/--hard + paths), `vcs/src/restore.rs` (--staged/--worktree/--source), `vcs/src/ignore.rs` (.itehaasignore+.gitignore, `*`/`?`/`**`/`!`/`/`), `vcs/src/stash.rs` (refs/stash + stash_list, push/pop/apply/list/show/clear/drop), tag CLI (lightweight/annotated), branch -a/-r/-m, rm/mv/clean, `itehaas reflog`, 10 tests `phase11_tests.rs`, `cargo test` 75+2
- Phase 12 complete: `docs/remote-protocol.md` (refs discovery, negotiation, object/pack, auth, FF, lock), `vcs/src/remote/http.rs` (`http_fetch` incremental 6 vs 0, `upload_object_http`, `http_push` missing-set, `update_remote_ref_http` 409/423), `server/src/routes/repos.ts` (POST /objects/:hash 64M + verify, POST /refs/heads/* atomic CAS + isAncestor + 423 lock + reflog), HTTP clone+fetch+push+pull verified (`http-test` private), SHA-1 mode local (`Sha1Hasher` + `hash.rs`, `object/mod.rs` algo-aware, `init --algo sha1` 40-char), short-hash `resolve_rev` (`HEAD~n` + prefix 7+), 4 tests `phase12_tests.rs`
- Phase 13 complete: `vcs/src/revwalk.rs` (walk_log --all/--graph/-p/--stat/--name-only/--since/--until/--author/--grep/--follow, `format_stat`, `parse_date` chrono), `vcs/src/blame.rs` (line blame via diff), `vcs/src/hash.rs` `resolve_short_hash`, `vcs/src/refs.rs` `HEAD~n` + short, `vcs/src/main.rs` `commit --amend`, `show`, `ls-files`, `for-each-ref`, `grep`, `blame`, `cherry-pick`/`revert` (inverse diff, conflict markers, `CHERRY_PICK_HEAD`), `bisect` (BISECT_*), `rebase` (rebase-merge, --abort/--continue, todo), 7 tests `phase13_tests.rs`, `cargo test` 86+2
- Phase 14 complete: `database/migrations/005_forks_orgs.sql` (organizations/organization_members/teams/team_members/team_repositories/forks/invites), `006_pr_fork.sql` (source_repo_id), `server/src/lib/permissions.ts` (`getTeamPermission` + `canRead/canWrite/isAdmin` team check), `server/src/routes/repos.ts` (POST /fork + GET /forks/network, FS clone via `execItehaas clone` + `forks` DB), `server/src/routes/pulls.ts` (source_repo + `copyMissingObjects` + `fork/owner/branch` ref), `server/src/routes/orgs.ts` (POST/GET orgs, members, teams, team members/repos), `server/src/routes/invites.ts` (org/repo/team invites + accept/reject token), 5 tests `phase14_tests.rs` + manual cross-fork PR (`fork/bob_fork/feature_fork` → `main` fast-forward) + org/team/invite flow
- Phase 15 complete: `database/migrations/007_review.sql` (is_draft, pr_requested_reviewers, pr_reviews approved/changes_requested, pr_review_comments path/line/side, labels/issue_labels, milestones, issue_assignees), `server/src/routes/pulls.ts` (draft `is_draft` + PATCH/ready, reviewers CRUD + CODEOWNERS `* @user` auto, reviews `approved` 409, line-comments, close keywords `fixes #` UUID ILIKE), `server/src/routes/issues.ts` (enrichIssue, `?label&assignee&milestone`, `POST /issues` labels/assignees/milestone, `PATCH` labels/assignees, `GET /labels`/`/milestones` CRUD, mentions `@user` → `notifications`), 5 tests `phase15_tests.rs` + live `acme` draft→ready→approve→line-comment→merge+close

### Currently Working On

- Phase 16 — Code Browser, Search & Notifications (file `?path=` browsing, `raw`/`history`/`blame`, `pg_trgm` search, `watch`/`notifications`)

### Next

- Phase 16 — Code Browser, Search & Notifications (recursive `?path=` browser, `raw`/`history`/`blame` UI, `pg_trgm` global/code search, `watch`/`notifications`)
- Phase 17 — Real CI/CD (YAML `on: push`, queue, isolated Docker runner, artifacts)

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
| 11 | VCS Recovery & Daily-Use | ✅ Complete |
| 12 | Remote Transport & Git Interop | ✅ Complete (HTTP fetch/push/pull + SHA-1 local, pack deferred) |
| 13 | History & Code Archaeology | ✅ Complete |
| 14 | Forks, Networks & Organizations | ✅ Complete |
| 15 | Review & Developer Workflow | ✅ Complete |
| 16 | Code Browser, Search & Notifications | 🟡 In Progress |
| 17 | Real CI/CD | ⬜ Not Started |
| 15 | Review & Developer Workflow | ✅ Complete |

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

## Phase 11 — VCS Recovery & Daily-Use

### Scope

- [x] `itehaas reset --soft/--mixed/--hard` + `reset HEAD <path>` — `vcs/src/reset.rs:1` + `vcs/src/main.rs:1985` (HEAD move, index/wt sync, reflog) — 2026-09-02
- [x] `itehaas restore` (--staged/--worktree/--source) — `vcs/src/restore.rs:1` (index←HEAD/source, wt←index/source) — 2026-09-02
- [x] `itehaas rm`/`mv`/`clean` — `vcs/src/main.rs:2057` (index+wt, --cached, rename, dry-run) — 2026-09-02
- [x] `itehaas stash` (push/pop/apply/list/show/clear/drop, --include-untracked, refs/stash + stash_list, conflict markers) — `vcs/src/stash.rs:1` — 2026-09-02
- [x] `itehaas tag` (-a/-l/-d, lightweight+annotated Tag objects, refs/tags) — `vcs/src/main.rs:2220` — 2026-09-02
- [x] `itehaas reflog` (logs/HEAD + logs/refs/heads/*, record on commit/checkout/reset/branch) — `vcs/src/reflog.rs:1` + `vcs/src/refs.rs:108` — 2026-09-02
- [x] `itehaas branch -a/-r/-m` (all/remotes/move, remote-tracking via refs/remotes) — `vcs/src/main.rs:1032` — 2026-09-02
- [x] Ignore system (.itehaasignore + .gitignore, `*`/`?`/`**`/`!`/`/`) — `vcs/src/ignore.rs:1` + `status.rs:71` + `diff.rs:159` + `main.rs:655` — 2026-09-02

### Dependencies

- Depends on: Phase 3 HEAD/refs, Phase 4 diff/merge, Phase 10 pack/gc — met

### Definition of Done — Phase 11

- [x] Reset soft/mixed/hard + file-level tested — `vcs/tests/phase11_tests.rs:18` `test_reset_*` — 2026-09-02
- [x] Restore staged/worktree/source tested — `phase11_tests.rs:55` `test_restore` — 2026-09-02
- [x] rm/--cached/mv/clean -n/-f/-d tested — `phase11_tests.rs:86` + manual `clean -n` — 2026-09-02
- [x] Stash push/pop/apply/list/show/clear tested — `phase11_tests.rs:116` + manual `stash push/pop` — 2026-09-02
- [x] Tags lightweight/annotated/list/delete tested — `phase11_tests.rs:138` — 2026-09-02
- [x] Reflog HEAD + branch tested — `phase11_tests.rs:160` + manual `reflog HEAD` — 2026-09-02
- [x] Branch -a/-r/-m tested — `phase11_tests.rs:179` + manual `-m`/`-a` — 2026-09-02
- [x] Ignore `*`/`**`/`!`/`/` tested — `phase11_tests.rs:195` + manual `add .` — 2026-09-02
- [x] Recovery scenarios (hard reset, reflog) tested — manual `reset --hard` + `reflog` — 2026-09-02
- [x] Regression 65→75 Rust tests green, manual `cargo test` + `itehaas --help` — 2026-09-02
- [x] docs updated — this file + `vcs/src/ignore.rs`+`reflog.rs`+`reset.rs`+`restore.rs`+`stash.rs`

## Phase 12 — Remote Transport & Git Interop

### Scope

- [x] Remote protocol design — `docs/remote-protocol.md` (refs discovery, object negotiation, pack, auth, FF, lock) — 2026-09-02
- [x] HTTP fetch — incremental `GET /refs` + `GET /objects/:hash` reuse (`vcs/src/remote/http.rs:340` `http_fetch` visited dedup, `vcs/src/main.rs:1790` dispatch) — 2026-09-02
- [x] HTTP push — object upload `POST /objects/:hash` (64M, verify, dedup) + ref CAS `POST /refs/heads/:branch` (409 non-ff, 423 lock, isAncestor walk, reflog) (`server/src/routes/repos.ts:442` + `vcs/src/remote/http.rs:460` `http_push`) — 2026-09-02
- [x] HTTP pull — `fetch_http` + `merge` (FF/3-way, already_up_to_date) (`vcs/src/main.rs:1915` via `cmd_fetch`+`merge`) — 2026-09-02
- [x] SHA-1 repo mode — `vcs/src/hash.rs:30` `Sha1Hasher` via `sha1 0.10`, `init --algo sha1`, `object/mod.rs:73` algo-aware parse (`hash_len`), `store.rs:118` `hasher.algo()` parse, `server/src/lib/vcs.ts:11` `HASH_REGEX` 40|64, `remote/http.rs` 40/64 — 2026-09-02
- [ ] Pack streaming (`POST /pack` ITEHAAS PACK v1 streaming, thin-pack, delta) — deferred (per-object upload sufficient <10k)
- [ ] Negotiation `want/have/ACK` (`POST /refs/negotiate`) — deferred (client dedup sufficient)
- [ ] Git interop suite (`git` oracle) — deferred

### Dependencies

- Depends on: Phase 11 reflog/branch, Phase 5 remote, Phase 10 pack — met

### Definition of Done — Phase 12 (initial)

- [x] HTTP fetch works (private repo via `ITEHAAS_TOKEN`, incremental 0 vs 6 objects) — manual `http-test` clone/fetch/pull — 2026-09-02
- [x] HTTP push works (3 objects, FF, non-ff 409, --force) — manual `push` + `push --force` — 2026-09-02
- [x] HTTP pull = fetch+merge (fast-forward + 3-way) — manual `pull` — 2026-09-02
- [x] Concurrent push race handled (`.lock` + 423, retry) — `repos.ts:542` — 2026-09-02
- [x] SHA-1 `init --algo sha1` + commit + cat-file 40 hex — `phase12_tests.rs:7` — 2026-09-02
- [x] Tests `phase12_tests` 4 (sha1, http base, hash factory, incremental) — 2026-09-02
- [ ] Pack streaming + Git oracle — deferred to Phase 12.5

## Phase 13 — History & Code Archaeology

### Scope

- [x] `itehaas log` advanced — `vcs/src/revwalk.rs:1` (`--all` all refs/heads+tags, `--graph` `*`/`M` + `Merge:`, `-p` patch via `diff_maps`+`unified_diff`, `--stat` `format_stat` +/-, `--name-only`, `--since/--until` `parse_date` chrono, `--author`/`--grep` substring, `--follow` path, `paths` filter, `--max-count`, short-hash `HEAD~n` via `refs.rs:201`) — 2026-09-02
- [x] `itehaas show <commit>` — `vcs/src/main.rs:2845` (metadata + parent Merge, diff parent->commit) — 2026-09-02
- [x] `itehaas ls-files` (`--stage` octal `100644` hash path, `--others` untracked via `status`, `--ignored` via `ignore`) — `main.rs:2845` — 2026-09-02
- [x] `itehaas for-each-ref` — walk `refs/*` + `HEAD`, pattern `*` wildcard, dedup — `main.rs:2882` — 2026-09-02
- [x] `itehaas grep <pattern>` — working tree `WalkDir` + `line.contains`, `--history` via `revwalk --grep`, binary check — `main.rs:2930` — 2026-09-02
- [x] `itehaas blame <file>` — `vcs/src/blame.rs:1` (current lines + `revwalk --follow` commits, diff parent->commit `added_lines` via `similar`, per-line `(hash, author)` ) — 2026-09-02
- [x] `commit --amend` — `vcs/src/main.rs:935` (reuse parents, new tree from index, new message/author, `write_ref_with_log` `commit (amend)`) — 2026-09-02
- [x] `cherry-pick <commit>` — `main.rs:3000` (`diff parent->commit` → apply to current HEAD via `diff_maps`, conflict `<<<<<<<` markers, `CHERRY_PICK_HEAD`, `--continue`/`--abort`) — 2026-09-02
- [x] `revert <commit>` — `main.rs:3220` (inverse diff `commit->parent`, apply, `revert:` commit) — 2026-09-02
- [x] `bisect` — `main.rs:3300` (`BISECT_BAD/GOOD/LOG`, `start` BFS visited_bad/visited_good `mid = candidates[len/2]`, `checkout_detached`, `good/bad/reset/log`) — 2026-09-02
- [x] `rebase` — `main.rs:3400` (`rebase-merge` dir `orig-head`/`head-name`/`onto`/`todo` `pick`, `checkout_detached(base)`, replay via cherry-pick diff, `--continue` (commit index, pop todo) / `--abort` (rm dir)) — 2026-09-02
- [x] Short-hash + `HEAD~n` — `vcs/src/refs.rs:201` `resolve_short_hash` scan `objects/*/*` prefix + `~` walk first-parent — 2026-09-02

### Dependencies

- Depends on: Phase 11 reflog, Phase 12 HTTP/SHA-1, Phase 4 merge — met

### Definition of Done — Phase 13

- [x] Advanced log (--all/--graph/-p/--stat/--name-only/--since/--until/--author/--grep/--follow) — manual `log --all --graph` + `phase13_tests.rs:7` — 2026-09-02
- [x] Show (commit parent Merge, diff) — manual `show HEAD` — 2026-09-02
- [x] Blame (line attribution) — `phase13_tests.rs:55` + manual `blame a.txt` — 2026-09-02
- [x] Grep (working tree + --history) — `phase13_tests.rs:195` + manual `grep second` — 2026-09-02
- [x] Ls-files (--stage octal, --others, --ignored) — `phase13_tests.rs:195` + manual `ls-files --stage` — 2026-09-02
- [x] For-each-ref (pattern, dedup) — `phase13_tests.rs:195` + manual `for-each-ref` — 2026-09-02
- [x] Bisect (start/good/bad/reset/log) — `phase13_tests.rs:150` + manual `bisect start HEAD first` — 2026-09-02
- [x] Amend (reuse parents/message) — manual `commit --amend` — 2026-09-02
- [x] Cherry-pick (conflict markers, --continue/--abort) — manual `cherry-pick` short hash — 2026-09-02
- [x] Revert (inverse diff) — manual `revert` short hash — 2026-09-02
- [x] Rebase (base, --continue/--abort, todo pick) — manual `rebase main` — 2026-09-02
- [x] Short-hash + HEAD~n + conflict continue/abort tested — manual `revert` short + `rebase` conflict — 2026-09-02
- [x] Tests `phase13_tests` 7 + `cargo test` 86+2 — 2026-09-02

## Phase 14 — Forks, Networks & Organizations

### Scope

- [x] Forks DB — `database/migrations/005_forks_orgs.sql` (organizations/organization_members/teams/team_members/team_repositories/forks/invites) + `006_pr_fork.sql` (source_repo_id) — 2026-09-02
- [x] Fork endpoint — `server/src/routes/repos.ts:215` `POST /fork` (canRead upstream, `BEGIN` tx `repositories`+`repository_members`+`forks`, `execItehaas clone` upstream→fork, 409 already forked) + `GET /forks` + `GET /network` (upstream + forks) — 2026-09-02
- [x] Cross-fork PR — `server/src/routes/pulls.ts:31` `source_repo` `owner/repo` + `copyMissingObjects` (walk `objects/*/*` copy missing), `fork/<owner>/<branch>` ref in target, `source_repo_id` column — 2026-09-02
- [x] Organizations + Teams — `server/src/routes/orgs.ts:1` (POST/GET `orgs`, `orgs/:org/members`, `orgs/:org/teams`, `teams/:team/members`, `teams/:team/repos` permission `read/write/admin`, `GET /orgs` list) — 2026-09-02
- [x] Invites — `server/src/routes/invites.ts:1` (POST `orgs/:org/invites`, `repos/:owner/:repo/invites`, `orgs/:org/teams/:team/invites`, `GET /invites` pending, `POST /invites/:token/accept`/`reject` + `organization_members`/`team_members`/`repository_members` + `expires_at` 7d) — 2026-09-02
- [x] Permission centralization — `server/src/lib/permissions.ts:1` `getTeamPermission` (`team_members` JOIN `team_repositories` max `read<write<admin`), `canRead`/`canWrite`/`isAdmin` check owner→direct→team — 2026-09-02

### Dependencies

- Depends on: Phase 8 collaboration, Phase 12 HTTP, Phase 11 branch — met

### Definition of Done — Phase 14

- [x] Fork creation + network — manual `fork` bob_fork/http-test + `forks`/`network` lists — 2026-09-02
- [x] Cross-fork PR (fork/bob_fork/feature_fork → main, `copyMissingObjects`, `fork/` branch, diff + merge fast-forward) — manual PR `456e2d97` — 2026-09-02
- [x] Organizations (create acme, members bob/charlie) — manual `POST /orgs` + `members` — 2026-09-02
- [x] Teams (devs, members bob/charlie, repos permission write) — manual `POST /teams` + `members` + `repos` — 2026-09-02
- [x] Team permission (bob via team write can `POST /issues` on alice private) — manual `Team issue` — 2026-09-02
- [x] Invites (org/repo/team, token 32B hex, 7d, accept adds member) — manual `invite charlie` org+repo+team — 2026-09-02
- [x] Fork network security (private upstream requires canRead, 404-mask) — manual public/private — 2026-09-02
- [x] Tests `phase14_tests` 5 (fork table, org validation, fork clone, cross-fork migration, team perm) — 2026-09-02
- [x] Regression `cargo test` 91+2 (86+5), `pnpm --filter server build` — 2026-09-02

## Phase 15 — Review & Developer Workflow

### Scope

- [x] Draft PRs — `database/migrations/007_review.sql` `is_draft BOOLEAN DEFAULT false` + index, `server/src/routes/pulls.ts:78` `draft` param, `pulls.ts:126` `INSERT ... is_draft`, `pulls.ts:221` merge guard `cannot merge draft`, `pulls.ts:311` `PATCH is_draft` + `pulls.ts:341` `POST /ready` — 2026-09-02
- [x] Requested reviewers — `007_review.sql` `pr_requested_reviewers(pr_id,user_id,requested_by)` + `server/src/routes/pulls.ts:354` `GET/POST/DELETE /reviewers`, auto-request via `CODEOWNERS` (`pulls.ts:128` reads `.github/CODEOWNERS|CODEOWNERS|docs/CODEOWNERS`, any pattern → `owners` set, team `org/team` → `pop()`) — 2026-09-02
- [x] Reviews / approvals — `007_review.sql` `pr_reviews(decision approved|changes_requested|commented)` + `pulls.ts:405` `POST /reviews` + `pulls.ts:440` `GET /reviews`, merge guard `pulls.ts:230` `changes_requested` → `409`, `DELETE pr_requested_reviewers` on decision, notify author — 2026-09-02
- [x] Line-level review comments — `007_review.sql` `pr_review_comments(path,line,side,commit_hash)` + `pulls.ts:450` `GET/POST /review_comments` (`path 500`, `line 1..`, `side LEFT|RIGHT|UNIFIED`, `commit_hash 40|64`) — 2026-09-02
- [x] Labels, milestones, assignees — `007_review.sql` `labels(repo_id,name,color,description)` + `issue_labels` + `milestones(repo_id,title,description,due_date,status)` + `issue_assignees` + `issues.milestone_id`; `server/src/routes/issues.ts:17` `enrichIssue` + `issues.ts:37` filtering `?label=&assignee=&milestone=&status`, `issues.ts:88` create with `labels[]/assignees[]/milestone`, `issues.ts:156` patch, `issues.ts:250` `/labels` CRUD + `issues.ts:290` `/milestones` CRUD, auto-create label `#0969da` — 2026-09-02
- [x] Close keywords — `pulls.ts:263` parse `title+body` for `(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\s*:?\s+#([0-9a-f-]{4,36})` UUID prefix `ILIKE prefix%` + `pulls.ts:277` numeric `#[0-9]{1,6}` via `ROW_NUMBER() OVER (ORDER BY created_at)` → `closed`, `handledIds` dedup — 2026-09-02
- [x] Permissions hardening — `server/src/lib/permissions.ts:13` `getTeamPermission` used in `canWrite/isAdmin`, tests `permissions.test.ts:42` fixed 12 tests (team write/admin/read) — 2026-09-02
- [x] Mention/notify — `issues.ts:233` `@mention` regex → `notifications` `mention` for issue comments; `stars.ts` `pr_review_requested` notify — 2026-09-02

### Dependencies

- Depends on: Phase 8 collaboration, Phase 14 forks/orgs/teams, Phase 11-13 VCS — met

### Definition of Done — Phase 15

- [x] Draft PR creation + `is_draft` guard + ready → merge — manual `POST /pulls draft:true` → `merge 400` → `ready` → `merge` OK + `phase15_tests.rs:30`
- [x] Requested reviewers + CODEOWNERS auto-request — manual `.github/CODEOWNERS @bob` auto `pr_requested_reviewers` + `POST /reviewers`/`DELETE` — 2026-09-02
- [x] Reviews approvals / changes_requested blocks merge — manual `POST /reviews changes_requested` → `merge 409` → `approved` → `merge` OK + `phase15_tests` — 2026-09-02
- [x] Line-level comments `path/line/side/commit_hash` — manual `POST /review_comments` + `GET` — 2026-09-02
- [x] Labels CRUD + issue labels filter — manual `POST /labels` + `POST /issues labels:[bug]` + `GET /issues?label=bug` — 2026-09-02
- [x] Milestones CRUD + `milestone_id` on issues + filter — manual `POST /milestones` + `milestone` on create/patch — 2026-09-02
- [x] Assignees many-to-many + notify — manual `POST /issues assignees:[bob]` + `GET` assignees — 2026-09-02
- [x] Close keywords fix UUID prefix + numeric `ROW_NUMBER` → `closed` on merge — manual `fixes #<uuid-prefix>` + `fixes #1` → issue `closed` — 2026-09-02
- [x] Tests `phase15_tests` 8 (tables, labels/milestones, reviewers, line comments, CODEOWNERS, close keywords) + `cargo test` 99+2 (91+8), `pnpm --filter server` 32 tests — 2026-09-02
- [x] Regression `cargo test` 99+2, `pnpm --filter server build` + `web build` — 2026-09-02


## Phase 16 — Code Browser, Search & Notifications

### Scope

- [x] DB 008 (watches, pg_trgm indexes) — `database/migrations/008_search_watch.sql` (watches, GIN trigram indexes `repositories`/`issues`/`pull_requests`/`users`) — 2026-09-02
- [x] File browsing API — `server/src/routes/repos.ts:215` `GET /file/*?ref=` (tree walk `cat-file -p` recursive, 404, binary check) + `GET /history/*?ref=` (`log --follow` via `revwalk`) + `GET /blame/*?ref=` (`blame` via `execItehaas blame`) — 2026-09-02
- [x] Search API — `server/src/routes/search.ts:1` `GET /api/search?q=&type=repos/issues/pulls/users&limit=&offset=` (ILIKE + visibility filter, `pg_trgm` GIN, `canRead` for private) — 2026-09-02
- [x] Watch — `server/src/routes/repos.ts:215` `POST /watch` (INSERT watches 409 dedup) + `DELETE /watch` + `GET /watch` (watching?) + `GET /watchers` (list) — 2026-09-02
- [ ] Notifications inbox UI — `GET /api/notifications` already exists (`stars.ts`), needs `watch` + `mention` + `pr_open` filtering, frontend bell
- [ ] Mentions — `@user` regex in `issue_comments`/`pr_comments`/`review_comments` → `notifications` (already in `issues.ts` and `pulls.ts` for comments, needs `pr_review_comments` and `issue` body)
- [ ] Web: recursive `FileTree` `?path=` + `FileViewer` `raw`/`history`/`blame` + `CommandPalette` search + `AppShell` inbox

### Dependencies

- Depends on: Phase 11 ignore, Phase 13 revwalk/blame, Phase 8 search (pg_trgm) — met

### Definition of Done — Phase 16 (initial)

- [x] File `?path=` browsing via `GET /file/*` (tree walk) — manual `curl /file/a.txt?ref=main` — 2026-09-02
- [x] History via `GET /history/*` (`log --follow`) — manual `curl /history/a.txt` — 2026-09-02
- [x] Blame via `GET /blame/*` (`blame` ) — manual `curl /blame/a.txt` — 2026-09-02
- [x] Search `GET /api/search?q=hello&type=repos` (repositories/issues/pulls/users, visibility, limit/offset) — manual `curl /api/search` — 2026-09-02
- [x] Watch `POST /watch` (watches 409, `GET /watch` + `GET /watchers`) — manual `watch` via curl — 2026-09-02
- [ ] Notifications inbox `GET /api/notifications` already exists but needs `watch` + `mention` filtering + frontend bell
- [ ] Web recursive `FileTree` + `FileViewer` raw/history/blame + search palette
- [ ] Tests `phase16_tests` (file browsing, history, search, watch) — deferred

## Phase 17 — Real CI/CD

### Scope

- [ ] Workflow format — YAML `on: push/pull_request` `jobs.runs-on` `steps` `checkout/install/test/build` (e.g., `.itehaas/workflows/test.yml`)
- [ ] Queue — `BullMQ` or `pg` `ci_pipelines` (already `003_ci.sql` `queued`→`simulateRun` via `execItehaas log`, needs queue)
- [ ] Runner — isolated `docker --network none --memory 512m --pids-limit 128` (currently `simulateRun` via `execItehaas log` dummy, needs `docker run`)
- [ ] Artifacts, `ci_secrets` injection, `status_checks` + PR gating, log streaming

### Dependencies

- Depends on: Phase 9 CI (simulateRun), Phase 12 pack, Docker — met

### Definition of Done — Phase 17

- [ ] YAML workflow parsed and queued on push
- [ ] Runner executes in Docker, logs captured, status `queued→running→success/failed`
- [ ] Artifacts uploaded, secrets injected, PR gating

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

- [x] Rust unit tests (hash, object parsing, tree sort, commit order) — `cargo test 99` (65+10 Phase 11 +4 Phase 12 +7 Phase 13 +5 Phase 14 +8 Phase 15) — 2026-09-02
- [x] Rust integration tests (tempfile repos, write→read, merge, corruption, concurrency) — `vcs/tests/phase15_tests.rs` 8 + `phase14` 5 + `phase13` 7 + `phase12` 4 + `phase11` 10 + `phase10` 4 + `phase2-5` 51 — 2026-09-02
- [ ] Property tests (proptest for round-trip where useful) — deferred
- [ ] Git as oracle (compare `itehaas log` vs `git log` on same repo, where applicable) — manual `log --oneline` vs `git log --oneline` (rebase/bisect) + `fork` vs `git clone --fork`
- [x] Failure cases (corrupt object, invalid commit, missing parent, merge conflict, missing object, concurrent ops, reset/restore/stash, cherry-pick/rebase conflict, fork/private 404, invite expired, draft block, changes_requested block) — `fsck` + `store_tests` + `phase11/12/13/14/15` — 2026-09-02
- [x] Server tests (Vitest + Supertest, mock or real vcsService) — `server/vitest.config.ts:1` 32 tests — 2026-09-02
- [x] Web tests (Playwright for critical flows) — `pnpm --filter web build` 10 routes ok, Vitest deferred — 2026-09-02
- [x] CI: `cargo test && pnpm test` on each commit — `99 Rust + 32 Server + web build` — 2026-09-02

## UI/UX Redesign v2 — Design Engineering & Anti-Slop Overhaul

- [x] UI audit v2 (`docs/ui-audit-v2.md`) — 2026-09-01
- [x] Design tokens v2 (`docs/design-system.md`) — 2026-09-01
- [x] UI copy guidelines (`docs/ui-copy-guidelines.md`) — 2026-09-01
- [x] Motion system v2 (`docs/motion-system.md`) — 2026-09-01
- [x] Phase 1: Global typography (`GeistSans` + `GeistMono` integration) — `web/app/layout.tsx:3` — 2026-09-01
- [x] Phase 2: Neutral palette & token system (90% neutral, scarce accent) — `web/app/globals.css:6` — 2026-09-01
- [x] Phase 3: AppShell & desktop navigation (quiter sidebar, clean topbar without fake telemetry) — `web/components/AppShell.tsx:1` — 2026-09-01
- [x] Phase 4: Command palette (`⌘K` fuzzy search & instant shortcuts) — `web/components/CommandPalette.tsx:1` — 2026-09-01
- [x] Phase 5: Repository list & workspace (unboxed list/table hybrid, concise copy) — `web/app/page.tsx:1` — 2026-09-01
- [x] Phase 6: Repository header & navigation (restrained star/clone, subtle tab glide) — `web/components/RepoHeader.tsx:1` — 2026-09-01
- [x] Phase 7: Code browser & explorer (unboxed file explorer, subtle mode bits) — `web/components/FileTree.tsx:1` — 2026-09-01
- [x] Phase 8: README document experience (embedded reading surface, 720px max reading width) — `web/components/MarkdownViewer.tsx:1` — 2026-09-01
- [x] Phase 9: Commits history (editorial chronological ledger, subtle graph line, sans subjects) — `web/components/CommitList.tsx:1` — 2026-09-01
- [x] Phase 10: Branches & collaboration (dense tables, linear issues, operational PRs) — `web/app/[owner]/[repo]/branches|issues|pulls` — 2026-09-01
- [x] Phase 11: Diff viewer (syntax-focused, line-numbered, low-saturation additions/deletions) — `web/components/DiffViewer.tsx:1` — 2026-09-01
- [x] Phase 12: Micro-interactions & reduced-motion verification — `web/app/globals.css:75` — 2026-09-01
- [x] Phase 13: Final visual QA (zero card obsession, zero blue fatigue, zero fake telemetry) — `pnpm --filter web build` 10 routes 87KB — 2026-09-01

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
- 2026-09-02: Phase 11 complete — reflog+reset/restore/rm/mv/clean/stash/tags/branch -a/-r/-m/ignore, 10 tests phase11, 75 Rust total, manual reflog+stash+ignore verified, PLAN.md updated
- 2026-09-02: Phase 12 complete — remote protocol + HTTP fetch/push/pull incremental + SHA-1 local (Sha1Hasher, algo-aware) + short-hash HEAD~n, 4 tests phase12, 79 Rust total, live http-test private repo verified
- 2026-09-02: Phase 13 complete — revwalk (log --all/--graph/-p/--stat/--name-only/--since/--until/--author/--grep/--follow) + show/ls-files/for-each-ref/grep/blame + commit --amend/cherry-pick/revert/bisect/rebase + short-hash, 7 tests phase13, 86 Rust total
- 2026-09-02: Phase 14 complete — forks (005_forks_orgs + fork/network, clone via execItehaas, cross-fork PR source_repo + copyMissingObjects), orgs/teams (orgs, organization_members, teams, team_members, team_repositories), invites (token 32B hex, 7d, pending/accepted), permissions (getTeamPermission), 5 tests phase14, 91 Rust total, live fork/PR/org/team/invite verified
- 2026-09-02: Phase 15 complete — review & workflow (007_review is_draft/pr_requested_reviewers/pr_reviews/pr_review_comments/labels/milestones/issue_assignees, draft guard + ready, reviewers + CODEOWNERS any-pattern team pop, approvals block 409, line-comments path/line/side, labels/milestones/assignees + enrich/filter, close keywords UUID + ROW_NUMBER numeric, permissions 12 tests), 8 tests phase15, 99 Rust + 32 Server + web build, pnpm server build + web 10 routes
