# Itehaas — Git-inspired VCS + Code Hosting Platform

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

> **Status:** Phase 5 — Remote Repositories complete. Core VCS is runnable: `init` → `add` → `commit` → `branch` → `checkout` → `diff` → `merge` → `clone`/`fetch`/`push`/`pull`.

---

## Features (Phase 0 – 5)

| Area | Implemented |
|---|---|
| **Object model** | `blob` / `tree` / `commit` / `tag` — deterministic canonical serialization, `H(header\0body)` on **uncompressed** bytes, `zlib` stored, `SHA-256` via `Hasher` trait (one repo = one algo, mixed rejected) |
| **Storage** | Filesystem CAS `.itehaas/objects/ab/cdef…` (`2/62` fanout), atomic `tempfile→rename`, `64 MiB` limit, `6ef19b…` empty tree, NVMe (hot) / HDD (cold) tiering |
| **Workflow** | `index` (JSON `BTreeMap`, atomic) — `Working Tree → add → Index → commit → Objects` |
| **Branching** | `refs/heads/*`, `HEAD` symbolic/unborn/detached, hierarchical `feature/sub`, `branch` list/create/delete, `checkout`/`switch` with working-tree + index sync, dirty check, `-f` force |
| **Merge & Diff** | `diff` (wt vs index, `--staged` index vs `HEAD`, `HEAD` vs branch, unified via `similar`), common ancestor BFS, `is_ancestor`, fast-forward, `already-up-to-date`, 3-way `O/A/B` (`A==B→A`, `A==O→B`, `B==O→A` else `<<<<<<<` conflict), binary handling, `MERGE_HEAD` |
| **Remotes** | Filesystem own protocol (http deferred), `remote` add/list/remove, `clone` (reachability `commit→tree→blob→parents`, `refs/remotes/origin/*`, `checkout_branch_forced`), `fetch` (missing objects, `refs/remotes`), `push` (fast-forward check, `--force`), `pull` (`fetch` + `merge`) |

Coming next: **Phase 6 Server & API** (Fastify, PostgreSQL, Argon2, auth).

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

## Quick start — Phase 5

```bash
# Build
cargo build -p itehaas
./target/debug/itehaas --help

# First repository
./target/debug/itehaas init /tmp/demo
cd /tmp/demo
itehaas config user.name "Your Name"
itehaas config user.email "you@example.com"

echo "hello" > hello.txt
itehaas add hello.txt
itehaas commit -m "initial commit"
itehaas log --oneline          # 6ca86dc initial commit
itehaas status                 # On branch main, clean

# Branching
itehaas branch feature
itehaas checkout feature
echo "feature" >> hello.txt
itehaas add hello.txt
itehaas commit -m "feature"
itehaas checkout main
itehaas merge feature          # fast-forward or 3-way
itehaas log --oneline --graph  # (first-parent walk)

# Diff
echo "change" >> hello.txt
itehaas diff                   # wt vs index (unstaged)
itehaas diff --staged          # index vs HEAD (staged) — after add

# Remotes (filesystem transport)
itehaas init /tmp/origin && cd /tmp/origin && itehaas commit -m "base" --allow-empty # (use add/commit)
itehaas clone /tmp/origin /tmp/clone
cd /tmp/clone && echo "from clone" > clone.txt && itehaas add clone.txt && itehaas commit -m "clone"
itehaas push                   # fast-forward to origin
cd /tmp/origin && echo "from origin" > origin.txt && itehaas add origin.txt && itehaas commit -m "origin"
cd /tmp/clone && itehaas fetch # refs/remotes/origin/main
itehaas pull                   # fetch + merge (fast-forward or 3-way)
itehaas remote -v
itehaas branch                 # * main, feature, ...

# Low-level
echo -n hello | itehaas hash-object -w --stdin   # 8aec4e…
itehaas cat-file -p 8aec4e…                       # hello
itehaas verify 8aec4e…                            # ok
cargo test -p itehaas                            # 61 tests
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
cargo test -p itehaas          # Rust unit + integration (61)
cargo build -p itehaas         # binary at target/debug/itehaas
./target/debug/itehaas --help  # all commands

# Roadmap tracking
cat PLAN.md                    # master plan, 115/140 tasks, milestones M1–M9
cat docs/branching-and-merging.md
```

Phases `0` (architecture) → `1` (object model, M1) → `2` (index, M2) → `3` (branches, M3) → `4` (diff/merge, M4) → `5` (remotes, M5) are complete and runnable. Each phase is `test → docs → commit` and remains `cargo test` green.

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
| 6 | Server & API | ⬜ |
| 7 | Web Platform | ⬜ |
| 8 | Collaboration | ⬜ |
| 9 | CI/CD | ⬜ |
| 10 | Advanced VCS / Git Interop | ⬜ |

Milestones `M1` (first object) → `M5` (first remote: `clone`/`push`/`fetch`/`pull`) are achieved. `M6` (web repo) next.

---

## Security & Performance

- No `unsafe`, no shell interpolation, `hash` regex `^[0-9a-f]{64}$`, `refs` traversal guarded, `zlib` bomb `64 MiB` limit, path `strip_prefix` for `add`/`checkout`.
- Bounded concurrency (`Tokio` 4 workers on 3500U, `spawn` queue `8`), `flate2` level `6` (tunable), `Postgres` conservative defaults until benchmarked.
- CI runner (Phase 9) will be `docker run --network none --memory 512m --pids-limit 128`, never host exec.

---

## License

MIT — see `LICENSE`.

## Acknowledgments

Inspired by *Git* (object model, DAG, refs, index, merge) and *GitHub* (collaboration). Not a Git wrapper — the VCS is implemented from scratch in Rust to learn systems engineering.

*Built with understanding first, code second.*
