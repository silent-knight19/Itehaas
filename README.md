<p align="center">
  <img src="web/public/itehaas-full.png" alt="Itehaas Logo" width="360" />
</p>

<p align="center">
  <strong>Build a Git + GitHub from scratch — understand every layer.</strong><br/>
  Rust • Content-addressable storage • Distributed • Self-hosted on a single laptop
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#roadmap">Roadmap</a> •
  <a href="PLAN.md">Master Plan</a> •
  <a href="docs/object-model.md">Object Model</a>
</p>

---

Itehaas is a **Git-inspired distributed version-control system** and **GitHub-like platform** built from first principles. The goal is not a superficial clone — it is to understand and implement the fundamental ideas behind modern VCS: content-addressable storage, DAG history, staging, branching, three-way merge, and remote synchronization — then build a self-hosted collaboration platform on top.

> **Status:** All phases 0–17 complete — self-hosted production-ready. VCS `init→blame/rebase/bisect` + HTTP `fetch/push/pull` + `SHA-1` + Web `file browsing/search/watch` + CI `YAML/Docker/artifacts/PR gating` + Platform `forks/orgs/teams/invites/review`. 117 Rust + 32 Server tests + 12 web routes green. `docker compose up` → M1–M9.

---

## Features (Phase 0 – 17)

| Area | Implemented |
|---|---|
| **Object model** | `blob` / `tree` / `commit` / `tag` — deterministic canonical serialization, `H(header\0body)` on **uncompressed** bytes, `zlib` stored, `SHA-256` via `Hasher` trait (one repo = one algo, mixed rejected), `SHA-1` repo mode `init --algo sha1` 40-char `vcs/src/hash.rs:30` |
| **Storage** | Filesystem CAS `.itehaas/objects/ab/cdef…` (`2/62` fanout), atomic `tempfile→rename`, `64 MiB` limit, `6ef19b…` empty tree, NVMe (hot) / HDD (cold) tiering |
| **Workflow** | `index` (JSON `BTreeMap`, atomic) — `Working Tree → add → Index → commit → Objects`, `commit --amend`, `stash` `refs/stash` |
| **Branching** | `refs/heads/*`, `HEAD` symbolic/unborn/detached, hierarchical `feature/sub`, `branch` list/create/delete `-a/-r/-m`, `checkout`/`switch` with working-tree + index sync, dirty check, `-f` force, `reflog` `logs/HEAD` |
| **Merge & Diff** | `diff` (wt vs index, `--staged` index vs `HEAD`, `HEAD` vs branch, unified via `similar`), common ancestor BFS, `is_ancestor`, fast-forward, `already-up-to-date`, 3-way `O/A/B` (`A==B→A`, `A==O→B`, `B==O→A` else `<<<<<<<` conflict), binary handling, `MERGE_HEAD`, `cherry-pick`/`revert` inverse diff, `rebase` `rebase-merge`, `bisect` |
| **History** | `log --all/--graph/-p/--stat/--name-only/--since/--until/--author/--grep/--follow`, `show`, `ls-files`, `for-each-ref`, `grep`, `blame` line attribution `vcs/src/blame.rs:1` |
| **Remotes** | Filesystem + HTTP own protocol `vcs/src/remote/http.rs:340` `GET /refs` + `GET/POST /objects/:hash` 64M + `POST /refs/heads/*` CAS 409/423, `remote` add/list/remove, `clone` (reachability, `refs/remotes/origin/*`), `fetch`/`push`/`pull` with `isAncestor` FF check, increments 0 vs 6 objects |
| **Server & API** | Fastify 4 + `pg` + `argon2id` + `zod`, `POST /api/auth/{register,login,logout,me}` `httpOnly SameSite=lax` 30d, `POST /api/repos` tx+`execItehaas init`, `GET/PATCH/DELETE /api/repos/:owner/:repo`, `GET /branches|log|tree/:hash|refs|objects/:hash` `canRead`, `POST /members` `read|write|admin` `getTeamPermission`, `POST /fetch|push|pull` via `execItehaas`, `repoPathFor` guard + 30s timeout, Vitest 32 |
| **Web** | Next.js 14 + Tailwind + `GeistSans/Mono`, `dashboard → list/create`, `code browser` recursive `?path=` `breadcrumb` `FileTree` `FileViewer` `history/blame/raw` `react-markdown`, `login/register`, `issues|pulls|ci|notifications|branches` tabs, `CommandPalette` `⌘K` `pg_trgm` search, `AppShell` bell inbox, 12 routes build |
| **Collaboration** | `issues` `pull_requests` `pr_comments` `stars` `notifications` `activity` (`002_collaboration.sql` + `007_review.sql` + `008_search_watch.sql`), `POST /issues|pulls` diff `execItehaas diff` merge `execItehaas merge`, star toggle, `watch` `watches` table, `search` `pg_trgm` GIN `ILIKE` |
| **Review** | `007_review.sql` `is_draft` `pr_requested_reviewers` `pr_reviews` `approved/changes_requested` `pr_review_comments` `path/line/side`, `draft` guard + `ready`, `CODEOWNERS` auto-request, `labels`/`milestones`/`assignees` + close keywords `fixes #` `UUID`/`ROW_NUMBER`, `mentions` `@user` → `notifications` |
| **Forks/Orgs** | `005_forks_orgs.sql` `organizations/teams/forks/invites` + `006_pr_fork.sql` `source_repo_id`, `POST /fork` `execItehaas clone` + `GET /forks/network`, cross-fork PR `fork/owner/branch`, `teams` `team_repositories` `getTeamPermission` |
| **CI/CD** | `003_ci.sql` `ci_pipelines|jobs|secrets` + `009_ci_workflow.sql` `ci_artifacts` `ci_status_checks` `workflow_file/json` `duration_ms` `runner`, `POST /ci/run` YAML `on: push` `jobs.steps.run` via `yaml` `queued→running→success` `executeInRunner` `docker --network none --memory 512m --pids-limit 128` fallback local, `collectArtifacts` `dist/target/artifacts`, `secrets` env, `status_checks` PR gating `409`, `GET /ci/workflows|artifacts|pr/:prId/checks`, `web/ci` 6.81kB workflow/artifacts/status |
| **Advanced VCS** | `pack` `ITEHAAS PACK v1` + `verify`, `gc` reachable BFS + `gc --prune`, `fsck` `verify_object` + `count-objects`, `itehaas fsck|gc|pack` + `vcs/tests/phase10_tests` 4 tests, `pack` streaming deferred, `SHA-1` mode |

