# Itehaas — Attack Surface Inventory

**Date:** 2026-09-02  
**Auditor:** Principal Security Engineer  
**Methodology:** Comprehensive mapping of every external input: Source ──► Trust Level ──► Validation Controls ──► Execution Sink ──► Privilege Boundary ──► Risk Classification.

**Trust Level Legend:**
- **U (Untrusted):** Originates from remote clients, unverified network requests, or repository data.
- **S (Semi-trusted):** Authenticated user with specific repository roles (read or write).
- **T (Trusted):** Local administrator, host configuration, or internal system components.

---

## 1. HTTP Endpoint Inputs (REST API)

| Input Name / Parameter | Source | Trust | Current Validation Controls | Execution Sink | Privilege Level | Identified Security Risk |
|---|---|---|---|---|---|---|
| `POST /api/auth/register` `{ username, email, password }` | JSON Body | U | Zod schema: `min(3).max(32)` on username, regex `^[a-zA-Z0-9._-]{3,32}$`, reserved username list, email format, password length (8-128). | `argon2.hash`, PostgreSQL `INSERT INTO users` | Anonymous | User enumeration, rate limit bypass (if proxy IP collapses). |
| `POST /api/auth/login` `{ username, password }` | JSON Body | U | Zod schema: `min(3).max(128)`, username or email lookup. | `argon2.verify` (and dummy hash timing equalization), `INSERT INTO sessions` | Anonymous | Credential brute-forcing, timing attacks, account lockout DoS. |
| `itehaas_session` Cookie | Cookie Header | U | Regex: `^[0-9a-fA-F-]{36}$`, database lookup `expires_at > now()`. | Fastify `getSessionUser` middleware | Anonymous ──► Authenticated | Session hijacking, cookie manipulation. |
| `Authorization: Bearer <token>` | HTTP Header | U | Regex: `^[0-9a-fA-F-]{36}$`, database lookup. | Fastify `getSessionUser` middleware | Anonymous ──► Authenticated | Token leakage via proxy/access logs. |
| `X-CSRF-Token` / `X-XSRF-Token` | HTTP Header | U | Compared with `csrf_token` cookie or HMAC of session ID. | Fastify `csrfCheck` hook | Authenticated | **Fail-open vulnerability:** If `csrf_token` cookie is absent, check is bypassed! |
| `:owner` / `:repo` | Path Parameters | U | Regex: `^[a-zA-Z0-9._-]{1,100}$`, `validateOwnerRepo()`. | `repoPathFor()`, SQL query `WHERE u.username=$1 AND r.name=$2` | Any | Path traversal (mitigated by regex), BOLA/IDOR if authorization check is skipped. |
| `:hash` (Object or Commit) | Path Parameter | U | Regex: `^(?:[0-9a-f]{40}\|[0-9a-f]{64})$`, `validateHash()`. | `execItehaas(['cat-file', ...])`, filesystem path join | Read-Authorized | Hash collision, path confusion, DoS via missing object lookup. |
| `GET /api/repos/:owner/:repo/file/*` (Wildcard `*`) | Path Parameter | U | `isValidFilePath()`: blocks `..`, `%2e%2e`, backslashes, null bytes, `.itehaas`, `.git`. | Rust VCS tree traversal | Read-Authorized | Filesystem path escape (mitigated by tree-based resolution). |
| `branch` / `ref` | Query Parameter | U | `isValidBranchRef()`: blocks `..`, `~`, `^`, `:`, `?`, `*`, `[`, `@{`, `.lock`, leading dots. | Git ref resolution, `refs/heads/` lookup | Read-Authorized | Ref traversal, flag injection into subprocesses. |
| `POST /api/repos/:owner/:repo/objects/:hash` | Octet-Stream Body | U | Header Content-Length and Buffer length clamped to 64 MiB. Hash hex validation. | `Buffer.concat` in memory, temporary file write, rename to CAS, `itehaas verify` | Write-Authorized | **Buffer churn DoS (30GB GC allocations)**, **TOCTOU race condition (unverified object placement)**. |
| `POST /api/repos/:owner/:repo/refs/heads/*` | Path + JSON Body | U | Branch name validation, hash regex, commit validation, `isAncestor` fast-forward check. | FS write to `refs/heads/<branch>`, `.lock` file, DB advisory lock | Write-Authorized | Push race condition, non-fast-forward push bypass, lock starvation. |
| `POST /api/repos/:owner/:repo/pulls` | JSON Body | U | Zod schema: `title`, `body`, `source_branch`, `target_branch`, `source_repo`, `draft`. | PostgreSQL `INSERT INTO pull_requests` | Write-Authorized | **Fork PR broken (over-securing target repo requires `canWrite`)**. |
| `POST /api/repos/:owner/:repo/issues` | JSON Body | U | Zod schema: `title`, `body`, `labels`, `assignees`, `milestone`. | PostgreSQL `INSERT INTO issues` | Write-Authorized | **Public repo issue creation blocked for non-collaborators**. |
| `POST /api/repos/:owner/:repo/ci/run` | JSON Body | U | Zod schema: `ref`, `commit`, optional `workflow` string. | Pipeline queue insertion, Docker container spawn | Write-Authorized | Resource exhaustion via excessive job queues. |
| `POST /api/repos/:owner/:repo/ci/secrets` | JSON Body | S | Key regex: `^[A-Z_][A-Z0-9_]*$`, value length (1-5000). | `encryptSecret()` AES-256-GCM, PostgreSQL `ci_secrets` | Admin-Authorized | Secret invalidation on cookie secret rotation. |
| `PATCH /api/users/:username` `{ avatar_url, bio }` | JSON Body | S | Bio max length 160. `avatar_url` must match `^https:\/\/`. | PostgreSQL `users` table | User (Self) | Unrestricted image fetching, URL spoofing. |
| `GET /api/search?q=&type=` | Query Parameters | U | Minimum length 2, limit clamped to 50, pg_trgm GIN index. | SQL `ILIKE` query | Anonymous / Authenticated | CPU exhaustion via complex regex/wildcard trigram searches. |

