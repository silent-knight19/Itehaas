# Itehaas — Architecture

> **Source of truth for system design.** Implementation follows this document. If code and doc diverge, fix the code. Covers all phases 0–10 (VCS + Platform).

---

## 1. Vision & Goals

**Itehaas** is a **Git-inspired distributed VCS (Rust)** + **GitHub-like platform (Fastify/Next.js/Postgres)** built **from first principles** to understand every layer: content-addressable storage, DAG history, staging, branching, three-way merge, remote sync, and collaboration. Not a superficial clone — a learning system.

Two systems, one machine (Vivobook Ryzen 5 3500U 4c/8t 20 GB RAM 512 GB NVMe + 1 TB HDD, Ubuntu Server 24.04.3 LTS, ext4, Tailscale):

- **System A — VCS Engine (`itehaas` binary, Rust)** — authoritative repo truth on filesystem (`.itehaas/objects`). Deterministic, language-independent object format, `cargo test` green per phase.
- **System B — Platform (Node.js/TypeScript, Fastify + Next.js + PostgreSQL)** — auth, repo metadata, browsing, issues/PRs, stars, CI. Never duplicates VCS logic or stores file content in Postgres.

Core principles: `Understand first, implement second` → `Correctness → Understanding → Testability → Maintainability → Performance → Scale` (`PLAN.md:14`).

---

## 2. High-Level Architecture

```
                  Browser :3000
                     │
                     ▼
               Next.js 14 (App Router, Tailwind, react-markdown)
                     │  fetch credentials: include
                     │  NEXT_PUBLIC_API_URL=http://localhost:3001
                     ▼
               Fastify 4 :3001 (TypeScript)
                     ├── pg pool (max 10) ──→ PostgreSQL 16 :5432 (metadata only)
                     │                              users | repositories | repository_members
                     │                              sessions | issues | pull_requests
                     │                              stars | notifications | activity
                     │                              ci_pipelines | ci_jobs | ci_secrets
                     │
                     └── spawn("itehaas", args, {cwd}) ──→ Rust binary `itehaas`
                                                             │
                                                             ▼
                                                        .itehaas/objects (CAS, zlib, fanout 2/62)
                                                        .itehaas/refs/heads/*  HEAD  index (JSON)
```

**Monorepo, modular monolith** (`vcs/` Rust, `server/` Fastify, `web/` Next.js, `database/migrations/`, `docs/`, `data/repos/` for hot FS repos, `docker-compose.yml` optional). No K8s/Kafka/ES on a single laptop.

**Deployment two modes:**

- **Bare metal (dev):** `cargo build -p itehaas` + `pnpm --filter server dev` + `pnpm --filter web dev` + `brew services start postgresql@16`
- **Compose (prod-like):** `docker compose up` (`docker-compose.yml:1` `db: postgres:16-alpine` `pgdata` + `server` Node dist + `web` Next + `target/debug/itehaas` mounted as `/usr/local/bin/itehaas` + `REPOS_ROOT=/data/repos`)

**Storage tiering:** NVMe (active `.itehaas/objects`, PG data/WAL), HDD (pg_basebackup, cold packs) — policy, not code (`docs/storage.md:62`).

---

## 3. Monorepo Layout

