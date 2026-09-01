# Itehaas — Usage Guide

> **Complete guide to use Itehaas VCS + Platform.** Covers CLI, API, and Web. For architecture see `docs/architecture.md`, invariants see `docs/object-model.md` + `docs/storage.md`.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Installation](#2-installation)
3. [Configuration](#3-configuration)
4. [Running — Bare Metal vs Docker](#4-running)
5. [VCS CLI — Git from Scratch](#5-vcs-cli)
6. [Server API — curl Examples](#6-server-api)
7. [Web UI — Browser Guide](#7-web-ui)
8. [Collaboration — Issues & PRs](#8-collaboration)
9. [CI/CD — Pipelines](#9-cicd)
10. [Advanced VCS — pack/gc/fsck](#10-advanced-vcs)
11. [Deployment — Single Laptop](#11-deployment)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Prerequisites

| Tool | Version | Check | Install |
|------|---------|-------|---------|
| Rust | 1.75+ (stable) | `rustc --version` | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh` |
| Node | 20 LTS | `node -v` | `brew install node@20` or `nvm` |
| pnpm | 9.x | `pnpm -v` | `corepack enable && corepack prepare pnpm@9.0.0 --activate` |
| PostgreSQL | 16 | `psql --version` | `brew install postgresql@16` or Docker (see §4) |
| Docker (optional) | 24+ | `docker --version` | `brew install --cask orbstack` or `docker` |

**Hardware:** Vivobook Ryzen 5 3500U 4c/8t 20GB recommended, but any 4GB+ dev works (single-process, no K8s).

---

## 2. Installation

```bash
git clone <your-fork>/Itehaas && cd Itehaas

# Rust VCS (binary at target/debug/itehaas)
cargo build -p itehaas
./target/debug/itehaas --help          # all commands

# Node deps (server + web + root)
pnpm install                           # reads pnpm-workspace.yaml (server, web)

# Verify builds
cargo test -p itehaas                  # 65 tests (21 store +13 p2 +10 p3 +11 p4 +6 p5 +4 p10)
pnpm --filter @itehaas/server test     # 28 tests (vitest)
pnpm --filter @itehaas/server build    # tsc → server/dist
pnpm --filter @itehaas/web build       # next build → 7 routes
```

---

## 3. Configuration

### 3.1 Environment Files

```bash
cp server/.env.example server/.env
# Edit server/.env:
DATABASE_URL=postgres://itehaas:itehaas@localhost:5432/itehaas
REPOS_ROOT=./data/repos                # or /data/repos on Vivobook NVMe
ITEHAAS_BIN=../target/debug/itehaas    # absolute or relative to server/
PORT=3001
HOST=0.0.0.0
COOKIE_SECRET=change-me-in-production   # random 32+ chars
NODE_ENV=development
```

`server/src/config.ts:7` loads `server/.env` + project `.env` + defaults. `REPOS_ROOT` is resolved absolute via `repoPathFor` (`server/src/lib/vcs.ts:24` `startsWith(root+sep)`).

### 3.2 Web Env

```bash
# web/.env.local (optional, defaults to localhost:3001)
NEXT_PUBLIC_API_URL=http://localhost:3001
```

`web/next.config.js:1` + `web/lib/api.ts:1` (`fetch credentials:include`).

---

## 4. Running

### 4.1 Bare Metal (Dev)

```bash
# Postgres
brew services start postgresql@16
createdb itehaas || true
createuser itehaas || true
psql -c "ALTER USER itehaas PASSWORD 'itehaas'"

# Migrate (creates _migrations, users, repositories, issues, pulls, stars, ci_*)
pnpm --filter @itehaas/server migrate
# or: pnpm --filter server migrate (tsx server/src/db/migrate.ts)

# Server (Fastify 3001)
pnpm --filter @itehaas/server dev       # tsx watch src/index.ts

# Web (Next.js 3000)
pnpm --filter @itehaas/web dev          # next dev -p 3000

# Check
curl http://localhost:3001/health       # {"ok":true,"version":"0.1.0"}
open http://localhost:3000              # Dashboard
```

### 4.2 Docker Compose (Prod-like)

```bash
# Build Rust binary first (mounted into server container)
cargo build -p itehaas

docker compose up --build -d            # db + server + web (docker-compose.yml:1)

# Migrates run via server container? Or host:
DATABASE_URL=postgres://itehaas:itehaas@localhost:5432/itehaas pnpm --filter server migrate

# Logs
docker compose logs -f server
docker compose logs -f db

# Down
docker compose down -v                  # -v removes pgdata volume
```

**Tiers:** Active `data/repos` on NVMe (`server/src/config.ts:12`), `pgdata` volume on NVMe, `docker compose down` keeps `data/repos` on host unless removed.

---

## 5. VCS CLI

Binary `itehaas` (`vcs/src/main.rs:22`). All commands `cargo run -p itehaas -- <cmd> --help`.

### 5.1 Init & Identity

```bash
itehaas init /tmp/demo
itehaas init --algo sha256 /tmp/demo --force   # one repo = one algo (object-model.md)

itehaas config user.name "Your Name"
itehaas config user.email "you@example.com"
itehaas config                                # show all
cat /tmp/demo/.itehaas/config                 # [core] hasher, [user], [remote]
cat /tmp/demo/.itehaas/HEAD                   # ref: refs/heads/main
```

### 5.2 Hash & Store (Phase 1)

```bash
printf 'hello' | itehaas hash-object -w --stdin        # 8aec4e…
itehaas cat-file -p 8aec4e…                            # hello
itehaas cat-file -t 8aec4e…                            # blob
itehaas cat-file -s 8aec4e…                            # 5
itehaas verify 8aec4e…                                 # ok
# Blob hash = SHA256("blob 5\x00hello") — verify via python zlib on .itehaas/objects/8a/...
```

### 5.3 Staging & Commit (Phase 2)

```bash
cd /tmp/demo
echo "hello" > hello.txt
itehaas add hello.txt          # hash blob, update .itehaas/index (JSON BTreeMap)
itehaas add .                  # recurse, handle deletions, ignore .itehaas
itehaas status                 # staged / not_staged / untracked
itehaas commit -m "initial"    # build_tree → commit (tree parents author) → update refs/heads/main
itehaas log --oneline          # b1dd477 initial
itehaas log                    # full: commit hash, Author, Date, message
itehaas status                 # On branch main, clean
```

### 5.4 Branches & Checkout (Phase 3)

```bash
itehaas branch feature                 # create at HEAD
itehaas branch feature/main --force    # hierarchical
itehaas branch -d old                  # delete (not current)
itehaas checkout feature               # update HEAD + working tree + index
itehaas checkout -b new-feature        # create & switch
itehaas switch main -f                 # alias, -f force dirty
itehaas branch                         # * main, feature
cat .itehaas/HEAD                      # ref: refs/heads/main or hash (detached)
```

### 5.5 Diff & Merge (Phase 4)

```bash
echo "change" >> hello.txt
itehaas diff                           # wt vs index (unstaged) unified via similar
itehaas add hello.txt
itehaas diff --staged                  # index vs HEAD (staged)
itehaas diff feature                   # HEAD vs branch

# Merge:
itehaas checkout main
itehaas merge feature                  # Fast-forward or 3-way O/A/B or Already up to date
# Conflicts:
itehaas merge conflict-branch          # CONFLICT: fix file → add → commit (cleans MERGE_HEAD)
cat hello.txt                          # <<<<<<< HEAD ... ======= ... >>>>>>> feature
```

### 5.6 Remotes (Phase 5 — filesystem transport, http deferred)

```bash
itehaas remote add origin /tmp/origin              # [remote "origin"] url (vcs/src/config.rs:135)
itehaas remote -v                                  # origin file:///tmp/origin (fetch) (push)
itehaas remote remove origin

# Clone: copies reachable objects (commit→tree→blob→parents)
itehaas clone /tmp/origin /tmp/clone               # refs/remotes/origin/* + checkout main forced

# Fetch: bring new objects, update refs/remotes/origin/*, not working tree
itehaas fetch origin                               # Fetched 3 objects

# Push: fast-forward check via is_ancestor, --force to override
itehaas push origin main
itehaas push --force

# Pull: fetch + merge (fast-forward or 3-way)
itehaas pull origin main
```

### 5.7 Advanced (Phase 10)

```bash
itehaas count-objects                  # count: 3 loose, 0 packs
itehaas fsck                           # checked 3, ok / corrupt / missing refs
itehaas gc                             # found 1 unreachable (use --prune)
itehaas gc --prune                     # pruned 1
itehaas pack                           # ITEHAAS PACK v1 3 objects 220 → 444, verified 3
ls .itehaas/objects/pack/*.pack

# Corrupt test:
# flip byte in .itehaas/objects/ab/cdef... → itehaas verify <hash> fails CorruptObject → itehaas fsck reports corrupt deflate stream
```

---

## 6. Server API

Base `http://localhost:3001`, cookies `itehaas_session` `httpOnly SameSite=lax`. All JSON, `credentials: include`. `docs/api.md:1` is contract.

### 6.1 Health

```bash
curl http://localhost:3001/health
# {"ok":true,"version":"0.1.0"}
```

### 6.2 Auth

```bash
# Register
curl -X POST http://localhost:3001/api/auth/register -H 'Content-Type: application/json' \
  -d '{"username":"alice","email":"alice@example.com","password":"longenough123"}' -i
# → 201 + Set-Cookie: itehaas_session=... (argon2id server/src/lib/auth.ts:4)

# Login (username OR email)
curl -X POST http://localhost:3001/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"longenough123"}' -c cookies.txt -b cookies.txt

# Me
curl http://localhost:3001/api/auth/me -b cookies.txt
# {"user":{"id":"...","username":"alice"}}

# Logout
curl -X POST http://localhost:3001/api/auth/logout -b cookies.txt
```

Errors `400` (zod), `401` (no cookie), `409` (username taken).

### 6.3 Repos

```bash
# List (public + yours)
curl http://localhost:3001/api/repos -b cookies.txt
curl "http://localhost:3001/api/repos?limit=10&offset=0" -b cookies.txt

# Create (transaction + execItehaas init)
curl -X POST http://localhost:3001/api/repos -H 'Content-Type: application/json' -b cookies.txt \
  -d '{"name":"demo","description":"my first","visibility":"private"}'
# → 201 + ls data/repos/alice/demo/.itehaas

# Get (404 masked for private without read)
curl http://localhost:3001/api/repos/alice/demo -b cookies.txt

# Patch (admin only)
curl -X PATCH http://localhost:3001/api/repos/alice/demo -H 'Content-Type: application/json' -b cookies.txt \
  -d '{"visibility":"public","description":"updated"}'

# Delete (owner only)
curl -X DELETE http://localhost:3001/api/repos/alice/demo -b cookies.txt
```

### 6.4 Browsing (via VCS spawn)

```bash
curl http://localhost:3001/api/repos/alice/demo/branches -b cookies.txt
# {"branches":["main","feature"]}

curl http://localhost:3001/api/repos/alice/demo/log -b cookies.txt
# {"commits":[{"hash":"abc123...","message":"initial"}]}  # full 64 hex now (server/src/routes/repos.ts:325)

curl http://localhost:3001/api/repos/alice/demo/tree/<64-hex> -b cookies.txt
# {"content":"... cat-file -p ..."}
```

### 6.5 Members & Permissions

```bash
# Members (read|write|admin, canRead/canWrite/isAdmin server/src/lib/permissions.ts:4)
curl http://localhost:3001/api/repos/alice/demo/members -b cookies.txt

# Add
curl -X POST http://localhost:3001/api/repos/alice/demo/members -H 'Content-Type: application/json' -b cookies.txt \
  -d '{"username":"bob","role":"write"}'   # 201, 409 already member, 403 not admin

# Patch role
curl -X PATCH http://localhost:3001/api/repos/alice/demo/members/bob -H 'Content-Type: application/json' -b cookies.txt \
  -d '{"role":"admin"}'

# Remove
curl -X DELETE http://localhost:3001/api/repos/alice/demo/members/bob -b cookies.txt
```

### 6.6 Remotes (server delegates to itehaas)

```bash
curl http://localhost:3001/api/repos/alice/demo/remotes -b cookies.txt
curl -X POST http://localhost:3001/api/repos/alice/demo/remotes -H 'Content-Type: application/json' -b cookies.txt \
  -d '{"name":"origin","url":"/tmp/origin"}'
curl -X POST http://localhost:3001/api/repos/alice/demo/fetch -H 'Content-Type: application/json' -b cookies.txt \
  -d '{"remote":"origin"}'
curl -X POST http://localhost:3001/api/repos/alice/demo/push -H 'Content-Type: application/json' -b cookies.txt \
  -d '{"remote":"origin","branch":"main"}'          # 409 non-fast-forward
curl -X POST http://localhost:3001/api/repos/alice/demo/push -H 'Content-Type: application/json' -b cookies.txt \
  -d '{"remote":"origin","force":true}'
```

---

## 7. Web UI

Open `http://localhost:3000` (Next.js `web/app/layout.tsx:1`).

| Page | URL | What it does |
|------|-----|--------------|
| **Dashboard** | `/` `web/app/page.tsx:1` | `GET /api/repos` list, create repo form `POST /api/repos`, sign-in status `GET /me` |
| **Login** | `/login` `web/app/login/page.tsx:1` | `POST /api/auth/login`, push `/` |
| **Register** | `/register` | `POST /api/auth/register` |
| **Code** | `/:owner/:repo` `web/app/[owner]/[repo]/page.tsx:1` | `getRepo` + `branches` + `log` (full hash) → `tree` → entries `mode hash name` → `view` blob, README via `react-markdown`, star `POST /star`, settings `PATCH` visibility, tabs to issues/pulls/ci |
| **Issues** | `/:owner/:repo/issues` | `GET/POST /issues`, `GET/POST /issues/:id/comments` |
| **Pulls** | `/:owner/:repo/pulls` | branches via `GET /branches`, `POST /pulls` `source→target`, `GET /pulls/:id/diff` `execItehaas diff`, `POST /pulls/:id/merge` |
| **CI** | `/:owner/:repo/ci` `web/app/[owner]/[repo]/ci/page.tsx:1` | `GET /ci/pipelines` poll 5s, `POST /ci/run` queued→logs, `GET /ci/pipelines/:id` jobs |

**Tip:** Login first, then dashboard shows private repos. File viewer needs a commit — push via CLI or API, then `log` shows `abc123` and `Files` lists.

---

## 8. Collaboration

### 8.1 Issues

- Create: `POST /api/repos/:owner/:repo/issues {title,body}` (`database/migrations/002_collaboration.sql:5`).
- List: `GET /issues?status=open`.
- Close: `PATCH /issues/:id {status:"closed"}` (author or `canWrite`).
- Comments: `POST /issues/:id/comments {body}` (docs `docs/collaboration.md:1`).

Web: `/:owner/:repo/issues` → New Issue → Comments.

### 8.2 Pull Requests

- Create: `POST /api/repos/:owner/:repo/pulls {title, source_branch, target_branch}` verifies branches via `execItehaas branch` (`server/src/routes/pulls.ts:1`).
- Diff: `GET /pulls/:id/diff` invokes `itehaas diff <source>` while on `target`.
- Merge: `POST /pulls/:id/merge` (`canWrite`) → `checkout target` → `execItehaas merge source` (3-way `vcs/src/merge.rs:400`) → `status merged` or `409 conflict` → resolve via CLI `fix → add → commit` then merge again.
- Comments: `POST /pulls/:id/comments`.

Web: `/:owner/:repo/pulls` → Create PR → Diff → Merge.

### 8.3 Stars & Activity

- Star: `POST /api/repos/:owner/:repo/star` (toggle) + `GET /stars` count (`server/src/routes/stars.ts:1`).
- Notifications: `GET /api/notifications` on `pr_open`, `POST /notifications/:id/read`.
- Activity: `GET /api/activity/:owner/:repo` shows `issue_open|pr_open|pr_merge|star`.

---

## 9. CI/CD

**Model:** In-memory + Postgres `ci_pipelines|jobs` (`database/migrations/003_ci.sql:1`), simulated runner `execItehaas log` (`server/src/routes/ci.ts:30`), `docker --network none` deferred (`docs/ci.md:18`).

```bash
# Trigger
curl -X POST http://localhost:3001/api/repos/alice/demo/ci/run -H 'Content-Type: application/json' -b cookies.txt \
  -d '{"ref":"main"}'  # → 201 {pipeline: {id, status: queued}}

# Poll
curl http://localhost:3001/api/repos/alice/demo/ci/pipelines -b cookies.txt
curl http://localhost:3001/api/repos/alice/demo/ci/pipelines/<id> -b cookies.txt
curl http://localhost:3001/api/repos/alice/demo/ci/jobs/<jobId>/logs -b cookies.txt
# jobs: install|test|build → logs "+ itehaas log ... CI simulated: ok" → status success|failed
```

Web: `/:owner/:repo/ci` → Run Pipeline → list queued→running→success → view logs per job.

Secrets: `GET/POST /api/repos/:owner/:repo/ci/secrets` admin-only.

---

## 10. Advanced VCS

```bash
# Integrity
itehaas fsck                 # checked 3, ok / corrupt deflate stream / missing refs + unreachable count
itehaas count-objects        # count: 3 loose, 0 packs

# Pack (simple, no delta yet — future xdelta)
itehaas pack                 # create objects/pack/pack-<ts>.pack, verify 3 entries

# GC (BFS from refs/* + HEAD via remote::collect_reachable_objects vcs/src/gc.rs:1)
itehaas gc                   # found 1 unreachable (use --prune)
itehaas gc --prune           # pruned 1

# Create unreachable for test:
printf unreachable | itehaas hash-object -w --stdin
itehaas fsck                 # unreachable: 1
```

See `docs/vcs-advanced.md:1` + `vcs/tests/phase10_tests.rs:1` (4 tests).

---

## 11. Deployment

- **Bare metal:** `cargo run -p itehaas` + `pnpm dev` (`server :3001`, `web :3000`) + `brew postgresql@16`.
- **Compose:** `cargo build -p itehaas && docker compose up --build -d` → health `GET /health`.
- **Storage:** `data/repos` on NVMe, `pgdata` volume, HDD for backups (`docs/storage.md:62`).
- **Remote:** Tailscale (or Headscale) no port-forward, replaceable.
- **Env:** `COOKIE_SECRET` random, `DATABASE_URL` strong password, `ITEHAAS_BIN` absolute.

---

## 12. Troubleshooting

| Symptom | Fix |
|---------|-----|
| `role "itehaas" does not exist` | `psql -c "CREATE USER itehaas PASSWORD 'itehaas'"` + `createdb itehaas -O itehaas` or `docker compose up db` |
| `not a repository` | `find . -name .itehaas` or `itehaas init` in repo root; server `REPOS_ROOT` must contain `owner/repo/.itehaas` |
| `invalid hash` 400 | hash must `^[0-9a-f]{64}$` (SHA256). `log` now full 64 (server `full=1`), short 7 not accepted for `tree/:hash` |
| `path traversal not allowed` | `repoPathFor` `startsWith(root+sep)` (`server/src/lib/vcs.ts:17`) — check `REPOS_ROOT` absolute |
| `non-fast-forward` 409 | remote is not ancestor → `POST /push {force:true}` or `itehaas push --force` |
| `port 3001 in use` | `lsof -i :3001` + `kill` or `PORT=3002 pnpm dev` |
| `argon2 native` build fail | `xcode-select --install` + `pnpm rebuild argon2` |
| `web fetch 401` | login first (`Cookie: itehaas_session`), `credentials: include` |

**Logs:** `cargo test` (65), `pnpm --filter server test` (28), `pnpm --filter web build` (7 routes), `itehaas fsck`.

---

**References:** `PLAN.md` (165 tasks), `docs/architecture.md` (full system), `docs/api.md` `docs/database.md` `docs/security.md` `docs/web.md` `docs/collaboration.md` `docs/ci.md` `docs/vcs-advanced.md` `docs/object-model.md` `docs/storage.md`.