---

## 2. VCS Engine & File Format Inputs (Rust Parser Sinks)

| Input Stream / Structure | Source | Trust | Parser Function / Implementation | Risk & Invariant Bounds |
|---|---|---|---|---|
| **Raw Object Streams** (Loose CAS) | Client upload / Packfiles | U | `vcs/src/object/store.rs:read_object()` | Compressed zlib bomb mitigated by `ZlibDecoder.take(64M+1)`. Header split on `0x00`, strict `type len` decimal parsing. Re-hashes canonical representation against requested ID. |
| **Tree Object Entries** | Commit trees / Directory walks | U | `vcs/src/object/mod.rs:parse_tree()` | Rejects modes outside `{100644, 100755, 40000}`. Validates UTF-8 names containing no `/` or `\0`. Rejects duplicate names. Depth capped at 100 in `tree_builder.rs:40`. |
| **Commit Headers & Messages** | VCS commit objects | U | `vcs/src/object/mod.rs:parse_commit()` | Canonical field ordering: `tree`, `parent*` (capped at 100), `author`, `committer`, empty line, `message`. Message length capped at 1 MiB. Parent timestamps validated. |
| **Annotated Tags** | VCS tag objects | U | `vcs/src/object/mod.rs:parse_tag()` | Target hash, type validation (`blob, tree, commit, tag`), tagger signature, message. |
| **Packfile Streams** (`.pack`) | HTTP remote transfer / Local pack | U | `vcs/src/pack.rs:verify_pack()` | Header check `ITEHAAS PACK v1\n`. Entry count capped at 10,000. **Vulnerability:** Unbounded vector allocation `vec![0u8; len]` based on untrusted 32-bit `len`. |
| **Working Tree Checkout Paths** | Tree objects to disk | U | `vcs/src/checkout.rs:checkout_branch()` | Ancestor traversal with `symlink_metadata` to refuse writing through symlinks. Path containment inside repository root. |
| **DAG Commit Graphs** | Merge bases, fast-forward checks, logs | U | `vcs/src/revwalk.rs`, `server/src/routes/repos.ts:isAncestor` | Step limits (2,000 steps in Fastify, 10,000 visited commits in Rust revwalk) to prevent infinite loops and cyclic graph hangs. |

---

## 3. Remote Network & Outbound Protocol Inputs

| Protocol / Target | Source | Trust | Client / Agent | Validation & SSRF Controls |
|---|---|---|---|---|
| **Remote VCS Fetch / Clone** | `git clone/fetch <url>` | U | Rust `ureq::AgentBuilder` (`vcs/src/remote/http.rs`) | Requires HTTP/HTTPS scheme and `/api/repos/<owner>/<repo>` path shape. Redirects disabled (`redirects(0)`). **Vulnerability:** `is_private_host()` allows `localhost`, enabling loopback SSRF. |
| **Remote HTTP Response Bodies** | External Itehaas servers | U | `fetch_object_http()` in `vcs/src/remote/http.rs` | 64 MiB payload size cap, timeout 30s, immediate cryptographic hash verification against expected ID. |

---

## 4. UI Content Rendering Inputs (Frontend / Browser Origin)

| Rendered Entity | Source | Trust | Rendering Component | Cross-Site Scripting (XSS) Controls |
|---|---|---|---|---|
| **README.md Content** | Blob object in repository | U | `web/components/MarkdownViewer.tsx` | Rendered via `ReactMarkdown` with `remarkGfm` and `rehype-sanitize` using `defaultSchema`. Links with `javascript:`, `data:`, and `vbscript:` protocols neutralized. |
| **Issue / PR Descriptions** | PostgreSQL text | U | Next.js Page Views | React auto-escapes string interpolation. No `dangerouslySetInnerHTML` instances present across `web/`. |
| **Avatar Images** | `users.avatar_url` | S | Next.js `<img src>` | Validated at API boundary to `^https:\/\/`. Prevents `javascript:` pseudo-protocol execution in image tags. |

---

## 5. Configuration & Environmental Inputs

| Variable / Setting | Source | Trust | Default Value | Security Risk & Handling |
|---|---|---|---|---|
| `DATABASE_URL` | Environment variable | T | `postgres://itehaas:itehaas@localhost:5432/itehaas` | In `server/src/config.ts:35`, `requireSecureSecret` halts startup in production if default password pattern is present. |
| `COOKIE_SECRET` | Environment variable | T | `dev-secret-change-me` | In `server/src/config.ts:38`, `requireSecureSecret` requires minimum 32 characters and rejects default strings in production. |
| `HOST` | Environment variable | T | `0.0.0.0` (dev) / `127.0.0.1` (prod) | Prevents unintentional exposure to public interfaces in production. |
| `ALLOWED_ORIGIN` | Environment variable | T | `https://itehaas.tailnet.ts.net` (prod) / `true` (dev) | Configured in `server/src/index.ts:54-64`. In dev mode, allows arbitrary origins with credentials. |