All 0–17 runnable via `docker compose up` or `cargo + pnpm dev`.

---

## Architecture

```
Browser
  → Next.js 14 (App Router, Tailwind)
  → Fastify (TypeScript) ──→ PostgreSQL 16 (metadata only)
          │
          └─→ Rust binary `itehaas` (spawn) ──→ .itehaas/objects (CAS)
```

**Monorepo, modular monolith** (`vcs/` Rust, `server/` Fastify, `web/` Next.js, `database/migrations/`) — no K8s/Kafka/ES on a single Vivobook (Ryzen 5 3500U, 4c/8t, 20 GB, 512 GB NVMe + 1 TB HDD, Ubuntu Server 24.04, Tailscale).

Decisions in `docs/decisions/ADR-*.md`, invariants in `docs/object-model.md` + `docs/storage.md`, branching/merging in `docs/branching-and-merging.md`.

---

## Quick start — Phase 6

```bash
# Build VCS + Server
cargo build -p itehaas
./target/debug/itehaas --help
pnpm install

# DB (choose one)
docker compose up -d db          # postgres:16 pgdata (docker-compose.yml:5)
# or brew install postgresql@16 && brew services start postgresql@16
pnpm --filter server migrate      # applies database/migrations/001_init.sql + _migrations

# Server
pnpm --filter server dev          # fastify 3001 (server/src/index.ts:8)
# or pnpm --filter server build && pnpm --filter server start

# Auth (http://localhost:3001)
curl -X POST http://localhost:3001/api/auth/register -H 'Content-Type: application/json' \
  -d '{"username":"alice","email":"alice@example.com","password":"longenough123"}' -i
curl -X POST http://localhost:3001/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"longenough123"}' -c cookies.txt -b cookies.txt
curl http://localhost:3001/api/auth/me -b cookies.txt
curl http://localhost:3001/api/repos -b cookies.txt

# Create repo (DB + FS)
curl -X POST http://localhost:3001/api/repos -H 'Content-Type: application/json' -b cookies.txt \
  -d '{"name":"demo","visibility":"private"}'
ls data/repos/alice/demo/.itehaas  # VCS CAS created

# VCS quick start (same as Phase 5)
./target/debug/itehaas init /tmp/demo && cd /tmp/demo
itehaas config user.name "Your Name" && itehaas config user.email "you@example.com"
echo "hello" > hello.txt && itehaas add hello.txt && itehaas commit -m "initial"
itehaas log --oneline && itehaas branch feature && itehaas checkout feature
echo "feature" >> hello.txt && itehaas add hello.txt && itehaas commit -m "feature"
itehaas checkout main && itehaas merge feature
itehaas clone /tmp/demo /tmp/clone && cd /tmp/clone && itehaas log --oneline

# API: repo browsing via VCS
curl http://localhost:3001/api/repos/alice/demo/branches -b cookies.txt
curl http://localhost:3001/api/repos/alice/demo/log -b cookies.txt

# Tests
cargo test -p itehaas                            # 117 tests (store 21 + phase2-5 42 + phase10 4 + phase11 10 + phase12 4 + phase13 7 + phase14 5 + phase15 8 + phase16 8 + phase17 8)
pnpm --filter server test                        # 32 tests (vitest.config.ts:1)
pnpm --filter web build                          # 12 routes (including /notifications, /ci workflow)
```