```
.
  ├── vcs/                         # Rust VCS engine (crate `itehaas`, lib `itehaas_lib`)
 │   ├── Cargo.toml               # sha2 0.10, flate2, clap 4.5, hex, tempfile, serde, walkdir, similar, ureq 2.9 {json,tls}
 │   ├── src/
 │   │   ├── lib.rs:21            # find_repo (upwards), init/init_force
 │   │   ├── hash.rs:1            # Hasher trait, Hash, Sha256Hasher, new_hasher
 │   │   ├── object/              # Blob, Tree, Commit, Tag, store (CAS), mod (framing)
 │   │   ├── index.rs:1           # Index BTreeMap JSON atomic
 │   │   ├── refs.rs:7            # Head::{Ref,Detached,Unborn}, read_head/write_head, branches
 │   │   ├── checkout.rs:1        # flatten_tree + working tree sync + index
 │   │   ├── tree_builder.rs:1    # build_tree_from_index, flatten_tree_root
 │   │   ├── status.rs:40         # staged/not_staged/untracked
 │   │   ├── diff.rs:1            # wt vs index vs HEAD, unified via similar
 │   │   ├── merge.rs:30          # BFS ancestors, is_ancestor, FF, 3-way O/A/B, MERGE_HEAD
 │   │   ├── remote.rs:10         # resolve_remote_path (+is_http_url), collect_reachable_objects, transfer_objects, list_remote_refs
 │   │   ├── remote/http.rs:1     # HTTP transport: validate_http_base, fetch_refs_http, fetch_object_http, download_recursive_http
 │   │   ├── config.rs:1          # hasher + user + [remote "name"]
 │   │   ├── fsck.rs:1            # scan loose, verify, missing refs, unreachable
 │   │   ├── gc.rs:1              # reachable BFS + prune
 │   │   ├── pack.rs:1            # ITEHAAS PACK v1, create/verify/list
 │   │   └── main.rs:22           # clap CLI init/hash-object/cat-file/verify/add/commit/status/log/config/branch/checkout/diff/merge/remote/clone(fetch http→cmd_clone_http)/fetch/push/pull/fsck/gc/pack/count-objects
│   └── tests/                   # store_tests 21, phase2 13, phase3 10, phase4 11, phase5 6, phase10 4 (65 total)
├── server/                      # Fastify API
│   ├── package.json:1           # fastify 4.28, @fastify/cookie, cors, pg 8.12, argon2 0.31, zod 3.23, uuid
│   ├── tsconfig.json:1          # ES2022 commonjs
│   ├── vitest.config.ts:1       # node, 28 tests
│   ├── src/
│   │   ├── config.ts:7          # DATABASE_URL, REPOS_ROOT (data/repos), ITEHAAS_BIN, COOKIE_SECRET
│   │   ├── db/index.ts:4        # Pool max10, query, getClient
│   │   ├── db/migrate.ts:10     # resolves database/migrations, _migrations table, transaction
 │   │   ├── lib/auth.ts:4        # argon2id, validateUsername/Password/Email, sessionCookieName
 │   │   ├── lib/vcs.ts:33        # repoPathFor (startsWith(root+sep)), execItehaas spawn 30s 1MiB cap, validateHash
 │   │   ├── lib/permissions.ts:4 # canRead/canWrite/isAdmin (owner or role)
 │   │   ├── middleware/auth.ts:15# getSessionUser (+Bearer) /requireAuth/cleanupExpiredSessions
 │   │   ├── routes/auth.ts:7     # POST register/login/logout, GET me (argon2, httpOnly SameSite=lax)
 │   │   ├── routes/repos.ts:11   # POST/GET/PATCH/DELETE repos, GET branches/log/tree/refs/objects/:hash, POST fetch/push/pull, remotes
 │   │   ├── routes/issues.ts:1   # CRUD + comments
 │   │   ├── routes/pulls.ts:1    # create, diff, merge via execItehaas merge
 │   │   ├── routes/stars.ts:1    # star/unstar, notifications, activity
 │   │   ├── routes/ci.ts:1       # POST run, GET pipelines/jobs/logs, secrets
│   │   └── index.ts:8           # Fastify buildApp, register all routes, health
│   └── Dockerfile:1             # node:20 builder → dist
├── web/                         # Next.js 14
│   ├── package.json:1           # next 14.2.5, react 18, tailwind 3.4, react-markdown
│   ├── tailwind.config.ts:1     # brand 500 #6d28d9
│   ├── app/
│   │   ├── layout.tsx:1         # header nav, footer
│   │   ├── page.tsx:1           # Dashboard GET /api/repos, create POST /api/repos
│   │   ├── login/page.tsx:1     # POST /api/auth/login
│   │   ├── register/page.tsx:1  # POST /api/auth/register
│   │   └── [owner]/[repo]/
│   │       ├── page.tsx:1       # code browser: branches/log/tree, README markdown, star, settings PATCH, tabs
│   │       ├── issues/page.tsx:1# POST/GET issues, comments
│   │       ├── pulls/page.tsx:1 # POST pulls, diff, merge
│   │       └── ci/page.tsx:1    # pipelines, trigger, logs
│   └── lib/api.ts:1             # fetch credentials:include, Api.* wrappers
├── database/migrations/
│   ├── 001_init.sql:6           # users, repositories, repository_members, sessions, _migrations
│   ├── 002_collaboration.sql:1  # issues, pull_requests, stars, notifications, activity
│   └── 003_ci.sql:1             # ci_pipelines, ci_jobs, ci_secrets
├── docs/                        # object-model.md, storage.md, architecture.md (this), api.md, database.md, security.md, web.md, collaboration.md, ci.md, vcs-advanced.md
├── data/repos/.gitkeep          # hot repos root (REPOS_ROOT)
└── docker-compose.yml:1         # db + server + web
```

