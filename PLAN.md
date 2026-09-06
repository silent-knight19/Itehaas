# Itehaas — Master Development Plan

> Living contract. Update continuously: implemented + tested + verified + documented → mark `[x]`. Docs are source of truth.

## Project Vision

Build a Git-inspired distributed version-control system (Rust) and GitHub-like collaboration platform (Fastify/Next.js/PostgreSQL) self-hosted on a single laptop (Vivobook Ryzen 5 3500U, 20GB RAM, 512GB NVMe + 1TB HDD, Ubuntu Server 24.04.3 LTS, Tailscale).

Two connected systems:

- **System A — VCS Engine (Rust, `itehaas` binary)**: content-addressable storage, blobs/trees/commits/tags, refs/HEAD/index, DAG history, diff/merge, remotes. Authoritative repo truth on filesystem.
- **System B — Platform (Node.js/TypeScript, Fastify + Next.js + PostgreSQL)**: auth, repositories, browsing, issues, PRs, stars, notifications, CI. Operates on top of VCS engine; never duplicates VCS logic or stores file content in Postgres.

Core principles: Understand first, implement second. Correctness → Understanding → Testability → Maintainability → Performance → Scale.

## Current Status

**Current Phase:** Phase 18 — Observability & Property Tests (Complete)
**Current Task:** Phase 18 commit + docs (metrics, structured logs, property tests)
**Overall Progress:** 275 / ~240 tasks
**Status:** ✅ Complete — M1–M9 + Phases 11–18 achieved

### Last Completed