---

## Object model

Central invariant:

```
ObjectID     = H(canonical_header || 0x00 || canonical_body)
Stored bytes = zlib(canonical_header || 0x00 || canonical_body)
```

Hashing **always on uncompressed** canonical bytes. See `docs/object-model.md` (source of truth) and `docs/storage.md` (layout: `.itehaas/{HEAD,config,index,objects,refs}`).

---

## Development

```bash
cargo test -p itehaas          # Rust unit + integration (117) — store + phase2-5 + phase10-17
pnpm --filter server test      # Vitest (32) server/src/lib + api (permissions, vcs, auth)
pnpm --filter server build     # tsc → dist
pnpm --filter web build        # Next 12 routes (including /notifications + /ci workflow)
cargo build -p itehaas         # binary at target/debug/itehaas
./target/debug/itehaas --help  # all commands — init, add, commit, log --graph, blame, rebase, stash, reflog, pack, etc.

# Roadmap tracking
cat PLAN.md                    # master plan, 265/240 Phase 17 complete (M1–M9 + 11–17)
cat docs/api.md && cat docs/database.md && cat docs/security.md && cat docs/remote-protocol.md
```

Phases `0` → `17` (M1 First Object → M9 Self-Hosted → Review/Files/Search/CI) are complete and runnable. Each phase `test → docs → commit` and remains `cargo test && pnpm test` green.

---

## Deployment (single laptop)

- **Bare metal (dev):** `cargo run -p itehaas` + `pnpm dev` + `brew services start postgresql@16` — no Docker.
- **Compose (prod-like):** `docker compose up` (Next.js + Fastify + Postgres + `itehaas` binary + optional runner) — `NVMe` for `.itehaas` hot, `HDD` for backups; `Tailscale` for remote access.

See `docs/deployment.md` (planned Phase 6+) and `docker-compose.yml`.

---

## Roadmap

| Phase | Description | Status |
|---|---:|---|
| 0 | Environment & Architecture | ✅ |
| 1 | Object Model & Store | ✅ |
| 2 | Index, Staging & Workflow | ✅ |
| 3 | Branches & HEAD | ✅ |
| 4 | Diff & Merge | ✅ |
| 5 | Remotes | ✅ |
| 6 | Server & API | ✅ |
| 7 | Web Platform | ✅ |
| 8 | Collaboration | ✅ |
| 9 | CI/CD | ✅ |
| 10 | Advanced VCS / Git Interop | ✅ |
| 11 | VCS Recovery & Daily-Use | ✅ |
| 12 | Remote Transport & Git Interop | ✅ |
| 13 | History & Code Archaeology | ✅ |
| 14 | Forks, Networks & Organizations | ✅ |
| 15 | Review & Developer Workflow | ✅ |
| 16 | Code Browser, Search & Notifications | ✅ |
| 17 | Real CI/CD | ✅ |

Milestones `M1` → `M9` achieved: `M6` Web repo (file browser `?path=`), `M7` PR (draft→review→merge `409`), `M8` CI (`YAML` `docker --network none` `artifacts` `PR gating`), `M9` Self-Hosted (`docker compose up` 3 services). All 0–17 runnable — `docker compose up` or `cargo + pnpm dev` on Vivobook.

---

## Security & Performance

- No `unsafe`, no shell, `hash ^[0-9a-f]{64}$` (`server/src/lib/vcs.ts:6`), `repoPathFor` `startsWith(root+sep)` (`server/src/lib/vcs.ts:17`), `argon2id` (`server/src/lib/auth.ts:4`), `httpOnly SameSite=lax` (`server/src/routes/auth.ts:42`), `zod` + `pg` param, `zlib` bomb `64MiB`.
- Bounded concurrency (`Tokio` 4 workers on 3500U, `spawn` 30s timeout + 1MiB cap `server/src/lib/vcs.ts:33`), `flate2` level `6`, `Postgres` pool 10 (`server/src/db/index.ts:4`), `docker-compose.yml:5` pgdata.
- CI runner (Phase 9) will be `docker run --network none --memory 512m --pids-limit 128`, never host exec.

---

## License

MIT — see `LICENSE`.

## Acknowledgments

Inspired by *Git* (object model, DAG, refs, index, merge) and *GitHub* (collaboration). Not a Git wrapper — the VCS is implemented from scratch in Rust to learn systems engineering.

*Built with understanding first, code second.*