---

## 4. System A — VCS Engine (Rust)

### 4.1 Hashing & Invariant

- One repo = one algo (`Sha256`). Recorded at `init` as `[core] hasher=sha256` (`vcs/src/config.rs:9`). `HashAlgo::from_str` validates, `new_hasher` trait factory (`vcs/src/hash.rs:90`), mismatch `HashAlgoMismatch`.
- Future `SHA1/BLAKE3` behind same `Hasher` (no store rewrite). Fanout always `2` hex chars.

### 4.2 Object Model (canonical, language-independent `docs/object-model.md:5`)

```
ObjectID = H(canonical_header || 0x00 || canonical_body)
Stored   = zlib(header || 0x00 || body)   // hashing on uncompressed only
header   = "<type> <len>"  type∈{blob,tree,commit,tag}
```

- **Blob** `body=raw` (`vcs/src/object/blob.rs:3`)
- **Tree** `body=concat(entries sorted name bytewise)` entry `"<mode> <name>\0<hash_raw>"` mode `100644|100755|40000`, name no `/\0`, hash raw 32B (`vcs/src/object/tree.rs:54`), duplicates forbidden.
- **Commit** `tree`, `parent*`, `author <name> <email> <timestamp> <tz>` (`±HHMM`), `committer`, blank, message (`vcs/src/object/commit.rs:33`). Strict field order.
- Determinism: LF only, sorted, hex lowercase in text bodies, raw bytes in tree.

### 4.3 Storage (CAS `vcs/src/object/store.rs:30`)

```
Path = objects/ab/cdef...  (2/62 for SHA256)
Write = tempfile→rename atomic (mkdir fanout), dedup no error, 64 MiB limit
Read  = resolve path → zlib decode → split at \0 → header parse → len check → re-hash verify → CorruptObject on mismatch
```

`docs/storage.md:5` NVMe/HDD tiering policy.

### 4.4 Index & Workflow (Phase 2)

- `.itehaas/index` JSON `BTreeMap` `version:1` `should_ignore` `.itehaas|.git` (`vcs/src/index.rs:1`), atomic save.
- `Working Tree → add (hash blob, update index, walkdir, deletions) → Index → commit (build_tree_from_index → Commit → update ref)` (`vcs/src/main.rs:432` `cmd_add`, `vcs/src/main.rs:548` `cmd_commit`, `vcs/src/tree_builder.rs:1`).
- `status` (`vcs/src/status.rs:40`) compares `HEAD tree (flatten)` vs `index` vs `wt`, `log` first-parent walk (`vcs/src/main.rs:702`).

### 4.5 Refs & Branches (Phase 3)

- `HEAD` symbolic `ref: refs/heads/main` vs detached hash vs unborn (`vcs/src/refs.rs:7`), `list_branches` walk `refs/heads/*`, `validate_branch_name` hierarchical, `checkout` (`vcs/src/checkout.rs:1`) flattens target tree, deletes missing, writes files, syncs index, dirty check, `-f`.

