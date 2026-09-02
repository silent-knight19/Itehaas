# Itehaas — Independent Security Audit Baseline (Phase S0)

**Date:** 2026-09-02  
**Auditor:** Principal Security Engineer  
**Scope:** Full repository codebase (`vcs/`, `server/`, `web/`, `database/migrations/`, `docker-compose.yml`, CI)  
**Standard:** OWASP Top 10 (2025/2021), OWASP API Security Top 10, OWASP ASVS 4.0, CWE, Rust Secure Coding Guidelines, Node.js Security Best Practices, Docker Security Benchmarks.  
**Mode:** Defensive Security Assessment (Phase S0 — Reconnaissance & Threat Modeling Only; NO application code modified).

---

## 1. Executive Summary & Codebase Snapshot

Itehaas is a dual-system modular monolith deployed on a single host (Ubuntu 24.04 / Vivobook architecture with Tailscale networking):
1. **System A — VCS Engine (`vcs/`):** Pure Rust binary (`itehaas`) providing Git-inspired content-addressable storage (CAS), loose zlib-compressed objects with 2/62 fanout, DAG history, 3-way merge, packfile support, and custom HTTP remote transport via `ureq`.
2. **System B — Web & Collaboration Platform (`server/`, `web/`, `database/`):** Fastify 4 backend (Node.js 20, TypeScript), Next.js 14 frontend (App Router, Tailwind CSS, ReactMarkdown), and PostgreSQL 16 metadata store.

### Verified Architecture & Inventory

| Subsystem | Location | Language / Tech | Primary Responsibilities |
|---|---|---|---|
| **VCS Engine** | `vcs/src/` | Rust (Edition 2021) | Object storage, DAG walking, refs, index staging, checkout, diff, merge, packfiles, HTTP remote clone/fetch/push. |
| **Backend API** | `server/src/` | Node.js 20, Fastify 4, TS | Authentication, route authorization, VCS process execution (`execItehaas`), repository management, issues, pull requests, CI pipeline dispatch, search, notifications. |
| **Frontend** | `web/` | Next.js 14.2.35, React 18 | Repository browsing, commit inspection, README rendering, issue/PR management, settings, CI dashboard. |
| **Database** | `database/migrations/` | PostgreSQL 16 | 10 SQL migrations (`001_init.sql` through `010_audit.sql`) managing users, sessions, repositories, members, collaboration entities, and audit logs. |
| **Deployment** | `docker-compose.yml` | Docker Compose v2 | Multi-container setup (`db`, `server`, `web`) with healthchecks and local volume mounts. |

---

## 2. Static Analysis & Test Verification

All automated tests and security scanners were run locally in an isolated, non-destructive manner:

### 1. Rust Engine (`cargo test` & `cargo clippy`)
- **Unit & Integration Tests:** Ran `cargo test` across all targets. **136 tests passed, 0 failed.**
- **Clippy Static Linting:** Ran `cargo clippy`. **0 errors, zero `unsafe` blocks** in the entire Rust codebase. Clippy reported minor stylistic/pedantic warnings (e.g. redundant `to_string` calls, argument counts), with no unhandled errors or unsafe memory operations.

### 2. Backend Server (`pnpm --filter server test`)
- **Server Test Suite:** Ran Vitest across all route and middleware tests. **124 tests in 19 test files passed, 0 failed.**

### 3. Dependency Vulnerability Audits (`pnpm audit`)
- Ran `pnpm audit --prod`:
  - **Critical:** 0
  - **High:** 13 (primarily Next.js 14.2.35 cache poisoning / SSR / redirect advisories: `GHSA-3g8h-86w9-wvmq`, `GHSA-vfv6-92ff-j949`, and transitive build packages)
  - **Moderate:** 15
  - **Low:** 3
  - *Finding:* Production dependency vulnerabilities in Next.js require a disciplined update strategy without breaking App Router compatibility.

---

## 3. Ground-Truth Source Code Inspection Findings

Our direct code inspection identified critical nuances, design discrepancies, and concrete security vulnerabilities:

### A. Authentication & Session Security
- **Argon2id Hashing:** Configured in `server/src/lib/auth.ts:6-13` with `memoryCost: 65536` (64 MiB), `timeCost: 3`, `parallelism: 1`. Strong password hashing parameters.
- **Session Tokens:** Unguessable UUID v4 session IDs stored in PostgreSQL `sessions` table. Expiration set to 30 days (`newSessionExpiry()`), verified via `expires_at > now()`.
- **Cookie Flags:** `httpOnly: true`, `sameSite: 'lax'`, `secure: process.env.NODE_ENV === 'production'`.
- **Enumeration Defense:** Generic `409` responses and timing-equalized dummy Argon2 verification in `server/src/routes/auth.ts:14-28`.
- **Account Lockout:** 5 failed attempts locks the `username:ip` pair for 15 minutes (`server/src/lib/rateLimit.ts:83`).