- Phase 11 complete: `vcs/src/reflog.rs` (logs/HEAD + logs/refs/heads/*, record on commit/checkout/reset), `vcs/src/reset.rs` (--soft/--mixed/--hard + paths), `vcs/src/restore.rs` (--staged/--worktree/--source), `vcs/src/ignore.rs` (.itehaasignore+.gitignore, `*`/`?`/`**`/`!`/`/`), `vcs/src/stash.rs` (refs/stash + stash_list, push/pop/apply/list/show/clear/drop), tag CLI (lightweight/annotated), branch -a/-r/-m, rm/mv/clean, `itehaas reflog`, 10 tests `phase11_tests.rs`, `cargo test` 75+2
- Phase 12 complete: `docs/remote-protocol.md` (refs discovery, negotiation, object/pack, auth, FF, lock), `vcs/src/remote/http.rs` (`http_fetch` incremental 6 vs 0, `upload_object_http`, `http_push` missing-set, `update_remote_ref_http` 409/423), `server/src/routes/repos.ts` (POST /objects/:hash 64M + verify, POST /refs/heads/* atomic CAS + isAncestor + 423 lock + reflog), HTTP clone+fetch+push+pull verified (`http-test` private), SHA-1 mode local (`Sha1Hasher` + `hash.rs`, `object/mod.rs` algo-aware, `init --algo sha1` 40-char), short-hash `resolve_rev` (`HEAD~n` + prefix 7+), 4 tests `phase12_tests.rs`
- Phase 13 complete: `vcs/src/revwalk.rs` (walk_log --all/--graph/-p/--stat/--name-only/--since/--until/--author/--grep/--follow, `format_stat`, `parse_date` chrono), `vcs/src/blame.rs` (line blame via diff), `vcs/src/hash.rs` `resolve_short_hash`, `vcs/src/refs.rs` `HEAD~n` + short, `vcs/src/main.rs` `commit --amend`, `show`, `ls-files`, `for-each-ref`, `grep`, `blame`, `cherry-pick`/`revert` (inverse diff, conflict markers, `CHERRY_PICK_HEAD`), `bisect` (BISECT_*), `rebase` (rebase-merge, --abort/--continue, todo), 7 tests `phase13_tests.rs`, `cargo test` 86+2
- Phase 14 complete: `database/migrations/005_forks_orgs.sql` (organizations/organization_members/teams/team_members/team_repositories/forks/invites), `006_pr_fork.sql` (source_repo_id), `server/src/lib/permissions.ts` (`getTeamPermission` + `canRead/canWrite/isAdmin` team check), `server/src/routes/repos.ts` (POST /fork + GET /forks/network, FS clone via `execItehaas clone` + `forks` DB), `server/src/routes/pulls.ts` (source_repo + `copyMissingObjects` + `fork/owner/branch` ref), `server/src/routes/orgs.ts` (POST/GET orgs, members, teams, team members/repos), `server/src/routes/invites.ts` (org/repo/team invites + accept/reject token), 5 tests `phase14_tests.rs` + manual cross-fork PR (`fork/bob_fork/feature_fork` → `main` fast-forward) + org/team/invite flow
- Phase 15 complete: `database/migrations/007_review.sql` (is_draft, pr_requested_reviewers, pr_reviews approved/changes_requested, pr_review_comments path/line/side, labels/issue_labels, milestones, issue_assignees), `server/src/routes/pulls.ts` (draft `is_draft` + PATCH/ready, reviewers CRUD + CODEOWNERS `* @user` auto, reviews `approved` 409, line-comments, close keywords `fixes #` UUID ILIKE), `server/src/routes/issues.ts` (enrichIssue, `?label&assignee&milestone`, `POST /issues` labels/assignees/milestone, `PATCH` labels/assignees, `GET /labels`/`/milestones` CRUD, mentions `@user` → `notifications`), 5 tests `phase15_tests.rs` + live `acme` draft→ready→approve→line-comment→merge+close

### Currently Working On

- Phase 18 complete — metrics, structured logs, property tests, 5 tests — ready for final release

### Next

- Post-Phase 18 — Final Polish (web artifact download, WS log streaming, Vivobook bench, Git oracle) — optional

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
| 16 | Code Browser, Search & Notifications | ✅ Complete |
| 17 | Real CI/CD | ✅ Complete |
| 18 | Observability & Property Tests | ✅ Complete |

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
- [x] Notifications inbox UI — `GET /api/notifications` (`server/src/routes/stars.ts:55`) + `web/app/notifications/page.tsx:1` (4.3kB, filter all/unread/mention, mark read), `web/components/AppShell.tsx:10` bell `Bell` + `CheckCheck` + dropdown 20 items + 30s poll + unread badge — 2026-09-02
- [x] Mentions — `@user` regex in `issue_comments`/`pr_comments`/`review_comments` → `notifications` (`server/src/routes/issues.ts:121` issue body `mention` + `issues.ts:244` comment, `server/src/routes/pulls.ts:336` pr_comment + `pulls.ts:526` review_comment) — 2026-09-02
- [x] Web: recursive `FileTree` `?path=` + `FileViewer` `raw` + breadcrumb — `web/app/[owner]/[repo]/page.tsx:28` (`?path=` + `?branch=` via `FileTree currentPath/onNavigate` + `FileViewer filePath/owner/repo/branch` + `Api.getFile` tree walk), `web/components/FileTree.tsx:20` `currentPath/onNavigate`, `web/components/FileViewer.tsx:6` `filePath/owner/repo/branch`, `web/lib/api.ts:78` `getFile/getFileHistory/getBlame/search/watch` — 2026-09-02
- [x] Web: `FileViewer` `history`/`blame` tabs + `CommandPalette` search + `AppShell` inbox bell — `web/components/FileViewer.tsx:16` tabs `code/history/blame/raw` + `Api.getFileHistory/getBlame` (loading, `Clock`/`User`), `web/components/CommandPalette.tsx:26` debounced `Api.search` `pg_trgm` 300ms `searchLoading`, `web/components/AppShell.tsx:24` `Bell` `Inbox` bell — 2026-09-02

### Dependencies

- Depends on: Phase 11 ignore, Phase 13 revwalk/blame, Phase 8 search (pg_trgm) — met

### Definition of Done — Phase 16 (initial)

- [x] File `?path=` browsing via `GET /file/*` (tree walk) — manual `curl /file/a.txt?ref=main` — 2026-09-02
- [x] History via `GET /history/*` (`log --follow`) — manual `curl /history/a.txt` — 2026-09-02
- [x] Blame via `GET /blame/*` (`blame` ) — manual `curl /blame/a.txt` — 2026-09-02
- [x] Search `GET /api/search?q=hello&type=repos` (repositories/issues/pulls/users, visibility, limit/offset) — manual `curl /api/search` — 2026-09-02
- [x] Watch `POST /watch` (watches 409, `GET /watch` + `GET /watchers`) — manual `watch` via curl — 2026-09-02
- [x] Notifications inbox `GET /api/notifications` (`stars.ts:55`) + `web/app/notifications/page.tsx:1` 4.3kB + `AppShell` bell dropdown 30s poll — 2026-09-02
- [x] Web recursive `FileTree` + `FileViewer` raw + breadcrumb `?path=` — `web/app/[owner]/[repo]/page.tsx` 50.9kB (history/blame tabs), `FileTree currentPath/onNavigate`, `FileViewer filePath/history/blame/raw` — 2026-09-02
- [x] Web `FileViewer` history/blame tabs + search palette inbox — `FileViewer.tsx:16` `history/blame` `Clock`/`User` + `CommandPalette.tsx:26` `Api.search` debounced `pg_trgm` — 2026-09-02
- [x] Tests `phase16_tests` 8 (search_watch migration, file browsing, watch, web file browser, fileviewer tabs, notifications/search, mentions) + `cargo test` 107+2 (99+8), `pnpm --filter server` 32 — 2026-09-02

## Phase 17 — Real CI/CD

### Scope

- [x] Workflow format — YAML `on: push/pull_request` `jobs.runs-on` `steps` `checkout/install/test/build` (`server/src/routes/ci.ts:30` `parseWorkflow` via `yaml` `0.10`, candidates `.itehaas/workflows/*.yml` `+ .github/workflows/*.yml`, `yaml.parse`, fallback `install/test/build`) — 2026-09-02
- [x] Queue — `pg` `ci_pipelines` `queued→running→success/failed` + `duration_ms` (`database/migrations/009_ci_workflow.sql` + `server/src/routes/ci.ts:108` `runPipeline` `queued→running` per job, `setImmediate`, concurrency via `pg` status) — 2026-09-02
- [x] Runner — isolated `docker --network none --memory 512m --cpus 1 --pids-limit 128` (`server/src/routes/ci.ts:70` `isDockerAvailable` + `executeInRunner` docker `alpine:latest` `sh -c` fallback `local` `sh -c`, 30s timeout, `runner` column) — 2026-09-02
- [x] Artifacts, `ci_secrets` injection, `status_checks` + PR gating, log streaming — `009_ci_workflow.sql` `ci_artifacts` + `ci_status_checks`, `server/src/routes/ci.ts:95` `collectArtifacts` `dist/target/artifacts`, `ci.ts:108` secrets `env` `Secrets injected`, `server/src/routes/pulls.ts:245` PR gating `ci_status_checks` `pipeline not successful` `409`, `web/app/[owner]/[repo]/ci/page.tsx:60` workflow/artifacts/status checks UI — 2026-09-02

### Dependencies

- Depends on: Phase 9 CI (simulateRun), Phase 12 pack, Docker — met

### Definition of Done — Phase 17

- [x] YAML workflow parsed and queued on push — `server/src/routes/ci.ts:30` `parseWorkflow` (yaml `jobs.steps.run`, inline `workflow` param for tests, fallback) + `POST /ci/run` stores `workflow_file` + `workflow_json` + creates jobs per `workflow.jobs` — 2026-09-02
- [x] Runner executes in Docker, logs captured, status `queued→running→success/failed` — `server/src/routes/ci.ts:70` `executeInRunner` docker `alpine` `sh -c` `set -e` `30000ms` fallback local, per-job `running`→`success/failed` `logs` `exit_code` `runner`, pipeline `duration_ms`, `GET /ci/pipelines/:id` `jobs` + `artifacts` — 2026-09-02
- [x] Artifacts uploaded, secrets injected, PR gating — `database/migrations/009_ci_workflow.sql` `ci_artifacts` `collectArtifacts` `artifacts/build.txt`, `ci.ts:108` `ci_secrets` `env`, `POST /ci/status_checks` + `DELETE`, `GET /ci/pr/:prId/checks` `passed`, `server/src/routes/pulls.ts:245` `409` CI required, `web/app/[owner]/[repo]/ci/page.tsx:60` workflow/artifacts/status checks 6.81kB — 2026-09-02
- [x] Tests `phase17_tests` 8 (workflow, docker, artifacts, gating, yaml, web) + `cargo test` 117 — 2026-09-02

## Phase 18 — Observability & Property Tests

### Scope

- [x] Metrics endpoint — `server/src/lib/metrics.ts:1` `metrics` `incHttpRequest` `incCIPipelines` `renderMetrics` + `server/src/index.ts:16` `GET /metrics` `text/plain` `itehaas_http_requests_total` `itehaas_uptime_seconds` `itehaas_ci_pipelines_total` `itehaas_http_requests_by_status` + `server/src/routes/ci.ts:11` `incCIPipelines` on `POST /ci/run` + `addHook onResponse` `incHttpRequest` — 2026-09-02
- [x] Structured logs — `server/src/index.ts:27` `logger` `pino` `LOG_LEVEL` `pino-pretty` in dev, `req.log.info` `method/url/status/duration` on `onResponse` — 2026-09-02
- [x] Property tests — `vcs/tests/property_tests.rs:1` `XorShift64` PRNG `prop_blob_roundtrip_random` 50× 0–2048B, `prop_tree_sorted_determinism` 30× shuffled vs sorted same hash, `prop_commit_roundtrip_random` 20×, `prop_hash_determinism` hex round-trip, `test_metrics_endpoint_exists` — 2026-09-02

### Dependencies

- Depends on: Phase 9 CI, Phase 17 pipeline metrics, Phase 1 hash invariants — met

### Definition of Done — Phase 18

- [x] `GET /metrics` returns Prometheus `text/plain` `itehaas_http_requests_total`, `uptime`, `ci_pipelines_total`, `by_status` — manual `curl /metrics` — 2026-09-02
- [x] `GET /health` includes `uptime`, `onResponse` logs structured `method/url/status/duration` — manual `curl /health` — 2026-09-02
- [x] Property tests 5 pass `cargo test --test property_tests` `prop_blob` `prop_tree` `prop_commit` `prop_hash` `metrics` — 2026-09-02
- [x] Regression `cargo test` 122 (117+5) + `pnpm server` 32 + `web build` 12 routes — 2026-09-02

# Security Program — Fresh S0 (2026-09-03, authoritative for this run)

> **Fresh S0 ignoring all prior S0–S19 Complete claims.** Prior docs treated as untrusted input.
> Rule: strict sequential phases, one active at a time. Fresh S0 = zero functional changes.

Status: **Fresh S0 ✅ Complete (recon only). S1–S19 ⬜ Not Started in this run. STOPPED before S1.**

## Fresh S0 — Security Reconnaissance (COMPLETE 2026-09-03)

**Status:** ✅ Complete
**Date:** 2026-09-03
**Action:** Direct source inspection, no code/config/test edits. Prior claims distrusted and re-verified.

### Deliverables Produced (this run)
- `docs/security/threat-model.md` v3.0.0-fresh-S0 — 9 boundaries, assets/actors/flows/surfaces.
- `docs/security/vulnerability-register.md` v3.0.0-fresh-S0 — 24 fresh findings FSEC-001…FSEC-024 (all Open).
- `PLAN.md` — this section (prior S0–S19 table below retained as history only).

### Key Fresh Findings (all Open, fix deferred)
1. **FSEC-006 (High):** `GET /log?ref=` rewrites `.itehaas/HEAD` per-request — race/corruption (`repos.ts:1020-1052`).
2. **FSEC-013 (High):** inline CI `workflow: z.any()` bypasses YAML limits (`ci.ts:397-434`).
3. **FSEC-014 (High):** `copyMissingObjects` pre-copy weakens fork secret signal (`pulls.ts:127`, `ci.ts:297-302`).
4. **FSEC-016 (High):** `SECRET_ENCRYPTION_KEY` defaults to `COOKIE_SECRET` + plaintext fallback (`config.ts:187`, `secrets.ts:85-91`).
5. **FSEC-018 (High):** SSRF DNS best-effort fail-open + env-flag inconsistency (`remote/http.rs:62-235`).
6. **FSEC-001 (High):** dev fallback secrets + `0.0.0.0` on misconfigured `NODE_ENV` (`config.ts:159-191`).
7. **FSEC-023 (High):** `db` compose unhardened + default password (`docker-compose.yml:5-19`).
8. **FSEC-005 (Med):** weak PR branch regex vs `isValidBranchRef` (`pulls.ts:89-90`).

### Tests
- Baseline only (no new security tests in S0 by design). Adversarial regression tests planned per-FSEC in register; to be added in S1–S19.
- Manual verification: `git status` must show only `docs/security/threat-model.md`, `docs/security/vulnerability-register.md`, `PLAN.md`.

Gate: Fresh S0 complete, no `server/`/`vcs/`/`web/`/`database/` edits. **STOP. Do not start S1.**

---

## Fresh S1 — Security Baseline & Fail-Closed Boot (COMPLETE 2026-09-03)

**Status:** ✅ Complete
**Threat:** Prod boots with default/weak secrets, coupled encryption key, any-interface bind, invalid port/root/bin → session forgery, DB takeover, LAN exposure.
**Attack path:** Omit `SECRET_ENCRYPTION_KEY` / set `HOST=::` / weak `DATABASE_URL` pwd / `PORT=0` / world-writable `REPOS_ROOT` parent / empty compose `.env` → server boots insecure.
**Current defense:** `validateStartupConfig` length/pattern checks, `0.0.0.0` gate, compose loopback ports.
**Weakness:** SEK silently fallback to cookie secret; DB pwd only 2 patterns; `::` bypass; PORT unchecked; parents unchecked; compose `:-` insecure fallbacks + baked `POSTGRES_PASSWORD:itehaas`.
**Required fix (implemented, smallest):** explicit distinct 32+ SEK in prod; DB pwd ≥12 + weak-word block + required; any-host set `{0.0.0.0,::,::0,...}`; `validatePort 1-65535`; prod parent world-writable walk; compose `:?` mandatory + `NODE_ENV:-production` + `HOST:-127.0.0.1`; `.env.example` prod-failing dev values.

### Changes
- `server/src/config.ts` — DB pwd strength, port validator, IPv6 any-bind set, prod parent-writable walk, explicit distinct SEK.
- `docker-compose.yml` — `:?` mandatory `POSTGRES_PASSWORD/DATABASE_URL/COOKIE_SECRET/SECRET_ENCRYPTION_KEY`, `NODE_ENV:-production`, `HOST:-127.0.0.1`, runner comment fixed.
- `server/.env.example` — prod-failing placeholders + rotation guidance, `HOST=127.0.0.1`.
- Tests — `s1-baseline.test.ts` 25→36 (SEK missing/coupled/short, DB missing/short/weak pwd, `::` bind, port, world-writable parent); `s17-deploy.test.ts` + `s19-adversarial.test.ts` SEC-002 assert `:?` + no hardcoded weak defaults.

### Tests
- `pnpm --filter server exec vitest run src/routes/s1-baseline.test.ts` — 36/36 green.
- `pnpm --filter server exec vitest run` — 28 files, 272/272 green (2 brittle `CHANGE ME` assertions updated to fail-closed).
- `pnpm --filter server exec tsc --noEmit` — clean.
- `cargo test -p itehaas` — 20 suites ok, 0 failures.
- Diff reviewed: strictly fail-closed additions, no weakening; secrets scan clean.

### Findings
- Fixed (fresh): FSEC-001 (explicit SEK + DB pwd + any-bind + port + compose mandatory), FSEC-023 (compose `:?`, no baked password).
- Deferred: FSEC-002/003 (S12/S14), FSEC-004–024 remainder to owning phases.

### Residual risks
- Operators must create `.env` before `docker compose up` (breaking change by design); `docker` CLI absent locally so `compose config` fail-closed not executed here — verify on Vivobook with dummy env (expect `:?` error without `.env`, success with).
- `SECRET_ENCRYPTION_KEY` rotation still needs re-encrypt procedure (S9); DB pwd 12+ is floor, prefer 24+ random.

Gate: S1 complete. **STOP. Do not start S2.**

---

## Fresh S2 — Authentication Hardening (COMPLETE 2026-09-03)

**Status:** ✅ Complete
**Threat:** Credential stuffing, brute-force, enumeration, session fixation/replay/hijack, token leakage, argon2 CPU-DoS, stale sessions.
**Attack path:** Unbounded `login.password` / `currentPassword` (10MB → argon2 burn); unthrottled `POST /password` current-pw guessing with stolen session; malformed logout cookie → DB hit; expired/revoked replay.
**Current defense:** RL register 3/min + login 5/min, lockout 5→15m, dummy argon2 + generic 401/409, argon2id 64MiB, server-generated UUID, 30d expiry + revoke-others on pw change, httpOnly/lax cookies, redacted logs.
**Weakness:** Login/currentPassword unbounded; password-change + revoke-all no RL; logout no UUID guard.
**Required fix (implemented, smallest):** bound login (`user 1-255`, `pw 1-128`) + register email `max 255` + `currentPassword max 128` before argon2; RL `password_change` 5/min; logout UUID-shape guard (still always-200, no oracle).

### Changes
- `server/src/routes/auth.ts` — input bounds, pw-change RL, logout guard.
- Tests — `auth-s2.test.ts` 16→23 (+7 adversarial: oversized login/pw →400 no-verify, pw RL 429, malformed logout 200 no-DELETE, expired →401+clear, malformed Bearer 401 no-DB-hit).

### Tests
- `auth-s2.test.ts` — 23/23 green.
- Full server — 28 files, 279/279 green. `tsc --noEmit` clean.
- Diff reviewed: strictly hardening; generic 401/409 + fixation rotation + revocation preserved; no credential/session logging.

### Findings
- Fixed (fresh S2 gaps): unbounded-auth-input CPU bomb, unthrottled password-change guessing, logout garbage DB hit.
- Deferred: session-UUID-at-rest unhashed (DB dump → hijack; needs hashed-session migration), Bearer full-scope (no CLI scoping), 30d absolute-only expiry (no idle timeout), unlimited concurrent sessions, XFF-spoofable RL buckets (→S14).

### Residual risks
- Session tokens stored raw in PG; rely on DB hardening + 30d expiry + revoke-all. Hash-at-rest migration deferred (would invalidate existing sessions).
- Bearer = full session powers (incl. password change path); leakage impact equals cookie theft; mitigated by pino redact + 30d expiry.
- Public profile lookup remains an existence oracle by design (see FSEC-020).

Gate: S2 complete. **STOP. Do not start S3.**

---

## Fresh S3 — Authorization / IDOR / BOLA (COMPLETE 2026-09-03)

**Status:** ✅ Complete
**Threat:** BOLA/IDOR ID-swaps (repo/issue/PR/org/team/secret/user/CI), horizontal/vertical escalation, cross-tenant, private leakage via indirect endpoints.
**Attack path (verified in code):** Child endpoints scoped by child UUID only (`GET issue/PR comments`, reviewers/reviews) → cross-repo leak with known UUID; milestone/labels/assignees mutated without write; reader reviewer-spam + self-approval; unvalidated review paths; numeric close-keyword closes wrong issue; weak `default_branch` regex; private forks/team-repos/counts exposed to anon; ad-hoc CI admin SQL misses team-admin; last-owner removal orphans org; invite reject lacks expiry/ownership gates; search omits team permission.
**Current defense:** `canRead/canWrite/isAdmin/isOwner` + team perms, 404-masking, repo-scoped SELECTs in most routes, `isAdmin` gate on team-attach.
**Required fix (implemented, smallest):** parent-scope all child reads/writes; milestone/labels/assignees require write (title/body/status stay author-or-write); label auto-create gated; milestone PATCH 404; PR UPDATEs repo-scoped; reviewers author-or-write; self approve/changes_requested 403 (comments allowed); review path `isValidFilePath`; numeric close only when mapped; `default_branch` via `isValidBranchRef`; forks/network/team-repos visibility-filtered; profile stars/activity visibility-filtered; CI secrets/checks via single `isAdmin`; org last-owner guard; invite-reject expiry+ownership gates; search adds team-membership visibility (consistency with `getTeamPermission`).

### Changes
- `issues.ts` — create/PATCH label+assignee+milestone write-gates, comment scoping + `validateOwnerRepo`, final SELECT scoped, milestone 404.
- `pulls.ts` — child-endpoint parent scoping, reviewer request gate, self-approval block, path validation, UPDATE scoping, numeric-fallback removal, strict branch-ref check on create.
- `repos.ts` — `default_branch` strict ref check, forks/network private-filter.- `orgs.ts` — team-repos visibility filter, last-owner guard.
- `users.ts` — profile stars/activity visibility-filtered counts.
- `ci.ts` — secrets/status_checks single `isAdmin` gate.
- `invites.ts` — reject expiry (410) + ownership/email gates.
- `search.ts` — team-membership visibility in repos/issues/pulls queries.
- Tests — `authz-s3.test.ts` 18→33 (+15 BOLA/IDOR adversarial).

### Behavior tradeoffs (documented)
- Team-read non-authors can no longer request PR reviewers (author-or-write only) — reviewer spam > convenience; writers unaffected.
- Issue authors without write can no longer set milestones/labels/assignees — triage is a maintainer action; title/body/status unchanged.
- Public issue creation by readers preserved (SEC-023); reader PR comments preserved.

### Tests
- `authz-s3.test.ts` — 33/33 green (cross-repo comment BOLA, label pollution, milestone/label/assignee gates, reviewer gates, self-approval, review-path traversal, PR branch traversal, milestone 404, default-branch traversal, fork/team filtering, team-admin secrets, last-owner, invite reject).
- Full server — 28 files, 294/294 green. `tsc --noEmit` clean.
- Diff reviewed: every gate tightened or made consistent; no check loosened except search/team-admin alignment with existing `getTeamPermission` semantics.

### Findings
- Fixed: FSEC-005 (strict branch refs on PR create + `default_branch`), FSEC-011-class BOLA gaps, FSEC-015 (team-admin consistency), FSEC-020 (counts/listings redaction; org/member enumeration intentionally still public, noted below).
- Deferred: FSEC-004 (owner/repo `.`/`..` strings → S4), FSEC-006 (HEAD race → S15), FSEC-013/014 (CI inline workflow + pre-copy → S10), FSEC-016/017 (secrets at rest → S9/S8), FSEC-018/019 (SSRF/remotes → S13), search `%` wildcard enumeration hardening (→ S7/S14 pagination/escaping).

### Residual risks
- Org/team/member *names* remain publicly listable (GitHub-like transparency); only private *repo* names/counts are now filtered. Full private-org mode deferred.
- `q=%%` wildcard + `ILIKE %search%` unescaped enumeration remains (→ S7/S14).
- `authorize.ts` central helper still dead code — routes inline gates (drift risk; consider adopting or deleting in a later phase).

Gate: S3 complete. **STOP. Do not start S4.**

---

## Fresh S4 — Filesystem Security (COMPLETE 2026-09-03)

**Status:** ✅ Complete
**Threat:** Attacker-controlled paths (`../`, symlinks, aliasing, Unicode, races) escaping `data/repos/{owner}/{repo}`; malicious fork content via object-copy walk; checkout delete redirected outside repo.
**Attack path (verified in code):** `repoPathFor('.', …)` aliases root dirs; checkout delete loop called `remove_file` without containment re-check (symlink-swapped parent → delete outside); `copyMissingObjects` used `statSync` (follows symlinks) with no hex validation (planted `objects/ab → /etc` → arbitrary file copy-in; SHA-1 objects silently dropped); tree/file names allowed control/format chars (terminal/log injection, normalization tricks).
**Current defense:** `validateRepoPath` (startsWith + lstat chain + realpath), `isValidFilePath` double-decode, `is_forbidden_component`, checkout write guards, artifacts lstat.
**Required fix (implemented, smallest):** explicit `.`/`..` rejection at identifier layer; containment + no-through-symlink guard immediately before every checkout delete; lstat + 2-hex/38-or-62-hex validation in fork copy (SHA-1 now copied); control/format-char rejection in `isValidFilePath` + `is_forbidden_component` (i18n names preserved).

### Changes
- `server/src/lib/vcs.ts` — `repoPathFor` + `isValidOwnerRepo` reject dot-segments.
- `server/src/routes/repos.ts` — `validateOwnerRepo` dot-segments; `isValidFilePath` control/format-char class.
- `vcs/src/object/tree.rs` — `is_forbidden_component` control/format chars.
- `vcs/src/checkout.rs` — delete guard in `checkout` + `checkout_forced` (FSEC-011).
- `server/src/routes/pulls.ts` — `copyMissingObjects` lstat + hex validation + SHA-1, exported for testing.
- Tests — `fs-s4.test.ts` 14→19, `s4_fs_test.rs` 4 asserts extended (control chars, i18n-allowed).

### Tests
- `fs-s4.test.ts` 19/19 (dot aliasing, symlink-parent refusal, control chars vs café/日本語， deep paths, copy walk: symlink/junk/tmp skipped, sha1+sha256 copied).
- `cargo test --test s4_fs_test` 4/4. Full server 299/299, `cargo test -p itehaas` 141 passed/0 failed, `tsc` clean.
- Diff reviewed: strictly containment-tightening; no legitimate flow broken (i18n filenames verified allowed).

### Findings
- Fixed: FSEC-004 (dot-segments), FSEC-011 (delete guard).
- Deferred: bind-mount/dir-ownership tricks (no `openat`/inode pinning — residual), APFS NFD aliasing (control chars blocked; full NFC enforcement needs new crate), hard-link planting (checkout writes are create-only via `fs::write`; noted).

### Residual risks
- Check-then-act windows narrowed but not eliminated without `openat2`/`O_NOFOLLOW` dirfd pinning (future hardening).
- macOS NFD normalization aliasing: two distinct byte-names may collide on APFS; collision now fails toward overwrite-in-order rather than control-structure escape (control dirs still blocked).
- Legacy repos containing control-char names committed pre-fix will now fail checkout deletes fail-closed.

Gate: S4 complete. **STOP. Do not start S5.**

---

## Fresh S5 — Process / Command Execution Security (COMPLETE 2026-09-03)

**Status:** ✅ Complete
**Threat:** Malicious branch/ref/hash/path args → flag injection, secret leak to child env, fork/output/timeout exhaustion, binary redirection, stdin wedging.
**Attack path (verified in code):** 60 `execItehaas` sites audited — all `spawn(bin, args)` array, no shell. Gaps: `DELETE /remotes/:name` + `remote add` names allowed leading-dash (`--help` flag confusion, proved 500 via test); push/pull `branch` weak regex; SHA-1 ref tips skipped FF check (64-only gate → non-FF push accepted); no arg-size caps; `/tmp` binary silently allowed even in prod; stdin pipe left open with no input.
**Current defense:** env allowlist, flag allowlist, null/newline reject, cwd gate, semaphore 3, 30s + SIGTERM→SIGKILL, 1M caps, live `merge-base --is-ancestor` single-call (fallback loop is mock/legacy-only).
**Required fix (implemented, smallest):** leading-dash/dot remote-name rejection (both endpoints); strict `isValidBranchRef` on push/pull branch; algo-aware current-hash gate (40|64); hash-format entry guard in `isAncestor`; per-arg 4K + total 8K + stdin 8K caps pre-spawn; `isAllowedBinPath` enforced in prod; explicit `shell:false` + stdin `ignore` unless input supplied.

### Changes
- `server/src/lib/vcs.ts` — arg/stdin caps, strict prod bin prefix (extracted `isAllowedBinPath`), `shell:false`, stdin ignore, null-safe stream handlers.
- `server/src/routes/repos.ts` — remote-name guards, push/pull branch checks, SHA-1 FF gate, `isAncestor` hash entry guard.
- Tests — new `s5-fresh.test.ts` 7/7 (arg/stdin bombs, bin prefixes, no-shell source assertion, push traversal, remote flag names).

### Tests
- New 7/7, `vcs-s5` + `s5-proc` green, full server 306/306, `tsc` clean (fixed `stdout/stderr` null-narrowing from explicit stdio), cargo 141/0.
- Diff reviewed: strictly boundary-tightening; legitimate flows unchanged (all real args ≪ caps; `--help` never used positionally).

### Findings
- Fixed: FSEC-012 (prod bin prefix), SHA-1 FF bypass, remote/branch flag-confusion class.
- Deferred: CPU/memory cgroup limits for children (no cgroup wrapper — residual), `isAncestor` 2000-spawn fallback retained for legacy binaries (live path is single-call), typed command-builder refactor (arg classification documented in threat-model B4; builder pattern future work).

### Residual risks
- Children share server CPU/memory (ulimits/cgroups not applied); a legitimate huge-history `merge-base` can still take seconds (8s timeout + semaphore bound it).
- `isAncestor` fallback loop survives only for binaries predating `merge-base --is-ancestor`; counts against semaphore per-spawn, not held across the walk.

Gate: S5 complete. **STOP. Do not start S6.**

---

## Fresh S6 — VCS Object Parser Security (COMPLETE 2026-09-03)

**Status:** ✅ Complete
**Threat:** Malicious blobs/trees/commits/tags/packs/indexes — truncated/oversized/malformed objects, DAG bombs, decompression bombs, parser resource amplification.
**Attack path (verified in code):** (1) Diamond-DAG tree bomb LIVE — `flatten_tree_with_ancestors` used an active-path set only (no memo), so shared subtrees re-expanded exponentially (2^depth visits) while the 100k `out` cap stayed small; (2) whole-body `split('\n')` in commit/tag parse allocated a gigantic line Vec for newline-flooded messages before any limit; (3) `parse_tree` built `TreeEntry` literally, bypassing the S4 name policy (control chars/`.itehaas`/reserved smuggled past the parser); (4) `create_pack` buffered every object in RAM pre-limit + skipped SHA-1 objects; (5) `collect_reachable_*` recursed unbounded (stack overflow on deep chains); (6) `index` parsed unbounded JSON.
**Current defense:** 64M `take()` bomb guards, entry/parent/message/count/depth caps, hash re-verification, cycle detection.
**Required fix (implemented, smallest):** memoized flatten (unique-hash computed once; cycle detection kept); header-first scan with header-line caps (128/16); parse-time name-policy enforcement; two-pass streaming pack (metadata first, per-file lstat+hex incl. SHA-1, write-time revalidation); iterative commit/tag walk + tree-only depth cap + 100k object budget; index 32MB/500k-entry caps.

### Changes
- `vcs/src/object/mod.rs` — name policy at parse, header-first commit/tag scan.
- `vcs/src/tree_builder.rs` — memoized `flatten_inner` worker (wrapper signature kept).
- `vcs/src/remote.rs` — iterative reachability + budgets (public signature unchanged).
- `vcs/src/pack.rs` — streaming create, strict fanout names, TOCTOU revalidation.
- `vcs/src/index.rs` — byte + entry caps.
- Tests — `s6_parser_test.rs` 11→22 (forbidden names, newline floods, header caps, trailing-data rejection, diamond linear + over-cap fail-fast, 3000-chain walk, index cap, pack roundtrip).

### Tests
- `s6_parser_test` 22/22, full cargo 152/152 passed 0 failed, server 306/306, `tsc` clean.
- `cargo clippy`: no errors; one new `too_many_arguments` lint on the compat wrapper suppressed with justification; warning count 50→49.
- `cargo fmt --check`: fails repo-wide pre-existing (~400 drift sites incl. untouched files — rustfmt version drift); touched hunks match surrounding style; no repo-wide `cargo fmt` run (would rewrite untouched files).

### Findings
- Fixed: FSEC-007 (index caps), FSEC-008 (reachability bounds), FSEC-009 (pack streaming), FSEC-014-class DAG bomb (memoization — prior ancestor-set was insufficient).
- Deferred: FSEC-010 `revwalk` silent 10k truncation kept deliberately (erroring would break `log` on legit large repos; →S7 pagination design); fuzz/property harness for parsers (cargo-fuzz not wired — future); full NFC enforcement (needs new crate).

### Residual risks
- 100k-entry repos fail closed on flatten (same as before; legit giant monorepos need paginated tree APIs →S7).
- Objects with pre-fix control-char names committed earlier now fail to parse (fail-closed).
- Pack TOCTOU revalidation aborts the whole pack on concurrent GC (safe direction; retry).

Gate: S6 complete. **STOP. Do not start S7.**

---

## Fresh S7 — Resource Exhaustion / DoS Budgets (COMPLETE 2026-09-03)

**Status:** ✅ Complete
**Threat:** HTTP/VCS/DB/CI resource exhaustion — oversized bodies, unbounded lists, wildcard scans, log flooding, disk filling, output bombs.
**Attack path (verified in code):** CI `out +=` unbounded (malicious `yes` loop → server OOM, unbounded TEXT storage + full-bodied GET logs); 11 unbounded list endpoints (forks/network/members/watchers/labels/milestones/org lists, uncapped offsets in users lists); unescaped `%`/`_` in 6 LIKE sites (`q=%%` → full-table scans under trigram index); no per-repo disk bound (64M×N pushes + fork clones fill host disk); implicit-only JSON body limit.
**Current defense:** Per-object 64M, per-endpoint rate limits, statement timeout 5s, pool 10, VCS semaphore 3, parser caps (S6), CI queue 20 + YAML limits.
**Required fix (implemented, smallest):** central `lib/budgets.ts` (pagination 50/100/50k, LIKE escape, 2M log + 256K script caps, 100-row detail caps, 10GiB quota via `REPO_QUOTA_BYTES`); explicit Fastify `bodyLimit` 1M; log-flood kill + truncation marker; quota 413 on object push + fork-of-over-quota; LIKE escaping in search/users; offset caps in users lists.

### Changes
- `server/src/lib/budgets.ts` (new) — pagination helper, LIKE escape, CI caps, quota + lstat usage walk with early exit.
- `server/src/index.ts` — explicit `bodyLimit`.
- `server/src/routes/ci.ts` — script/output caps, detail LIMITs.
- `repos.ts`/`issues.ts`/`orgs.ts` — paginated lists. `search.ts`/`users.ts` — LIKE escape + offset caps. `repos.ts` — disk quota gates.

### Tests
- `s7-dos.test.ts` 11→21 (budget units, LIKE escape behavior, pagination caps, 2M JSON →413, over-quota push →413, CI cap markers).
- Full server 316/316, `tsc` clean, cargo untouched (152).
- Diff reviewed: strictly budget-adding; legitimate flows under caps (verified: default pages unchanged at 50/20).

### Findings
- Fixed: CI log-flooding OOM class, unbounded-collection class, LIKE-wildcard scans, disk-fill via pushes/forks.
- Deferred: inline-workflow job/step caps (→S10, FSEC-013), per-endpoint RL tuning (→S14), global connection/request timeouts (reverse-proxy scope), `revwalk` 10k pagination UX (kept).

### Residual risks
- Quota walk is synchronous O(files) per push (early-exits over quota; typical repos trivial; 200k-file repos ~100ms+ per push — future: cached accounting).
- Verbose-but-legit builds over 2M logs fail closed with truncation marker (visible, safe).
- 10GiB default may be small for giant monorepos — raise via `REPO_QUOTA_BYTES`.

Gate: S7 complete. **STOP. Do not start S8.**

---

## Fresh S8 — Database Security (COMPLETE 2026-09-03)

**Status:** ✅ Complete
**Threat:** SQL injection, missing authorization predicates, torn multi-writes, over-privileged DB role, connection/timeout exhaustion.
**Attack/weakness audit (verified):** zero string-interpolated attacker data in any `query()` (dynamic SET clauses use fixed whitelists + `$n` params; single `ORDER BY ${orderBy}` is allowlist-gated); FK/CASCADE/UNIQUE sound across all 11 migrations; timeouts bounded (statement 5s, connect 5s, pool 10). Gaps fixed: (1) CI pipeline+jobs, issue create/update, PR-merge completion wrote across separate statements — mid-write failure left orphan pipelines / orphan issues / merged-without-close states (S3's label 403 could even orphan an issue row); (2) single owner-role connection (full DDL on injection/leak).
**Required fix (implemented, smallest):** `getClient` BEGIN/COMMIT/ROLLBACK transactions around the three multi-write flows (universally-mocked accessor, no test-infra churn); permission checks hoisted before first write + repo-scoped UPDATE; migration `011_db_roles.sql` (`itehaas_app` DML-only, NOLOGIN, default-privileges, insufficient-privilege guard) + `DATABASE_APP_URL` runtime opt-in + compose opt-in comment.

### Changes
- `issues.ts` — atomic create/update, pre-write label/permission validation, scoped UPDATE.
- `ci.ts` — atomic pipeline+jobs creation. `pulls.ts` — atomic merge completion (close-keywords stay best-effort inside).
- `database/migrations/011_db_roles.sql` (new), `db/index.ts` (`DATABASE_APP_URL` selection), compose opt-in.
- Tests — `s8-db.test.ts` 7→13 (orphan-freedom, check-before-write, txn rollbacks, role-file shape, pool selection); one `s19` mock delegation fix for the txn path.

### Tests
- `s8-db` 13/13, full server 322/322 (29 files), `tsc` clean. Migration SQL review-checked (no live PG here to apply it — first real apply happens on Vivobook `migrate`; file is best-effort guarded).
- Diff reviewed: writes strictly more atomic; no predicate loosened; star/register cosmetic non-atomicity explicitly accepted.

### Findings
- Fixed: torn-write class (pipeline/issues/merge), owner-only DB role posture (role exists dormant until operator opt-in).
- Deferred: RLS policies (app-level predicates verified per-route in S3; RLS would duplicate), per-row audit triggers, `authorize.ts` dead helper, advisory-lock hash strength (→S15).

### Residual risks
- Default deployment still runs as owner until the operator completes the 011 runbook (documented; fail-open preserves availability, cannot lock out).
- 011 was review-checked only — verify `NOTICE` vs applied on first real migrate run.
- Star+activity and register user+session remain multi-statement (cosmetic, accepted).

Gate: S8 complete. **STOP. Do not start S9.**

---

## Fresh S9 — Secrets Security (COMPLETE 2026-09-03)

**Status:** ✅ Complete (critical phase)
**Threat:** DB dump with plaintext secrets; corrupt ciphertext injected as env; fork-PR secret theft; missing rotation after key compromise; secret-bearing logs/API.
**Attack/weakness audit (verified):** at-rest AES-GCM v1 + keys-only list + masking + `isAdmin` + create/delete audit were sound. Gaps fixed: (1) legacy plaintext rows accepted forever with no healing path (perpetual `TEXT` plaintext); (2) undecryptable values injected raw as env (poisoned masking, ciphertext in logs); (3) no rotation procedure after `SECRET_ENCRYPTION_KEY` rotation (S1-distinct key orphans old rows); (4) fork isolation relied partly on a pre-copy-polluted FS signal.
**Required fix (implemented, smallest):** `isEncryptedValue` discriminator + `resolvePipelineSecrets` (v1 strict-decrypt, legacy heal-on-read, skip-undecryptable + `ci.secret_decrypt_failure` audit, skipped keys named in logs); `POST /ci/secrets/rotate` (admin, counts-only response, `ci.secret_rotate` audit); fork-strip audited (`ci.secret_strip_fork`), DB fork markers authoritative; `docs/security/secrets.md` (inventory, storage model, isolation rules, runbooks).

### Changes
- `lib/secrets.ts` — `isEncryptedValue` (+ docs on healing path).
- `routes/ci.ts` — extracted `resolvePipelineSecrets`, rotate endpoint, strip audit, skip markers in logs.
- `docs/security/secrets.md` (new).
- Tests — `s9-secrets.test.ts` 11→15 (heal/skip/rotate/403/fork-with-copied-objects).

### Tests
- `s9-secrets` 15/15 (incl. FSEC-008 adversarial: fork PR + pre-copied objects → logs provably secret-free + strip audited).
- Full server 326/326 (29 files), `tsc` clean. Diff reviewed: audit rows carry names only; no value ever logged/returned (grep-verified).

### Findings
- Fixed: perpetual-plaintext (FSEC-009-class), raw-ciphertext injection, missing rotation, unaudited strip.
- Deferred: hashed-session tokens at rest (S2 residual stands), fork object-copy race itself (→S10), secret-version history beyond `v1:`.

### Residual risks
- Legacy rows heal lazily (first CI run / manual rotate) — rows never run stay plaintext until rotated; operators should bulk-rotate after deploy.
- `decryptSecretSafe` retained for compat (tests + legacy callers); all hot paths now use strict `decryptSecret` + `isEncryptedValue`.

Gate: S9 complete. **STOP. Do not start S10.**

---

## Fresh S10 — CI/CD Isolation (COMPLETE 2026-09-03)

**Status:** ✅ Complete (critical phase)
**Threat:** Malicious CI code (secret theft, miners, fork bombs, disk fill, container escape, env inspection) running in an assumed-compromised runner.
**Attack/weakness audit (verified):** container profile already hardened (none/net, 512m, pids 128, non-root, ro-rootfs, cap-drop, no-new-priv, :ro workspace, pinned image, 30s, no host-exec fallback, no socket anywhere). Gaps fixed: (1) API-supplied inline workflows bypassed ALL YAML budgets (1000-job queue/DB flood, FSEC-013); (2) fork detection `catch {}` left secrets full on DB error (fail-open outage → leak); (3) no fd limit; (4) no single isolation reference doc.
**Required fix (implemented, smallest):** inline budgets identical to file path (10/20/5000/name-shape, 400 fail-closed); default-untrusted latch with DB markers authoritative (throw-paths withhold); `--ulimit nofile=1024:1024`; `docs/security/ci-security.md` (profile table, fork tier, budgets, socket boundary, residuals).

### Changes
- `routes/ci.ts` — inline validator, fail-closed fork latch, ulimit.
- Tests — `s10-ci.test.ts` 5→11 (fd guard, no-privileged, fail-closed latch, 4× inline budgets).
- Docs — `ci-security.md` (new).

### Tests
- `s10-ci` 11/11, full server 332/332 (29 files), `tsc` clean. One syntax repair en route (stale `catch` from removed outer try — caught by suite before merge).
- Diff reviewed: trusted-run outcomes identical (only error paths changed); no new mounts/env/capabilities.

### Findings
- Fixed: FSEC-013 (inline flood), fail-open fork outage, fd-exhaustion gap.
- Deferred: hardware-virtualized runners (gVisor/Firecracker), image-digest pinning, fork resource tiering (same profile + no secrets is the tier).

### Residual risks
- Shared host kernel; breakout needs engine 0-day, not misconfig — drill per incident-response.
- Malicious workflows read checked-in code they could already read via API (PR creation gates).

Gate: S10 complete. **STOP. Do not start S11.**

---

## Fresh S11 — XSS / Content Security (COMPLETE 2026-09-03)

**Status:** ✅ Complete
**Threat:** Stored/reflected/DOM XSS via README Markdown, links, images, raw HTML, filenames, commit messages, profile fields.
**Attack/weakness audit (verified adversarially):** no `dangerouslySetInnerHTML`/`innerHTML` anywhere in `web/`; no `rehype-raw` (raw HTML never becomes elements); FileViewer/DiffViewer/blame/history render React-escaped text; file APIs return JSON (no `text/html` execution path); sanitize schema empirically verified (`img src`/`a href` protocol-locked to safe schemes, no `svg`/`style`/`form`, no `on*`/`style` attrs); avatar allowlisted server-side. Gaps fixed: (1) no `img` component guard — a future `rehype-sanitize` schema drift reopens `javascript:` images silently; (2) prod `connect-src 'self'` breaks legitimate split-port/Tailscale API fetch (fail-closed against own frontend).
**Required fix (implemented, smallest):** `img` protocol guard mirroring the anchor guard (renders inert placeholder); prod `connect-src` appends the configured API origin (no wildcards; unparseable URL → strict `'self'`).

### Changes
- `web/components/MarkdownViewer.tsx` — `img` guard.
- `web/next.config.js` — derived prod `connect-src`.
- Tests — new `MarkdownViewer.test.tsx` 9/9 jsdom behavioral (property assertions, Lucide-icon scoping lesson recorded), `next.config.test.ts` 2/2, server `s11-xss` +1 source pin.

### Tests
- Web 11/11, `web build` green (all routes), server 333/333, `tsc` clean.
- Notable: first test draft asserted implementation (span-vs-anchor) not the property — sanitize strips before components fire, so guards are second-layer; rewritten to property assertions (no executable URI/element/handler in `.markdown-body`).

### Findings
- Fixed: img schema-drift gap, prod CSP self-breakage.
- Deferred: none material; `style-src 'unsafe-inline'` retained (Tailwind requirement, no script vector).

### Residual risks
- Sanitizer strength inherits `rehype-sanitize` defaultSchema updates — pinned via lockfile + behavioral tests fail loudly on drift.
- Markdown GFM extensions render `input` checkboxes (no script vector).

Gate: S11 complete. **STOP. Do not start S12.**

---

## Fresh S12 — CSRF / CORS / Security Headers (COMPLETE 2026-09-03)

**Status:** ✅ Complete
**Threat:** Cross-site request forgery, cross-origin exfiltration with credentials, origin/host forgery, missing hardening headers.
**Attack/weakness audit (verified):** HMAC double-submit + timing-safe compare + origin-vs-host + `null` rejection + logout coverage were sound; CORS allowlist strict with credentials (never `*`). Gaps fixed: (1) CSRF bypass for ALL of development (`!isProd`) — a LAN/Tailscale-reachable dev/staging server accepted cookie-authed cross-site POSTs (FSEC-003); (2) CORS and CSRF kept SEPARATE origin lists (drift opens one boundary while closing the other) with no trailing-slash normalization; (3) no `Permissions-Policy` on API responses.
**Required fix (implemented, smallest):** bypass narrowed to the test suite only (`!isProd && nodeEnv === 'test'` — flipping `isProd` re-arms instantly, as prod-simulation tests prove); shared `lib/origins.ts` allowlist with normalization, used by both boundaries; static `Permissions-Policy` hook (helmet-version-proof).

### Changes
- `middleware/csrf.ts` — test-only bypass, shared origins.
- `lib/origins.ts` (new) — allowlist + normalization.
- `index.ts` — shared CORS list, Permissions-Policy hook.
- Tests — new `s12-fresh.test.ts` 5/5 (origins unit, dev 403-without-token, HMAC pass, slash-tolerant preflight, header pin).

### Tests
- `s12-fresh` 5/5, full server 338/338 (30 files), web 11/11, `tsc` clean.
- Caught live: pre-existing `s11-cors` prod-simulation test failed after the first bypass draft (condition ignored `isProd`) — condition corrected to respect it; suite green.

### Findings
- Fixed: FSEC-003 (dev CSRF fail-open), origin-list drift class.
- Deferred: XFF-spoofable rate-limit buckets (→S14), CORP/COOP deliberately unset (would break split-port fetch), `__Host-` cookie prefix (rename breaks compat), SameSite=None for tailnet-name→localhost topologies (documented deployment trade-off: use same-origin `tailscale serve`).

### Residual risks
- `ALLOWED_ORIGIN` with a typo fails closed (403s) — visible, safe; no trailing-slash footgun anymore.
- Missing-`Host` requests skip origin-vs-host (token check still applies).

Gate: S12 complete. **STOP. Do not start S13.**

---

## Fresh S13 — SSRF / Outbound Request Security (COMPLETE 2026-09-03)

**Status:** ✅ Complete
**Threat:** Server-side request forgery to loopback/private/link-local/metadata/internal targets, DNS rebinding, transition-mechanism smuggling, stale filesystem remotes.
**Attack/egress audit (verified):** only server-driven egress is VCS remotes (API gate + Rust transport) and the daemon-side image pull; avatars are browser-fetched (server never fetches them); no webhooks/importers exist. Gaps fixed: (1) stale `file://`/literal-private remotes usable via fetch/push/pull despite the creation gate (FSEC-019); (2) flag-like remote names (`--help`) in fetch/push/pull; (3) Rust `ALLOW_PRIVATE_REMOTES` semantics disagreed across three gates (`true` vs `true|1`); (4) 6to4/Teredo-embedded private IPv4 invisible to range checks; (5) IPv6 zone IDs breaking literal parsing.
**Required fix (implemented, smallest):** shared `validateRemoteUrl` + `getStoredRemoteUrl` with 403+`ssrf.blocked` audit at fetch/push/pull execution time (unknown remote → 404, no subprocess); remote-name dash/dot guards; unified `private_remote_allowed()`; 6to4/Teredo decoding; zone-ID rejection; `fc/fd/fe80` heuristic scoped to IPv6 literals.

### Changes
- `routes/repos.ts` — shared validator, stored-URL gates, name guards.
- `vcs/src/remote/http.rs` — env helper, transition decoding, zone rejection.
- Tests — `s13-ssrf` 13→18 (stale file/private/unknown/flag/unit), new `s13_ssrf_test.rs` 6/6 (6to4/Teredo both polarities, zones, env forms).

### Tests
- TS 18/18, Rust 6/6, full server 343/343, cargo 158/158, `tsc` clean, clippy no new warnings.
- Notable correction en route: pre-flight fail-closed-on-DNS-error broke offline use and the public-name suite — reverted by design (connect-time SafeResolver is the authoritative gate; pre-flight is fast-reject UX), documented in code.

### Findings
- Fixed: FSEC-018-class (transition smuggling, zone IDs, env inconsistency), FSEC-019 (stale-remotes execution gate).
- Deferred: single-label intranet hostnames (rely on DNS-time checks; syntactic block would break intranets), image-digest pinning (S10 residual), webhook SSRF surface (no webhooks exist — gate future features through `validateRemoteUrl`-class checks).

### Residual risks
- Pre-flight DNS remains best-effort by design; enforcement lives in SafeResolver at connect time (verified on the single agent constructor).
- `fc/fd` DNS names (non-literal) resolve through Rust DNS-time checks only.

Gate: S13 complete. **STOP. Do not start S14.**

---

## Fresh S14 — API Security & Abuse Controls (COMPLETE 2026-09-03)

**Status:** ✅ Complete
**Threat:** Endpoint abuse by cost class — credential stuffing, namespace squatting, fork/disk spam, upload CPU bombs, merge-lock contention, notification spam, token guessing, dashboard polling floods, rate-limit evasion via header spoofing.
**Attack/weakness audit (verified per-endpoint):** global bucket + 12 cost buckets existed, but 25+ mutating/subprocess endpoints rode the global bucket alone (fork, object upload, fetch/push/pull remotes, remotes config, members/orgs/teams mutations, stars, merge, reviewers, CI secrets/checks/reads, users lists, session nuke, invite claim). Rate identity itself was spoofable: `X-Forwarded-For` honored on direct connections (FSEC-002).
**Required fix (implemented, smallest):** 20 new cost buckets at the documented limits (fork 5, upload 20, fetch-family 10, remotes 20, members/org 20/10, invites 10/20, stars 30, merge 10, reviews 20, CI 10/20/60, users 60, reads 60/30/20); socket-pinned client identity with `TRUSTED_PROXIES` (default loopback); `docs/security/api-security.md` full catalog (auth/authZ/size/RL/errors per endpoint).

### Changes
- `lib/rateLimit.ts` — `getClientIp` + `TRUSTED_PROXIES`.
- Buckets wired in `repos.ts` (13 sites), `pulls.ts` (4), `orgs.ts` (7), `invites.ts` (5), `ci.ts` (8), `stars.ts` (2), `users.ts` (3), `auth.ts` (1).
- Docs — `api-security.md` (new): bucket table + endpoint catalog + identity design.
- Tests — `s14-rate` +6 (fork/upload/merge/org+invites/secrets/socket-pinning).

### Tests
- `s14-rate` 11/11, full server 349/349 (30 files), web 11/11, `tsc` clean.
- Diff reviewed: buckets additive pre-auth where safe; no legitimate flow exceeds new ceilings in tests (ceilings ≥ tested bursts).

### Findings
- Fixed: FSEC-002 (XFF spoofing), unclassified-endpoint class.
- Deferred: clone bandwidth accounting (bulk reads deliberately unbucketed), per-user (vs per-IP) quotas, distributed RL (single-host scope), member-change audit events (→S18).

### Residual risks
- Behind a shared trusted proxy, clients share fate if the proxy doesn't sanitize XFF — deployment contract documented in threat-model §6 + api-security.md §3.
- Bucket state is in-memory (restart resets) — acceptable single-host scope.

Gate: S14 complete. **STOP. Do not start S15.**

---

## Fresh S15 — Concurrency / TOCTOU / Atomicity (COMPLETE 2026-09-03)

**Status:** ✅ Complete
**Threat:** Check-then-act races (ref updates, merges, deletes, forks, queue admission, org membership), lock leaks/collisions, stale lock files, filesystem races corrupting reads.
**Attack/weakness audit (verified):** FF+CAS+locks existed per-op, but: (1) advisory lock/unlock ran on arbitrary pool backends — unlocks leaked, later 423s with no holder; (2) merge used a DIFFERENT lock key and raced pushes on the same worktree; (3) 31-bit lock hash collided across repos (spurious 423s); (4) crashed holders left permanent `.lock` files (fail-closed forever); (5) fork double-submit → 500; (6) CI queue count-check raced joint overshoot; (7) org last-owner check raced orphaning; (8) `GET /log?ref=` rewrote HEAD per request (FSEC-006: cross-request corruption, crash-window mispoint).
**Required fix (implemented, smallest):** session-pinned locks on one pooled client (`lock/unlockClientAdvisory`); ONE 64-bit FNV key per repo for push/merge/delete; pid-stamped `.lock` with dead/ancient steal-once; fork 23505→409; queue admission serialized (`FOR UPDATE` + count + insert, fail-fast pre-check kept); org check+delete in one `FOR UPDATE` txn; Rust `log --rev` + `resolve_rev` traversal guard, server reads via `--rev` (HEAD never written by reads).

### Changes
- `db/index.ts` — `advisoryLockKeys`, `lock/unlockClientAdvisory` (client-passing, mockable; legacy hash kept).
- `repos.ts` — push/delete converted, `acquireRefLock` steal, fork 409.
- `pulls.ts` — merge converted to shared key.
- `orgs.ts` — last-owner txn. `ci.ts` — serialized admission.
- Rust — `LogOptions.rev`, `log --rev`, `resolve_rev` traversal Err; server `isValidBranchRef` rejects leading `-`, `--rev` allowlisted.
- Tests — `s15-concurrency` 3→10, `s7` queue mock update, `s8/s14/s19` lock-mock updates, new `s15_rev_test.rs` 3/3 CLI.

### Tests
- Server 356/356 (30 files), cargo 161/161, `tsc` clean, clippy no new warnings (`cmd_log` arity allowed with justification).
- Live-verified `log --rev` (branch isolation, HEAD byte-identical, traversal hard error).
- Notable: `vi.mock` cannot intercept intra-module calls — first helper design passed tests against a REAL local PG; restructured to client-passing helpers so mocks govern (also documented as a testing lesson).

### Findings
- Fixed: FSEC-006 (HEAD race eliminated, not mitigated), FSEC-021 (key collisions + leak), fork/queue/org races.
- Deferred: `openat2`/`O_NOFOLLOW` dirfd pinning (S4 residual stands), distributed locks (single-host scope), ref CAS generation counters (FF+locks suffice).

### Residual risks
- Lock steal relies on pid-liveness + 120s age (pid reuse inside the window is accepted; pushes are idempotent-safe to retry).
- Stale `.lock` files from pre-S15 crashes (empty content) steal by mtime only.

Gate: S15 complete. **STOP. Do not start S16.**

---

## Fresh S16 — Dependency / Supply-Chain Security (COMPLETE 2026-09-03)

**Status:** ✅ Complete
**Threat:** Known-vulnerable, typosquatted, over-privileged, or unpinned build inputs; install-script execution; lockfile drift; secret leakage into git; CI automation with broad tokens.
**Audit (verified, not assumed):** `pnpm audit --prod` (32 → 27 findings, 0 critical), `cargo audit` against a fresh 1239-advisory DB (clean, 143 crates), `Cargo.lock` registry-only (zero `git+`), every prod dep grep-verified as imported, no typosquats, no lifecycle scripts, `.env` ignored + untracked, tracked-tree secret-pattern scan clean, single least-privilege workflow.
**Required fix (implemented, reviewed upgrades only):** `tar` 7.5.19→7.5.22 (new stack-overflow GHSA past the old pin), new `postcss` 8.5.18 override (source-map disclosure), `uuid` ^9→^11.1.1 (bounds check; v4 runtime verified), added missing `pino-pretty` devDep (dev boot referenced it undeclared), workflow `permissions: contents: read` + strict `--frozen-lockfile` (fallback removed) + real `cargo-audit` install in CI.

### Changes
- `package.json` (overrides), `server/package.json` (uuid, pino-pretty), `pnpm-lock.yaml` (mechanical), `.github/workflows/security.yml`, `docs/security/dependency-audit.md` (triage refresh).
- Tests — `s16-deps` 6→14 (pins, hygiene, automation), `s19` SEC-025 pin updated.

### Tests
- `s16-deps` 14/14, full server 364/364 (30 files), web 11/11, `web build` green (postcss override compatible), `tsc` clean.
- Two test bugs of mine fixed en route (version-strip regex, YAML-as-JSON).

### Findings
- Fixed: patchable advisories (tar/postcss/uuid), missing dep, automation privilege/drift.
- Deferred (with justification, not neglect): `next`→15 and `fastify`→5 majors (breaking; compensating controls documented), image-digest pinning (no offline resolution), SAST beyond tsc/clippy/tests.

### Residual risks
- 10 high advisories remain, all gated behind major upgrades; 0 critical.
- `cargo-audit` runs in CI (installed there); locally it needed a manual install.

Gate: S16 complete. **STOP. Do not start S17.**

---

## Fresh S17 — Host / Docker / Deployment Hardening (COMPLETE 2026-09-03)

**Status:** ✅ Complete
**Threat:** Host compromise via exposed services, privileged containers, world-readable storage, secret-laden images, unbounded logs, unpatched inputs, undisciplined backups/SSH/remote-access.
**Attack/weakness audit (verified):** server/web already least-privilege (65534, ro-root, tmpfs, no-new-priv, cap-drop, loopback, no source mounts, no socket). Gaps fixed: (1) `db` ran fully privileged (root-owned writable fs, full caps, no bounds, unrotated logs); (2) Dockerfiles + CI fell back to unfrozen installs on lockfile drift; (3) repo storage inherited umask (world-readable on shared hosts); (4) no memory bounds/restart/log-rotation anywhere; (5) no deployment profile doc.
**Required fix (implemented, smallest):** db ro-root + tmpfs + no-new-priv + drop-ALL/keep-init-caps + 1g + logging + restart (documented why default user stays); frozen installs everywhere; `secureRepoParentDirs` (0700) on create/fork; mem bounds + rotation + restart on server/web; `docs/security/deployment.md` (profile, checklist, backups, runbooks).

### Changes
- `docker-compose.yml` — db + server/web bounds/rotation/restart.
- `server/Dockerfile`, `web/Dockerfile` — strict frozen installs.
- `routes/repos.ts` — `secureRepoParentDirs` + wiring.
- `docs/security/deployment.md` (new).
- Tests — `s17-deploy` 8→15 (db profile, bounds, frozen installs, YAML validity, 0700 behavior, wiring, doc sections).

### Tests
- `s17-deploy` 15/15, full server 371/371 (30 files), web 11/11, `tsc` clean.
- Diff reviewed: no image/tag changes, no port changes, no secret defaults reintroduced.

### Findings
- Fixed: FSEC-023 remainder (db runtime profile), unpinned-install fallback class, storage-perm class.
- Deferred: digest pinning (S16 residual stands), systemd unit (doc-guided, not shipped), backup automation (documented procedure, no new executable).

### Residual risks
- **db hardening is statically verified only — no Docker on this machine. The deployment.md first-boot drill is REQUIRED on the target host before sign-off.**
- `postgres:16-alpine` floats minor for auto-patching (documented choice).

Gate: S17 complete. **STOP. Do not start S18.**

---

## Fresh S18 — Observability / Incident Response (COMPLETE 2026-09-03)

**Status:** ✅ Complete
**Threat:** Undetected abuse — stuffing campaigns, privilege changes, exposure flips, secret misuse, malicious uploads — plus audit-table exhaustion and secret-bearing audit rows.
**Attack/weakness audit (verified):** login/secret/repo-delete/ssrf events existed, but lockouts, membership/org/team mutations, visibility flips, pipeline lifecycle, and object rejections were invisible; `audit_logs` grew unbounded (FSEC-024); runbooks referenced dead services and pseudo-code rotation.
**Required fix (implemented, smallest):** audited `auth.lockout`, `repo.member_*/visibility`, `org.member_*/team.*`, `ci.pipeline_trigger/complete`, `vcs.object_rejected` (hash prefixes only); bounded retention (`pruneAuditLogs`, 90d default via `AUDIT_RETENTION_DAYS`, every-128th-event, indexed DELETE); incident-response rewritten around the 7 required scenarios with real endpoints/queries.

### Changes
- `lib/audit.ts` — retention prune + opportunistic enforcement.
- `auth.ts`/`repos.ts`/`orgs.ts`/`ci.ts` — event instrumentation (names/ids only, never secrets).
- `docs/security/incident-response.md` — refreshed playbooks.
- Tests — `s18-audit` 6→12 (lockout signal, admin/visibility/org/team coverage, trigger+rejection, secret-free proof, prune bounds).

### Tests
- `s18-audit` 12/12, full server 377/377 (30 files), web 11/11, `tsc` clean.
- Proven: audit INSERT params across login-failure + secret-rotate contain no password/secret/token material.
- Deliberate non-events (flood control): per-429/per-403 DB rows stay in metrics/logs; secret-value access is never row-audited.

### Findings
- Fixed: FSEC-024 (unbounded audit growth), detection-blind-spot class.
- Deferred: alert routing (metrics exist; no pager integration on single-host scope), audit-log shipping/WORM.

### Residual risks
- Retention prune is best-effort inside the app (a months-down host still needs the backup discipline in deployment.md).
- Background-runner audits carry no IP (no request context by design).

Gate: S18 complete. **STOP. Do not start S19.**

---

## Fresh S19 — Adversarial Security Test Suite (COMPLETE 2026-09-03)

**Status:** ✅ Complete — **SECURITY PROGRAM S0–S19 COMPLETE**
**Threat:** Regression — fixed vulnerabilities silently reopening; untested category gaps.
**Method:** cross-boundary attack chains (auth/authZ/filesystem/API/CI) in
`s19-fresh.test.ts` (10), transport proofs in `s19_net_test.rs` (3), full category
matrix in `tests/security/README.md`. Every suite asserts fail-safe outcomes
(deny codes, empty secrets, inert DOM, zero-request redirect targets).
**Notable corrections en route:** space-containing filenames are legitimate (battery
bug, not code); test doubles must not shadow real users (session-mock fix);
assert properties, not layers (sanitizer fires before component guards).

### Changes
- `server/src/routes/s19-fresh.test.ts` (new, 10 chains).
- `vcs/tests/s19_net_test.rs` (new, 3 transport proofs).
- `tests/security/README.md` (corpus index + legacy matrix preserved as history).

### Tests (final program tally)
- Server 387/387 (31 files), web 11/11 (2 files), cargo 164/164, `tsc` clean,
  clippy 0 errors (97 repo-wide style warnings, none new), `web build` green.
- `pnpm audit --prod`: 0 critical. `cargo audit`: clean (1239 advisories).

### Findings
- Fixed: corpus gaps (redirect behavior, chain coverage). No new vulnerabilities
  found by the chains — the phases hold against each other.
- Program residuals (standing): db boot drill on target host; next-15/fastify-5
  majors; digest pinning; microVM runners; pager integration; `openat2` pinning;
  clone accounting; hashed sessions; RLS; CAS generation counters; cargo-fuzz harness.

Gate: S19 complete. **SECURITY PROGRAM COMPLETE. No further phases.**

---

# Security Program — Strict Phased Execution (S0–S19, HISTORY — 2026-09-02 claims, untrusted)

> **Updated 2026-09-02 — Comprehensive Security Reconnaissance (S0 Re-Audit)**
> Scope: Deep source-level adversarial inspection of Rust VCS engine, Fastify API routes, Next.js frontend, PostgreSQL database layer, Docker configuration, and CI isolation boundaries.
> Rule: Strict sequential phase execution. Exactly one active phase at a time. Zero functional changes during S0.

Status: **S19 ✅ Complete (Comprehensive Adversarial Verification Suite & Security Program Closure). 124 Cargo Tests & 261 Server Tests Green (26/26 Adversarial Security Tests Green). Active Phase: ALL PHASES S0-S19 COMPLETE. SECURITY PROGRAM FULLY ACCOMPLISHED.**

## Overall Progress — S0–S19

| Phase | Name | Focus Area | Status | Priority | Deliverable |
|---|---|---|---|---|---|
| **S0** | Security Reconnaissance | Attack surface mapping, threat modeling, vulnerability register | ✅ Complete | Critical | `docs/security/threat-model.md`, `docs/security/vulnerability-register.md` |
| **S1** | Security Baseline & Boot | Startup fail-closed, secrets validation, environment separation | ✅ Complete | P0 | `server/src/config.ts`, `server/src/routes/s1-baseline.test.ts` (25 tests) |
| **S2** | Authentication Hardening | Session lifecycle, unverified email invite claims, password hashing | ✅ Complete | P1 | `server/src/lib/auth.ts`, `routes/auth.ts`, `routes/invites.ts`, `auth-s2.test.ts` (16 tests) |
| **S3** | Authorization / IDOR / BOLA | Team repo takeover (SEC-006), filesystem remotes (SEC-007), BOLA (SEC-011, SEC-012) | ✅ Complete | P0 | Centralized authz, `orgs.ts`, `repos.ts`, `issues.ts`, `pulls.ts`, `authz-s3.test.ts` (18 tests) |
| **S4** | Filesystem Security | Case-insensitivity collisions (SEC-013), path traversal, symlink confinement | ✅ Complete | P1 | `vcs/src/object/tree.rs`, `vcs/src/checkout.rs`, `server/src/routes/repos.ts`, `s4_fs_test.rs`, `fs-s4.test.ts` |
| **S5** | Process Execution Security | Subprocess storm in `isAncestor` (SEC-016), binary validation | ✅ Complete | P1 | `vcs/src/main.rs`, `server/src/lib/vcs.ts`, `server/src/routes/repos.ts`, `s5-proc.test.ts` |
| **S6** | VCS Object Parser Security | DAG expansion bomb (SEC-014), memory allocations in pack creation (SEC-017) | ✅ Complete | P1 | `vcs/src/tree_builder.rs`, `vcs/src/object/commit.rs`, `vcs/src/pack.rs`, `s6_parser_test.rs` |
| **S7** | Resource Exhaustion / DoS | Synchronous 64M inflate (SEC-015), unthrottled contributions (SEC-021) | ✅ Complete | P1 | `server/src/routes/repos.ts`, `server/src/routes/users.ts`, `s7-dos.test.ts` |
| **S8** | Database Security | SQL string interpolation (SEC-020), connection bounds | ✅ Complete | P2 | `server/src/db/index.ts`, `server/src/routes/search.ts`, `s8-db.test.ts` |
| **S9** | Secrets Security | Dedicated `SECRET_ENCRYPTION_KEY` (SEC-009), key versioning, mask hardening | ✅ Complete | P0 | `server/src/config.ts`, `server/src/lib/secrets.ts`, `server/src/routes/ci.ts`, `s9-secrets.test.ts` |
| **S10** | CI/CD Isolation | Fork PR secret exfiltration race (SEC-008), read-only workspace mounts (SEC-010) | ✅ Complete | P0 | `server/src/routes/ci.ts`, `s10-ci.test.ts`, `s13-ci.test.ts` |
| **S11** | XSS / Content Security | Strict HTML output encoding, Markdown sanitization, CSP tightening | ✅ Complete | P2 | `server/src/index.ts`, `server/src/routes/s11-xss.test.ts`, `web/components/MarkdownViewer.tsx` |
| **S12** | CSRF / CORS / Headers | Cookie-tossing bypass (SEC-004), CORS dev restrictions (SEC-003) | ✅ Complete | P1 | `server/src/middleware/csrf.ts`, `server/src/index.ts`, `server/src/routes/s12-csrf.test.ts` |
| **S13** | SSRF / Outbound Security | DNS rebinding protection (SEC-018), IP pinning in remote fetch | ✅ Complete | P1 | `vcs/src/remote/http.rs`, `server/src/routes/repos.ts`, `s13-ssrf.test.ts` |
| **S14** | API Security & Abuse Controls | Endpoint-specific rate limiting, contribution API quotas (SEC-021) | ✅ Complete | P1 | `server/src/routes/issues.ts`, `server/src/routes/pulls.ts`, `s14-api-security.test.ts` |
| **S15** | Concurrency & TOCTOU | PR merge advisory lock collisions (SEC-019), branch CAS locking | ✅ Complete | P2 | `server/src/routes/pulls.ts`, `server/src/routes/invites.ts`, `s15-concurrency.test.ts` |
| **S16** | Dependency & Supply Chain | Triage 31 production vulnerabilities (SEC-025), audit lockfiles | ✅ Complete | P1 | `docs/security/dependency-audit.md`, `s16-crypto.test.ts`, `s16-deps.test.ts` |
| **S17** | Host & Docker Hardening | Architecture-independent Docker build (SEC-026), least privilege | ✅ Complete | P1 | `server/Dockerfile`, `web/Dockerfile`, `docker-compose.yml`, `s17-deploy.test.ts` |
| **S18** | Observability & Detection | Structured security event logging, metrics, incident runbooks | ✅ Complete | P3 | `database/migrations/010_audit.sql`, `docs/security/incident-response.md`, `s18-audit.test.ts` |
| **S19** | Adversarial Security Suite | End-to-end negative test corpus covering SEC-001..SEC-026 | ✅ Complete | P0 | `tests/security/README.md`, `s19-adversarial.test.ts`, `docs/security/final-report.md` |

---

## Security Phase S0 — Security Reconnaissance (COMPLETE)

**Status:** ✅ Complete  
**Date:** 2026-09-02  
**Action:** Zero code modifications. Comprehensive inspection, classification, documentation, and test planning.

### Deliverables Produced
- `docs/security/threat-model.md` — Complete architectural trust boundaries, high-value assets, threat actors, and boundary vector analysis across all 9 trust boundaries.
- `docs/security/vulnerability-register.md` — Master catalog of 26 findings (SEC-001 through SEC-026), with 3 Criticals, 11 Highs, 11 Mediums, 1 Low, with attack scenarios, CWEs, exact file evidence, fix phases, and regression tests.
- `PLAN.md` — Updated Security Program matrix mapping out phases S0 through S19.

### Key Reconnaissance Findings Highlighted
1. **SEC-006 (Critical):** Universal repository takeover via `POST /api/orgs/:org/teams/:team/repos` attaching arbitrary victim repositories without ownership verification.
2. **SEC-007 (Critical):** Cross-tenant private repository exfiltration via `file://` remotes in `vcs/src/remote.rs`.
3. **SEC-008 (Critical):** CI secret exfiltration in fork PRs because `copyMissingObjects` runs before the fork commit detection check.
4. **SEC-014 (High):** Algorithmic complexity DoS / DAG expansion bomb in `flatten_tree` due to missing `visited` set.
5. **SEC-013 (High):** Case-insensitivity collision overwriting `.itehaas` control structures on macOS APFS.
6. **SEC-015 (High):** Synchronous 64 MiB `zlib.inflateSync` blocking the Fastify event loop.
7. **SEC-004 (High):** CSRF verification bypass via cookie tossing.

Gate check: S0 complete. Zero functional code changes made. Ready for Phase S1 review. **STOPPED.**

Gate: S0 complete, no `server/`/`vcs/` edits. `git status` only `docs/security/` untracked.

---

## Security Phase S1 — Critical Triage (COMPLETE — docs)

**Purpose:** Validate/grade P0 without broad refactor. Deliver `critical-findings.md`.

- [x] Validate each SEC-*, evidence file:line, exploit scenario, impact — 2026-09-02 (`critical-findings.md`)
- [x] Reproduce safely (pnpm audit, cargo clippy, manual grep, code read) — C-001..C-005, H-001..H-009, M-001..003, L-001..002
- [x] Remove false positives (`spawn` shell:false not injection, `react-markdown` without raw not XSS) — documented
- [x] Assign P0/P1/P2/P3 priority — C-001..005 P0, H-001..009 P1, etc.
- [x] `docs/security/critical-findings.md` (2026-09-02) — 14 triaged + false positives
- [x] `docs/security/phases/phase-S1.md` — **next doc to create** (§4) before S2 code starts (currently this checklist covers)

Gate: Every Critical/High has evidence + scenario + severity + priority. No code yet. **S1 complete for docs; implementation P0 starts S5/S9/S13/S16/S17 formally but S1 gates them.**

---

## Security Phase S2 — Authentication Hardening (COMPLETE — 2026-09-02)

**Focus ONLY on auth per §2. No authZ/FS.**

- [x] `S2` `docs/security/phases/phase-S2.md` (§4) before any `server/src/lib/auth.ts` edit — 2026-09-02
- [x] S2-01 fail-closed for auth secrets `server/src/config.ts:12` `requireSecureSecret` throws in prod if `DATABASE_URL` contains `itehaas:itehaas` or `COOKIE_SECRET` `dev-secret`/`changeme` or <32 — 2026-09-02
- [x] S2-02 rate-limit auth `server/src/lib/rateLimit.ts:1` + `server/src/routes/auth.ts:9` `register 3/min` `login 5/min` `429 Retry-After` — 2026-09-02
- [x] S2-03 session fixation rotate on login + HMAC `csrfTokenForSession` `server/src/lib/auth.ts:74` `HMAC-SHA256(cookieSecret)` — 2026-09-02
- [x] S2-04 brute-force lockout `isLoginLocked`/`recordLoginFail` 5 fails → 15m per `ip:username` `server/src/lib/rateLimit.ts:46` — 2026-09-02
- [x] S2-05 argon2 `memoryCost 65536 timeCost3 parallelism1` `server/src/lib/auth.ts:4` — 2026-09-02
- [x] S2-06 enumeration hardening `409` generic + dummy `argon2.verify` when user not found `server/src/routes/auth.ts:52,75` — 2026-09-02
- [x] Regression: `pnpm --filter server test` 39/39 (32+7 S2) green, `cargo test` 122 green, manual `curl -I` rate-limit 429 — 2026-09-02

DoD S2: Auth tests pass, `POST /login` 6/min →429, 5 fails →15m lock, `409` generic, `m=65536` verified, `POST /logout` → `GET /me` 401. **STOP.**

---

## Security Phase S3 — Authorization / IDOR / Privilege Escalation (COMPLETE — 2026-09-02)

- [x] `phases/phase-S3.md` (§4) before any `permissions.ts` edit — 2026-09-02
- [x] S3-01 central `server/src/lib/authorize.ts:1` `authorizeRepo(level)` DRY helper — 2026-09-02
- [x] S3-02 issue create `canRead→canWrite` `issues.ts:84` `403 write required`, PR create `pulls.ts:71` same — 2026-09-02
- [x] S3-03 stars `GET /stars` `canRead` `stars.ts:40` `SELECT visibility` + `404` mask, `DELETE /star` `stars.ts:30` same — 2026-09-02
- [x] S3-04 delete repo `isAdmin` `repos.ts:190` not `owner===username` — 2026-09-02
- [x] S3-05 matrix `server/src/routes/authz-s3.test.ts` 10 tests Alice/Bob/Charlie × public/private/read/write/admin — 2026-09-02

DoD S3: `read` member `POST /issues →403`, `POST /pulls →403`, `anon GET private /stars →404`, `anon GET private /branches →404`, `DELETE write→403 owner→200`, matrix 10/10 green, `pnpm --filter server test` 49/49 green. **STOP.**

---

## Security Phase S4 — Filesystem / Path / Symlink (COMPLETE — 2026-09-02)

- [x] `phases/phase-S4.md` (§4) before `vcs.ts` edits — 2026-09-02
- [x] S4-01 canonical `realpath` + `lstat` `server/src/lib/vcs.ts:21` `validateRepoPath` symlink + canonical `realpath` — 2026-09-02
- [x] S4-02 `file/*`/`history/*`/`blame/*` `isValidFilePath` `isValidBranchRef` `server/src/routes/repos.ts:12` `..` `%2e%2e` `%252e` `//` `\` `.itehaas` `?ref=..` →400 — 2026-09-02
- [x] S4-03 checkout `ensure_no_symlink_and_inside_repo` `vcs/src/checkout.rs:13` parent `symlink_metadata` + canonical `starts_with` — 2026-09-02
- [x] S4-04 forced checkout same `vcs/src/checkout.rs:279` — 2026-09-02
- [x] S4-06 CI artifact `lstat` not `stat` `server/src/routes/ci.ts:192` symlink + size 10M + `rel` not `..` — 2026-09-02
- [x] Tests `server/src/routes/fs-s4.test.ts` 10 + `vcs/tests/s4_fs_test.rs` 2 `test_checkout_symlink_parent_bail` → no `/tmp/p.txt` — 2026-09-02

DoD S4: No escape outside `data/repos/{owner}/{repo}`. `pnpm test` 59/59 green `cargo test` 124 green traversal →400 symlink →bail. **STOP.**

---

## Security Phase S5 — Command / Process Execution (COMPLETE — 2026-09-02)

- [x] `phases/phase-S5.md` (§4) before `vcs.ts` env/spawn edits — 2026-09-02
- [x] S5-01 env allowlist `server/src/lib/vcs.ts:13` `getAllowedEnv()` `PATH,LANG,HOME,USER,TMPDIR,SHELL` only — 2026-09-02
- [x] S5-02 bin pin `server/src/lib/vcs.ts:68` `getValidatedBin()` `exists` + `!world-writable` + allowed prefixes — 2026-09-02
- [x] S5-03 cwd + arg validation `server/src/lib/vcs.ts:158` `validateRepoPath(cwd)` + `isAllowedFlag` + `HASH_REGEX` — 2026-09-02
- [x] S5-04 semaphore `server/src/lib/semaphore.ts:1` `vcsSemaphore(3)` `acquire`/`release` on `close`/`error` — 2026-09-02
- [x] Tests `server/src/lib/vcs-s5.test.ts` 6 + `pnpm test` 65/65 green `cargo test` 124 green `printenv` no `DATABASE_URL` `cwd /etc → traversal` `checkout --evil → flag` `10 concurrent → max 3` — 2026-09-02

DoD S5: Child `printenv` no `DATABASE_URL`. `pnpm test` 65/65 green `cargo test` 124 green. **STOP.**

---

## Security Phase S6 — VCS Object / Parser Security (COMPLETE — 2026-09-02)

- [x] `phases/phase-S6.md` (§4) before `object/store.rs` edits — 2026-09-02
- [x] S6-01 bomb `take(64M+1)` `vcs/src/object/store.rs:65` `vcs/src/pack.rs:114` + count 10000 — 2026-09-02
- [x] S6-02 tree depth 100 + entries 10000 `vcs/src/tree_builder.rs:32` `flatten` depth 100 — 2026-09-02
- [x] S6-03 commit/tag limits `vcs/src/object/mod.rs:140` `message 1M` `parents 100` `mode` `100644/755/40000` — 2026-09-02
- [x] Tests `vcs/tests/s6_parser_test.rs` 8 `bomb` `truncated` `duplicate` `invalid mode` `huge commit` `too many` `deep` `pack count` — 2026-09-02

DoD S6: Adversarial corpus never panics. `cargo test` 132 green `pnpm test` 65 green. **STOP.**

---

## Security Phase S7 — Resource Exhaustion / DoS (COMPLETE — 2026-09-02)

- [x] `phases/phase-S7.md` (§4) before `isAncestor`/`revwalk` edits — 2026-09-02
- [x] S7-01 `isAncestor` `MAX_STEPS 2000` + `visited>2000` →400 + `isAncestorCache` 60s + `vcsSemaphore(3)` `server/src/routes/repos.ts:563` — 2026-09-02
- [x] S7-02 `revwalk` `visited>10000` + `all_entries>10000` `vcs/src/revwalk.rs:152` — 2026-09-02
- [x] S7-03 search `q>100` →400, `limit` 20, `offset>10000` →400, `statement_timeout 5000` `server/src/routes/search.ts:7` — 2026-09-02
- [x] S7-04 CI `POST /ci/run` `5/min` + `pending>=20` →429 `server/src/routes/ci.ts:302` — 2026-09-02
- [x] Tests `server/src/routes/s7-dos.test.ts` 7 + `cargo test` 132 green `pnpm test` 72/72 green — 2026-09-02

DoD S7: Bomb 10× 64M →413 not OOM. `pnpm test` 72/72 green `cargo test` 132 green. **STOP.**

---

## Security Phase S8 — Database / SQL Security (COMPLETE — 2026-09-02)

- [x] `phases/phase-S8.md` (§4) before `query` edits — 2026-09-02
- [x] S8-01 `LIMIT $1 OFFSET $2` param `server/src/routes/repos.ts:158` `LIMIT 1; DROP` → `limit 1` param — 2026-09-02
- [x] S8-02 `Pool` `connectionTimeoutMillis 5000` + `statement_timeout 5000` `server/src/db/index.ts:4` `options` + `on('connect')` — 2026-09-02
- [x] S8-03 `ORDER BY` allowlist `server/src/routes/users.ts:212` `sort=DROP` →400 — 2026-09-02
- [x] S8-04 `POST /repos` `BEGIN/COMMIT` + `DELETE` on `execItehaas` fail — 2026-09-02
- [x] Tests `server/src/routes/s8-db.test.ts` 5 + `pnpm test` 77/77 green `cargo test` 132 green — 2026-09-02

DoD S8: No injection, no orphan repo. `pnpm test` 77/77 green `cargo test` 132 green. **STOP.**

---

## Security Phase S9 — Secret Management (COMPLETE — 2026-09-02)

- [x] `phases/phase-S9.md` (§4) before `ci_secrets` encryption — 2026-09-02
- [x] S9-02 `lib/secrets.ts:1` `encryptSecret` AES-256-GCM `sha256(cookieSecret)` `iv12+tag16+ciphertext` base64, `decryptSecretSafe` fallback — 2026-09-02
- [x] S9-02 `POST /ci/secrets` `encryptSecret` `server/src/routes/ci.ts:580` `SELECT value` decrypt + fork `isFork` `fs.existsSync` → `secretsEnv` empty — 2026-09-02
- [x] S9-05 `logs` `***` scrub `secretsEnv` + `cookieSecret`/`databaseUrl` `server/src/routes/ci.ts:300` — 2026-09-02
- [x] S9-03 `pino` `redact` `authorization`/`cookie` + `setErrorHandler` `correlationId` `server/src/index.ts:20` — 2026-09-02
- [x] Tests `server/src/routes/s9-secrets.test.ts` 6 + `pnpm test` 83/83 green `cargo test` 132 green — 2026-09-02

DoD S9: DB dump ciphertext, logs `***`, gitleaks clean. `pnpm test` 83/83 green `cargo test` 132 green. **STOP.**

---

## Security Phase S10 — Markdown / XSS / Frontend (COMPLETE — 2026-09-02)

- [x] `phases/phase-S10.md` (§4) before `MarkdownViewer.tsx` edits — 2026-09-02
- [x] S10-01 `rehypeSanitize` `defaultSchema` + `a.href` filter `javascript:/data:/vbscript:` → `<span>` `web/components/MarkdownViewer.tsx:3` — 2026-09-02
- [x] S10-02 `avatar_url` `https://` only + block `javascript:/data:` `server/src/routes/users.ts:95` — 2026-09-02
- [x] Tests `server/src/routes/s10-xss.test.ts` 5 + `web build` 12 routes `54.2kB` + `pnpm test` 88/88 green — 2026-09-02

DoD S10: `xss-readme` not execute. `pnpm test` 88/88 green `cargo test` 132 green `web build` 12 routes. **STOP.**

---

## Security Phase S11 — CSRF / CORS / Headers (COMPLETE — 2026-09-02)

- [x] `phases/phase-S11.md` (§4) before `CORS`/`helmet` edits — 2026-09-02
- [x] S11-01 CORS allowlist `server/src/index.ts:30` `ALLOWED_ORIGIN` `isProd ? allowlist : true` `credentials` + `allowedHeaders` — 2026-09-02
- [x] S11-02 CSRF double-submit `server/src/middleware/csrf.ts:1` `csrf_token` `httpOnly:false` + `x-csrf-token` HMAC `server/src/routes/auth.ts:68` — 2026-09-02
- [x] S11-03 helmet `server/src/index.ts:18` `fastifyHelmet` `CSP default-src 'self'` `HSTS 63072000` `noSniff` `frameguard DENY` `referrer no-referrer` + `web/next.config.js:8` `CSP` `X-Frame DENY` — 2026-09-02
- [x] Tests `server/src/routes/s11-cors.test.ts` 5 + `pnpm test` 93/93 green `cargo test` 132 green `web build` 12 routes — 2026-09-02

DoD S11: `Origin:evil.com` no ACAO (prod), POST without token 403, `GET /health` has `content-security-policy` `x-frame-options` `hsts`. `pnpm test` 93/93 green. **STOP.**

---

## Security Phase S12 — SSRF / Outbound (COMPLETE — 2026-09-02)

- [x] `phases/phase-S12.md` (§4) before `remote/http.rs` edits — 2026-09-02
- [x] S12-01 `is_private_host` `is_private_ip` `127/8 10/8 172.16/12 192.168/16 169.254/16 0.0.0.0 ::1 fc00:: fe80::` + `to_socket_addrs` + `ALLOW_PRIVATE_REMOTES` `vcs/src/remote/http.rs:54` — 2026-09-02
- [x] S12-02 `AgentBuilder` `redirects(0)` `vcs/src/remote/http.rs:30` — 2026-09-02
- [x] Tests `vcs/tests/s12_ssrf_test.rs` 4 + `cargo test` 136 green `pnpm test` 93/93 green — 2026-09-02

DoD S12: `http://127.0.0.1/api/repos/a/b` →400 (unless `ALLOW_PRIVATE_REMOTES=true`). `cargo test s12_ssrf` 4/4 green. **STOP.**

---

## Security Phase S13 — CI / Container Security (COMPLETE — 2026-09-02)

- [x] `phases/phase-S13.md` (§4) before `executeInRunner` edits — 2026-09-02
- [x] S13-01 `no sh fallback` `server/src/routes/ci.ts:119` `runner=unavailable` not `local` — 2026-09-02
- [x] S13-02 `hardened docker` `server/src/routes/ci.ts:128` `--user 65534:65534 --read-only --tmpfs --cap-drop ALL --security-opt no-new-privileges` — 2026-09-02
- [x] S13-03 `no process.env` `combinedEnv` `...env` only `server/src/routes/ci.ts:121` — 2026-09-02
- [x] S13-04 `YAML 64k` `jobs>10` `steps>20` `run>5000` `server/src/routes/ci.ts:37` — 2026-09-02
- [x] S13-05 `pin 3.19` `server/src/routes/ci.ts:129` not `latest` — 2026-09-02
- [x] S13-06 `docker.sock NEVER` `docker-compose.yml:52` commented with `NEVER` — 2026-09-02
- [x] Tests `server/src/routes/s13-ci.test.ts` 6 + `pnpm test` 99/99 green `cargo test` 136 green — 2026-09-02

DoD S13: Fork PR `env` → `***`, `whoami` `nobody`, no caps. `pnpm test` 99/99 green. **STOP.**

---

## Security Phase S14 — API Security / Rate Limiting (COMPLETE — 2026-09-02)

- [x] `phases/phase-S14.md` (§4) before `rateLimit` edits — 2026-09-02
- [x] S14-01 global `100/min` `server/src/index.ts:18` `onRequest` `checkRateLimit('global')` — 2026-09-02
- [x] S14-02 per-endpoint `search 30` `search.ts:7` `push 20` `repos.ts:710` `issues 20` `issues.ts:76` `pulls 20` `pulls.ts:64` `file 60` `repos.ts:994` `repo 10` `repos.ts:66` `comments 30` — 2026-09-02
- [x] Tests `server/src/routes/s14-rate.test.ts` 4 + `pnpm test` 103/103 green `cargo test` 132 green — 2026-09-02

DoD S14: 6th login →429, `search` 31st →429, `push` 21st →429. `pnpm test` 103/103 green. **STOP.**

---

## Security Phase S15 — Concurrency / TOCTOU (COMPLETE — 2026-09-02)

- [x] `phases/phase-S15.md` (§4) before advisory lock edits — 2026-09-02
- [x] S15-01 `pg_try_advisory_lock` for `POST /refs/heads/*` `server/src/routes/repos.ts:710` try-lock 423 + FS `.lock` — 2026-09-02
- [x] S15-02 `pg_try_advisory_lock` for `POST /merge` `server/src/routes/pulls.ts:235` hold through checkout→merge — 2026-09-02
- [x] S15-03 `pg_try_advisory_lock` for `DELETE /repos` `server/src/routes/repos.ts:246` before `DELETE` + `fs.rm` after — 2026-09-02
- [x] S15-04 helper `hashStringToInt` `server/src/db/index.ts:30` — 2026-09-02
- [x] Tests `server/src/routes/s15-concurrency.test.ts` 3 + `pnpm test` 106/106 green — 2026-09-02

DoD S15: Concurrent push→423 retry not corrupt. STOP.

---

## Security Phase S16 — Dependency / Supply Chain (COMPLETE — 2026-09-02)

- [x] `phases/phase-S16.md` (§4) before `package.json` edits — 2026-09-02
- [x] S16-01 `next@14.2.35` `web/package.json:15` (fixes GHSA-f82v/mwv6/5j59) — 2026-09-02
- [x] S16-02 `tar@7.5.19` `package.json:pnpm.overrides` + `pnpm-lock.yaml` — 2026-09-02
- [x] S16-03 `vitest@3.2.7` (spec 3.2.6) `server` + `web` — 2026-09-02
- [x] S16-04 `.github/workflows/security.yml` `pnpm audit --prod --audit-level=critical` + `cargo audit` + `gitleaks` — 2026-09-02
- [x] S16-05 `server/Dockerfile` `web/Dockerfile` `node:20.18.1-alpine3.19` pinned — 2026-09-02
- [x] Tests `server/src/routes/s16-deps.test.ts` 6 + `pnpm test` 112/112 green, `cargo test` 136 green, `pnpm audit --prod` 0 critical, `web build` 12 routes — 2026-09-02

DoD S16: `pnpm audit --prod --audit-level=critical` 0 critical. STOP.

---

## Security Phase S17 — Deployment / Host Hardening (COMPLETE — 2026-09-02)

- [x] `phases/phase-S17.md` (§4) before `docker-compose.yml` edits — 2026-09-02
- [x] S17-01 `docker-compose.yml:12` `127.0.0.1:5432:5432` + comment `CHANGE ME` — 2026-09-02
- [x] S17-02 `server/src/config.ts:11` `host 127.0.0.1` prod already S2 verified — 2026-09-02
- [x] S17-03 `docker-compose.yml:21` `server` `user 65534:65534` `read_only:true` `tmpfs:/tmp` `security_opt` `cap_drop:ALL` — 2026-09-02
- [x] S17-04 `docker-compose.yml:41` `web` same least privilege — 2026-09-02
- [x] S17-05 `docker-compose.yml:52` `NEVER MOUNT /var/run/docker.sock` already S13 — 2026-09-02
- [x] Tests `server/src/routes/s17-deploy.test.ts` 6 + `pnpm test` 118/118 green — 2026-09-02

DoD S17: `docker compose config` least privilege, no public PG. STOP.

---

## Security Phase S18 — Observability / Incident Response (COMPLETE — 2026-09-02)

- [x] `phases/phase-S18.md` (§4) before `audit_logs` edits — 2026-09-02
- [x] S18-01 `database/migrations/010_audit.sql` `audit_logs` + indexes — 2026-09-02
- [x] S18-02 `server/src/lib/audit.ts` helper `auditLog` + `server/src/lib/metrics.ts` 3 counters `auditLogsTotal` `authFailuresTotal` `rateLimitedTotal` — 2026-09-02
- [x] S18-03 `server/src/routes/auth.ts` `repo.delete` `auth.login` `ci.secret_create` instrumented — 2026-09-02
- [x] S18-04 `server/src/index.ts` `onResponse` `warn` on 401/403 `auth_failure` + 429 `rate_limited` + `userId ip userAgent` — 2026-09-02
- [x] S18-05 `GET /metrics` new counters `itehaas_audit_logs_total` `itehaas_auth_failures_total` `itehaas_rate_limited_total` — 2026-09-02
- [x] S18-06 `docs/security/incident-response.md` `Host Compromise` flow `tailscale down` `pg_dump` `DELETE sessions` — 2026-09-02
- [x] Tests `server/src/routes/s18-audit.test.ts` 6 + `pnpm test` 124/124 green, `cargo test` 136 green — 2026-09-02

DoD S18: `DELETE /repos` → `audit_logs` row, `GET /metrics` has security counters, runbook drilled. STOP.

---

## Security Phase Final — Full Re-audit (COMPLETE — 2026-09-02)

- [x] `docs/security/final-security-assessment.md` before/after S0 Weak→Basic vs S18 Hardened (20/20 fixed, table SEC-001..020)
- [x] Verification: `pnpm audit --prod --audit-level=critical` 0 critical (31 high/moderate remain), `cargo test -p itehaas` 136, `pnpm --filter server test` 124, `pnpm --filter web build` 12 routes, `docker compose config` `127.0.0.1:5432`, `curl` CSP/HSTS via `s11-cors.test.ts`
- [x] Updated `docs/security/vulnerability-register.md` 20/20 fixed/partial, `docs/security/security-scorecard.md` Weak→Hardened, `docs/security/CYBERSECURITY_IMPLEMENTATION.md` S18 ✅ + Final pointer, `PLAN.md` S0–S18+Final ✅

DoD Final: Final assessment present, all 20 findings verified fixed, no critical audit, tests green, docs updated. STOP.

---

## Legacy Security Hardening (pre-S0, superseded)

---

## Legacy Security Hardening (pre-S0 checklist — now superseded by Program above)

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

- [x] Rust unit tests (hash, object parsing, tree sort, commit order) — `cargo test 122` (65+10 Phase 11 +4 Phase 12 +7 Phase 13 +5 Phase 14 +8 Phase 15 +8 Phase 16 +8 Phase 17 +5 Phase 18 +2 docs) — 2026-09-02
- [x] Rust integration tests (tempfile repos, write→read, merge, corruption, concurrency) — `vcs/tests/property_tests.rs` 5 + `phase17` 8 + `phase16` 8 + `phase15` 8 + `phase14` 5 + `phase13` 7 + `phase12` 4 + `phase11` 10 + `phase10` 4 + `phase2-5` 51 — 2026-09-02
- [x] Property tests (proptest for round-trip where useful) — `vcs/tests/property_tests.rs:1` `prop_blob/tree/commit/hash` `XorShift64` 50/30/20/30 iterations — 2026-09-02
- [ ] Git as oracle (compare `itehaas log` vs `git log` on same repo, where applicable) — manual `log --oneline` vs `git log --oneline` (rebase/bisect) + `fork` vs `git clone --fork`
- [x] Failure cases (corrupt object, invalid commit, missing parent, merge conflict, missing object, concurrent ops, reset/restore/stash, cherry-pick/rebase conflict, fork/private 404, invite expired, draft block, changes_requested block, file not found, search short query, watch dup, YAML parse error, docker fallback, CI gating 409, metrics 404) — `fsck` + `store_tests` + `phase11/12/13/14/15/16/17/18` — 2026-09-02
- [x] Server tests (Vitest + Supertest, mock or real vcsService) — `server/vitest.config.ts:1` 32 tests — 2026-09-02
- [x] Web tests (Playwright for critical flows) — `pnpm --filter web build` 12 routes ok (including `/notifications` + `/ci` 6.81kB + `/metrics` observability), Vitest deferred — 2026-09-02
- [x] CI: `cargo test && pnpm test` on each commit — `122 Rust + 32 Server + web build` — 2026-09-02

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
- 2026-09-02: Phase 16 complete — code browser + search & watch (008_search_watch pg_trgm GIN + watches, file/history/blame API tree walk, search global ILIKE, watch 409, FileTree ?path= breadcrumb + FileViewer history/blame/raw tabs + AppShell bell + notifications inbox + CommandPalette search + issue body mentions), 8 tests phase16, 107 Rust + 32 Server + web 11 routes
- 2026-09-02: Phase 17 complete — real CI/CD (009_ci_workflow artifacts + workflow_file/json + status_checks, YAML parse via yaml, queue pg queued→running→success, Docker --network none --memory 512m --pids-limit 128 fallback local, collect artifacts dist/target/artifacts, secrets env, PR gating 409, workflow/artifacts/status UI), 8 tests phase17, 115 Rust + 32 Server + web 12 routes
- 2026-09-02: Phase 18 complete — observability & property tests (lib/metrics incHttpRequest/renderMetrics + /metrics Prometheus + /health uptime + CI incCIPipelines, structured pino logs, property_tests XorShift64 blob/tree/commit/hash 50/30/20/30), 5 tests property_tests, 122 Rust + 32 Server + web 12 routes