### 4.6 Diff & Merge (Phase 4)

- `diff` (`vcs/src/diff.rs:1`) `wt vs index`, `--staged` `index vs HEAD`, `HEAD vs branch` via `similar` unified.
- `merge` (`vcs/src/merge.rs:30`) BFS ancestors, `is_ancestor` (NotFound→false), FF `update ref + checkout`, `already_up_to_date`, 3-way `O/A/B` (`A==B→A`, `A==O→B`, `B==O→A` else conflict `<<<<<<<`), binary handling, `MERGE_HEAD` + `MERGE_MSG` (`vcs/src/main.rs:1214`).

### 4.7 Remotes (Phase 5 + HTTP Clone v1)

- Config `config.rs:135` `[remote "origin"] url` — filesystem path `file://` **or** `http(s)://host/api/repos/<owner>/<repo>` (strict). Stored verbatim as `[remote "origin"] url = ...`.
- **Filesystem transport** `remote.rs:19` `resolve_remote_path` (file:// strip, `canonicalize`, `is_http_url` branch), `collect_reachable_objects` (commit→tree→blob→parents BFS, `HashSet` dedup, depth `>2048` guard, `100k` object cap), `transfer_objects` (copy missing `objects/ab/cdef` via `fs::copy`, algo mismatch hard fail, atomic `create_dir_all`), `list_remote_refs` walk `refs/heads/*` sorted. CLI `remote -v`, `clone` (`init` dest + `transfer_objects` each head + `refs/remotes/origin/*` + `checkout_branch_forced`), `fetch` (update `refs/remotes`), `push` FF `is_ancestor` `--force`, `pull = fetch + merge` (`vcs/src/main.rs:1311` + dispatch `is_http_url`).
- **HTTP transport (clone-only v1, cross-device)** `vcs/Cargo.toml: ureq 2.9 {json,tls}`, `vcs/src/remote/http.rs`:
  - `validate_http_base` strict `http(s)://host/api/repos/<owner>/<repo>` (reject `..`, `.`, null, spaces, `?query` tokens → 400), no SSRF to arbitrary hosts.
  - `fetch_refs_http` `GET {base}/refs` (TLS verified, `ITEHAAS_TOKEN`/`ITEHAAS_SESSION` env → `Authorization: Bearer` + `Cookie: itehaas_session`), parses `{refs:[{name,hash}], head, hasher}`, validates `64hex` + branch regex, 401/403→ auth hint, 404→ not found (redacted URL).
  - `fetch_object_http` `GET {base}/objects/{hash}` (check `Content-Length ≤64 MiB`, stream to `Vec`, `64 MiB` cap, `X-Content-Type-Options: nosniff` expected, `application/octet-stream`), atomic `NamedTempFile::new_in(dir)→persist`, immediate `store::read_object` verify (header`\0`body, len, re-hash).
  - `download_recursive_http` BFS with `visited` dedup, `MAX_DEPTH 2048`, `MAX_OBJECTS 100k`, parses `Commit→tree+parents`, `Tree→entries` (mode `040000` subtree else blob), shared `visited` across heads.
  - `cmd_clone_http` `vcs/src/main.rs:1411` derives `dest` (basename), `fs::create_dir_all`, `fetch_refs_http`, `HashAlgo::from_str(hasher)`, `itehaas_lib::init(dest,algo)`, `add_remote(origin,httpUrl)`, loop `download_recursive_http` + `write_ref(remotes/origin/branch)`, `write_ref(head)` + `write_head_ref` + `checkout_branch_forced`, `visited.len()` count, cleanup `remove_dir_all(dest)` on any error (no partial clone), `redact_url` for logs (never print token).
  - Server side `server/src/routes/repos.ts:303` `GET /refs` + `347` `GET /objects/:hash` with `canRead` 404-mask, `validateOwnerRepo` + `HASH_REGEX`, `repoPathFor` traversal guard, `fs.createReadStream` streaming, `64 MiB` 413, `Cache-Control: immutable`, `Authorization: Bearer` fallback in `server/src/middleware/auth.ts:13` (UUID `36` check + `expires_at>now()`).
- Empty remote: `refs: []` → init empty, `add_remote`, `Cloned empty`.

### 4.8 Advanced (Phase 10)

- **Pack** `vcs/src/pack.rs:1` `ITEHAAS PACK v1` (count + entries `hex+len+zlib`), `itehaas pack` create+verify.
- **GC** `vcs/src/gc.rs:1` reachable via `collect_reachable_objects` from `refs/*`+`HEAD`, `itehaas gc --prune` deletes unreachable loose.
- **Fsck** `vcs/src/fsck.rs:1` scans loose, `verify_object`, missing refs, unreachable; `itehaas fsck|count-objects`.
- Tests `vcs/tests/phase10_tests.rs:1` 4 tests.

### 4.9 CLI (`vcs/src/main.rs:22`)

```
init hash-object cat-file verify add commit status log config branch checkout switch diff merge remote clone fetch push pull fsck gc pack count-objects
```

All `cargo test` 65 (21+13+10+11+6+4).

---

## 5. System B — Platform

### 5.1 Database (PostgreSQL 16, metadata only)

**Separation:** VCS objects never in DB; DB never stores file content (`docs/database.md:1`).

- **001_init** `users (username 32, email, password_hash)`, `repositories (owner_id FK, name 100, visibility public|private, default_branch)`, `repository_members (repo_id,user_id PK, role read|write|admin)`, `sessions (id, user_id, expires_at)`, `_migrations`, `set_updated_at()` trigger (`database/migrations/001_init.sql:6`).
- **002_collaboration** `issues`, `pull_requests` (`source_branch target_branch`), `stars`, `notifications`, `activity` (`002_collaboration.sql:1`).
- **003_ci** `ci_pipelines (ref, commit_hash 64)`, `ci_jobs (name,status,logs)`, `ci_secrets` (`003_ci.sql:1`).
- Indexes `owner`, `visibility`, `repo`, `status`, `expires_at`. All queries parameterized `$1` (`server/src/routes/*.ts`).

Migrations runner `server/src/db/migrate.ts:10` resolves `database/migrations`, creates `_migrations`, transaction per file.

### 5.2 Server (Fastify `server/src/index.ts:8`)

- **Core:** Node 20, `fastify 4 + @fastify/cookie + cors` (`origin:true credentials:true`), `pg` pool `max10` (`server/src/db/index.ts:4`), `argon2id` (`server/src/lib/auth.ts:4`), `zod` validation, `uuid`.
- **Config** `server/src/config.ts:7` `DATABASE_URL` `REPOS_ROOT=data/repos` `ITEHAAS_BIN=target/debug/itehaas` `COOKIE_SECRET`.
- **Auth** `server/src/routes/auth.ts:7` `POST register` (`username 3-32`, `email`, `password 8-128`, `23505`→409, `INSERT users` + `sessions` `+30d` `newSessionExpiry` `httpOnly SameSite=lax` `secure isProd`), `login` (`username||email`, `argon2.verify`), `logout` (`DELETE sessions`), `me` (`JOIN sessions expired check`), `middleware/auth.ts:15` `getSessionUser/requireAuth/cleanup`.
- **VCS Adapter** `server/src/lib/vcs.ts:33` `repoPathFor(owner,repo)` regex `^[a-zA-Z0-9._-]{1,100}$` + `validateRepoPath` `resolved.startsWith(root+sep)` + `\0` guard, `execItehaas` `spawn(bin,args,{cwd})` timeout 30s 1MiB cap, `validateHash` `^[0-9a-f]{64}$`, `initRepo`, `catFile`.
- **Repos** `server/src/routes/repos.ts:11` `POST /api/repos` tx `BEGIN` → `INSERT repositories` + `admin` → `COMMIT` else rollback, `mkdir` + `execItehaas init` else `DELETE`; `GET /api/repos` pagination `?limit&offset` public OR owner OR member; `GET /api/repos/:owner/:repo` `canRead` 404 mask; `PATCH` admin `visibility|description|default_branch`; `DELETE` owner `rm -rf`; `GET /branches` `execItehaas branch`, `GET /log` full hash parse (`--max-count`), `GET /tree/:hash` `cat-file -p`, `POST /fetch|push|pull` via `execItehaas` (`canWrite` for push/pull).
- **Collaboration** `issues.ts:1` `pulls.ts:1` `stars.ts:1` — issues CRUD + comments, PRs `source→target` verify branches via `execItehaas branch`, `GET /pulls/:id/diff` `execItehaas diff`, `POST /pulls/:id/merge` `checkout target; execItehaas merge source` + `vcs/src/merge.rs`, stars toggle `stars` PK, notifications on `pr_open`.
- **CI** `ci.ts:1` `POST /ci/run` (commit resolve via `log`), `INSERT ci_pipelines` + 3 jobs `install|test|build`, `setImmediate(simulateRun)` (`execItehaas log` dummy, logs capture, `queued→running→success|failed`), `GET /ci/pipelines|/:id|/jobs/:id/logs`, `secrets` admin-only.
- **Permissions** `server/src/lib/permissions.ts:4` `canRead` public→true else owner/member, `canWrite` owner or `write|admin`, `isAdmin` owner or `admin`.
- **Tests** `server/vitest.config.ts:1` 28 Vitest (vcs 6, auth 6, permissions 8, api 8), `server/src/lib/vcs.test.ts:6` etc.

**API contract** `docs/api.md:1` (health, auth, repos, branches/log/tree, members, remotes, issues, pulls, stars, ci).

### 5.3 Web (Next.js `web/app/layout.tsx:1`)

- **Stack:** `next 14.2.5 App Router` `react 18` `tailwind 3.4` `react-markdown + remarkGfm`.
- **Lib:** `web/lib/api.ts:1` `fetch credentials:include` `Api.*` (`health|me|register|login|listRepos|getRepo|branches|log|tree`).
- **Pages:**
  - `/` `web/app/page.tsx:1` dashboard `Api.me` + `listRepos`, create `POST /api/repos`.
  - `/login` `web/app/login/page.tsx:1` + `/register`.
  - `/[owner]/[repo]` `web/app/[owner]/[repo]/page.tsx:1` `getRepo/branches/log/tree` → `parseTreeHash` → entries `mode hash name` → blob view, README `react-markdown`, tabs Code/Issues/Pulls/CI, star toggle `POST /star`, settings `PATCH`.
  - `/[owner]/[repo]/issues` `web/app/[owner]/[repo]/issues/page.tsx:1` + `pulls/page.tsx:1` (`source→target` selects `GET /branches`, diff, merge).
  - `/[owner]/[repo]/ci` `web/app/[owner]/[repo]/ci/page.tsx:1` pipelines list trigger logs polling 5s.
- Build 7 routes (`pnpm --filter web build`).

---

## 6. Cross-Cutting

### 6.1 Node ↔ Rust Boundary

- **Decision ADR-007:** `spawn("itehaas", args)` CLI, not gRPC, measured before RPC (`docs/architecture.md:28`). `server/src/lib/vcs.ts:33` encapsulates, validates, timeouts, caps. Storage separation: Postgres metadata, CAS file truth.

### 6.2 Data Flows

- **VCS:** `Working Tree → add (hash blob) → Index (BTreeMap) → commit (build_tree → Commit) → Objects (CAS) → refs/HEAD`
- **Web create repo:** `POST /api/repos` (client) → `INSERT repositories` tx → `execItehaas init` → `data/repos/owner/name/.itehaas` → `201`
- **Browse:** `GET /api/repos/:owner/:repo/branches` → `execItehaas branch` → parse; `GET /log` → `execItehaas log` full hash → `GET /tree/:hash` → `cat-file -p` → tree entries → blob.
- **PR merge:** `POST /pulls` verify branches → `INSERT` → `POST /pulls/:id/merge` → `checkout target` → `merge source` (3-way) → `UPDATE pull_requests merged`.
- **CI:** `POST /ci/run` → `INSERT pipeline queued` + `jobs queued` → `setImmediate(simulateRun)` → `UPDATE running→success logs` → `GET /ci/pipelines/:id`.

### 6.3 Security (`docs/security.md:1`)

- `HASH_REGEX` `^[0-9a-f]{64}$`, `repoPathFor` `startsWith(root+sep)` + `\0`, `arg.includes('\0')`, `spawn` no shell, `zod` per route, `pg` `$1` param, `64 MiB` zlib bomb, `httpOnly SameSite=lax` `secure isProd`, `argon2id`, `ci_secrets` admin-only, `validateRepoPath` + `should_ignore` `.itehaas`.
- **HTTP clone hardening:** `validate_http_base` strict `http(s)://host/api/repos/<owner>/<repo>` (reject `..`, `.`, null, spaces, `?token` query), `owner/repo` regex + length, `hash` regex, `canRead` 404-mask for private (anon → not found), `Authorization: Bearer` or `Cookie: itehaas_session` UUID `^[0-9a-fA-F-]{36}$` + `expires_at>now()`, TLS verified (`ureq` native-tls), re-hash verify after download, atomic `tempfile→persist`, `Content-Length ≤64 MiB`, `X-Content-Type-Options: nosniff`, `Cache-Control: immutable`, `depth>2048` / `objects>100k` abort, `redact_url` (never log token), cleanup partial `dest` on failure, `ureq` 30s read/write + 10s connect timeout.

### 6.4 Performance & Concurrency

- Bounded `Tokio` 4 workers on 3500U, `pg` pool 10, `flate2` level 6, `spawn` 30s timeout 1MiB cap, no `Redis/BullMQ` until needed (Phase 9 in-mem), no `pack` delta yet (201% baseline) — measure before tune (`docs/vcs-advanced.md:30`).

### 6.5 Deployment

- `docker-compose.yml:1` `db+server+web` + `server/web/Dockerfile` `node:20` multi-stage, `REPOS_ROOT` mount, `ITEHAAS_BIN` mount, healthcheck `pg_isready`.
- NVMe hot, HDD cold, Tailscale (Headscale replaceable) — policy.

---

## 7. Decisions (ADRs `docs/decisions/`)

- **ADR-001 Rust for VCS** (systems control)
- **ADR-002 FS CAS not DB** (determinism, `object-model.md` invariant)
- **ADR-003 Postgres for metadata** (ACID, `database.md`)
- **ADR-004 Modular monolith** (single laptop)
- **ADR-005 Hash trait + SHA256 invariant** (`object-model.md`)
- **ADR-006 No bincode** (canonical format)
- **ADR-007 Process/CLI boundary** (spawn)
- **ADR-008 Ubuntu 24.04** (Vivobook)
- **ADR-009 Tailscale + NVMe/HDD tiering** (`storage.md`)

---

## 8. Future & Deferred (`PLAN.md:518`)

- Webhooks/Releases, MinIO, ES/Cassandra, K8s, OAuth, WebSockets, Prometheus — deferred until prerequisites.
- Git wire protocol (SHA1 20B adaptation), `proptest`, `Playwright` — after own protocol.
- `gRPC/IPC` only if spawn bottleneck measured.

---

## 9. Invariants & Source of Truth

- `ObjectID = H(header\0body)` on **uncompressed** (`docs/object-model.md:5`), `Stored = zlib(header\0body)`.
- One repo = one algo (`config [core] hasher`), `docs/storage.md:1` layout.
- Docs are source of truth; `PLAN.md` is living contract (165 tasks, M1–M9, `cargo test 65 + pnpm 28` green).