### B. Authorization (BOLA / Broken Object Level Authorization)
- **Central Authorization Helper:** `server/src/lib/authorize.ts:6-37` centralizes repository access decisions. Private repositories return `404 Not Found` rather than `403 Forbidden` to prevent private repository existence enumeration.
- **Fork PR Authorization Bug (Over-securing):** In `server/src/routes/pulls.ts:74`, `canWrite(meta.id, user.id)` is enforced on the target repository. This breaks legitimate open-source workflows: external contributors with forks cannot submit pull requests to upstream public repositories because they lack write permissions on the target repository!
- **Issue Creation Permission:** In `server/src/routes/issues.ts:87`, `canWrite` is required to open an issue, preventing regular users from filing issues on public repositories.

### C. CSRF Protection Fail-Open Flaw
- In `server/src/middleware/csrf.ts:20`:
  ```typescript
  if (!cookieToken) return; // no csrf cookie yet (old client), skip
  ```
  If a request does not contain a `csrf_token` cookie, the CSRF check exits immediately without validating! Any cross-origin attack scenario that triggers a request without the cookie bypasses CSRF validation entirely.
- In addition, `headerToken === cookieToken` is accepted without verifying the cryptographic HMAC signature against the active session ID (`csrfTokenForSession`).

### D. Rate Limiting & Proxy IP Collapsing (DoS Vector)
- In `server/src/lib/rateLimit.ts:9-13`:
  ```typescript
  const ip = (req.ip as string) || (req.headers['x-forwarded-for'] as string) || ...
  ```
- Fastify is configured in `server/src/index.ts:20` *without* `trustProxy: true`.
- When deployed behind a reverse proxy (Tailscale, Nginx, Caddy), `req.ip` is always `127.0.0.1`. Because `req.ip` is defined, `X-Forwarded-For` is ignored. All clients share the same IP bucket (`127.0.0.1:global`), allowing a single noisy or malicious client to lock out every user on the instance.

### E. Process Execution & Environment Isolation
- In `server/src/lib/vcs.ts:18-28`, `getAllowedEnv()` filters environment variables passed to `child_process.spawn`. Only `PATH`, `LANG`, `HOME`, `USER`, `TMPDIR`, and `SHELL` are inherited. `DATABASE_URL` and `COOKIE_SECRET` are never leaked to subprocesses.
- Spawn uses array arguments with `shell: false`. Null bytes and dangerous command flags are strictly validated before execution.

### F. Filesystem Containment & TOCTOU Race Condition
- Path containment in `server/src/lib/vcs.ts:90-137` validates that resolved paths are contained within `reposRoot` and checks for symbolic links in the directory hierarchy.
- In `vcs/src/checkout.rs:12-59`, `ensure_no_symlink_and_inside_repo` verifies each ancestor directory using `symlink_metadata` to prevent symlink traversal.
- **Race Condition in Object Upload:** In `server/src/routes/repos.ts:701-716`, when an object is uploaded, the temporary file is renamed to the final CAS destination `objects/ab/cdef` *before* running `execItehaas(['verify', hash])`. A concurrent request checking `stat.isFile()` could treat an invalid object as valid deduplication before verification completes.

### G. Resource Exhaustion & Memory Allocation
- **Buffer Concatenation Heap Churn:** In `server/src/routes/repos.ts:571-574`, the raw body parser performs `data = Buffer.concat([data, chunk])` on every chunk. For a 64 MiB upload, this creates >30 GB of transient buffer churn, causing high GC latency or Node.js OOM.
- **Packfile Unbounded Vector Allocation:** In `vcs/src/pack.rs:104-105`, an untrusted 32-bit length prefix is read from the pack header and immediately passed to `vec![0u8; len]` without an upper bound check. A malformed packfile with `len = 0xFFFFFFFF` triggers an immediate out-of-memory abort.

### H. SSRF Bypass in Remote Fetch Transport
- In `vcs/src/remote/http.rs:40-46`, `is_private_host` explicitly allows `localhost`:
  ```rust
  if lower == "localhost" || lower.starts_with("localhost:") {
      return false; // Not private!
  }
  ```
  This creates an SSRF vector allowing remote VCS fetch operations to target internal host services on the loopback interface.

### I. Secret Management & Key Derivation Coupling
- In `server/src/lib/secrets.ts:4-7`, the encryption key for `ci_secrets` is derived via SHA-256 from `config.cookieSecret`. Rotating the session cookie secret invalidates all encrypted CI secrets at rest.

---

## 4. Audit Baseline Conclusions

The core engineering of Itehaas is robust, but the application exhibits several high-impact security vulnerabilities stemming from fail-open defaults, proxy misconfiguration, and memory allocation patterns.

Prior to enabling production usage or hosting untrusted repositories, the phased remediation program must resolve these issues systematically with regression tests.
