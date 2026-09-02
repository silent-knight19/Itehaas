# Itehaas — Initial Security Assessment Report (Phase S0)

**Date:** 2026-09-02  
**Auditor:** Principal Security Engineer  
**Scope:** Full repository codebase (`vcs/` Rust, `server/` Fastify/TypeScript, `web/` Next.js 14, `database/migrations/`, `docker-compose.yml`, CI)  
**Standard:** OWASP Top 10, OWASP API Security Top 10, OWASP ASVS 4.0, CWE  
**Status:** **Initial Security Assessment Complete** — No code changes implemented.

---

## 1. Executive Summary

This initial security assessment presents an independent, first-principles defensive evaluation of the actual Itehaas codebase. Itehaas demonstrates strong systems engineering principles: pure safe Rust in the custom VCS engine, content-addressable storage with fanout directories, Argon2id password hashing with robust cost parameters, timing-equalized account enumeration defenses, parameterized SQL queries, and centralized authorization helpers.

However, an in-depth source code audit revealed **concrete vulnerabilities and design flaws** that expose the platform to attack if deployed in multi-tenant or untrusted environments:
1. **CSRF Validation Fail-Open:** When the `csrf_token` cookie is absent, CSRF validation is bypassed entirely on state-changing requests (`server/src/middleware/csrf.ts:20`).
2. **Reverse Proxy Rate Limit Collapsing:** Because Fastify does not trust proxy headers, all incoming client connections collapse to `127.0.0.1`, allowing a single user to trigger instance-wide denial of service (`server/src/lib/rateLimit.ts:9`).
3. **Quadratic Buffer Churn DoS:** The octet-stream body parser repeatedly calls `Buffer.concat` on every 64 KiB chunk during 64 MiB object uploads, allocating over 32 GB of transient buffer memory (`server/src/routes/repos.ts:573`).
4. **Outbound SSRF Loopback Bypass:** The remote VCS HTTP client explicitly permits connections to `localhost` in `is_private_host()`, allowing attackers to probe internal host services (`vcs/src/remote/http.rs:43`).
5. **Packfile Heap Exhaustion:** Untrusted 32-bit entry length headers are directly passed to `vec![0u8; len]` without upper-bound validation (`vcs/src/pack.rs:105`).
6. **Object Upload TOCTOU Race Condition:** Uploaded objects are renamed into the permanent CAS storage directory *before* cryptographic hash verification completes, exposing corrupt objects to concurrent requests (`server/src/routes/repos.ts:701-716`).
7. **Broken Collaboration Authorization:** Requiring write permissions on target repositories for cross-fork pull request creation breaks the core fork-and-pull open source workflow (`server/src/routes/pulls.ts:74`).

---

## 2. Architecture Overview

Itehaas is partitioned into two distinct systems running on a single host:
- **System A (VCS Engine):** Standalone Rust binary (`itehaas`) responsible for object creation, CAS storage under `.itehaas/objects/ab/cdef`, ref management, index staging, 3-way merge, and packfile generation.
- **System B (Web & Platform):** Node.js 20 backend with Fastify 4, Next.js 14 web client, and PostgreSQL 16 database. Node.js invokes the Rust VCS binary as a subprocess via `child_process.spawn`.

---

## 3. Trust Boundaries

1. **Client / Browser ──► Fastify API:** Boundary crossed by HTTP requests. Governed by session authentication, CORS origin restrictions, CSRF double-submit tokens, and input validation schemas.
2. **Fastify ──► Filesystem & VCS Subprocess:** Boundary crossed by subprocess execution (`execItehaas`). Governed by argument allowlists, path containment (`repoPathFor`), concurrency semaphores, and minimal environment inheritance.
3. **VCS Subprocess ──► Filesystem Storage:** Boundary crossed by object and working tree operations. Governed by canonical `realpath` checks, ancestor `symlink_metadata` inspection, and atomic file replacement.
4. **Fastify / VCS ──► Outbound Remote Network:** Boundary crossed by remote clone/fetch operations. Governed by scheme verification, API path shape validation, and private IP filtering.
5. **Workflow YAML ──► CI Runner Container:** Boundary crossed by CI job dispatch. Governed by Docker container sandboxing (`--network none`, `--read-only`, `--user 65534:65534`, `--cap-drop ALL`).
6. **Repository Content ──► Browser DOM:** Boundary crossed by README Markdown rendering. Governed by `rehype-sanitize` and Content-Security-Policy (CSP) headers.

---

## 4. Key Assets

- User password hashes (`users.password_hash` with Argon2id).
- Active user session tokens (`sessions.id`).
- Private repository source code and commit history (`data/repos/{owner}/{repo}/.itehaas/`).
- CI deployment secrets (`ci_secrets.value`).
- Host operating system integrity and Docker daemon privileges.

---

## 5. Threat Actors

1. **Anonymous Remote Adversaries:** Attempting unauthorized access, resource enumeration, loopback SSRF, or denial of service.
2. **Authenticated Malicious Tenants:** Attempting horizontal privilege escalation (BOLA/IDOR), cross-user repository tampering, or rate limit exhaustion.
3. **Adversarial Repository Contributors:** Pushing malformed packfiles, cyclic DAGs, or malicious CI workflow files aimed at exfiltrating secrets or breaking out of sandboxes.

---

## 6. Attack Surface Summary

123 distinct input parameters mapped across the application, categorized into:
- REST API path, query, header, and body parameters.
- Raw octet-stream binary uploads.
- Git ref, tree, commit, tag, and packfile binary streams.
- Remote HTTP URL schemas.
- Untrusted workflow YAML configurations and container shell commands.
- User profile fields (bio, avatar URLs).

---

## 7. Critical Findings

1. **SEC-001 / SEC-002: Insecure Credential Defaults in Deployment Manifests:**
   - `docker-compose.yml` contains hardcoded credentials (`POSTGRES_PASSWORD: itehaas`, `COOKIE_SECRET: change-me-in-production`). While production execution fails closed, development environments and container defaults must enforce external environment variables.
2. **SEC-004: CSRF Double-Submit Validation Fails Open when Cookie Missing:**
   - In `server/src/middleware/csrf.ts:20`, missing `csrf_token` cookies bypass validation completely, exposing state-changing endpoints to cross-origin forgery.

---

## 8. High Findings

1. **SEC-003: Permissive CORS with Credentials in Development:**
   - `server/src/index.ts:54-64` allows `origin: true` with `credentials: true` in non-production mode, exposing local developers to cross-origin credentialed theft.
2. **SEC-005: Rate Limiting Proxy IP Collapsing (Denial of Service):**
   - Lack of `trustProxy` configuration in Fastify causes all clients behind a reverse proxy to share `127.0.0.1`, enabling instance-wide rate limit lockout.
3. **SEC-011: Over-Securing Breaks Cross-Fork Pull Request Workflow:**
   - In `server/src/routes/pulls.ts:74`, requiring `canWrite` on target repositories prevents external contributors from submitting pull requests from their forks.
4. **SEC-014: Quadratic Buffer Churn DoS in Octet-Stream Parser:**
   - Repeated `Buffer.concat` on 64 KiB chunks allocates over 32 GB of transient heap buffers for a single 64 MiB upload (`server/src/routes/repos.ts:573`).
5. **SEC-015: Unbounded Memory Allocation in Packfile Header Parsing:**
   - In `vcs/src/pack.rs:105`, an untrusted 32-bit length prefix is directly passed to `vec![0u8; len]`, causing an immediate 4 GB allocation and OOM abort on malformed packfiles.
6. **SEC-016: Outbound SSRF Bypass via `localhost` Exception:**
   - In `vcs/src/remote/http.rs:43`, `is_private_host` explicitly permits `localhost`, allowing attackers to probe internal loopback services.
7. **SEC-021: Race Condition on Unverified Object CAS Placement:**
   - Uploaded objects are moved into permanent CAS storage *before* cryptographic hash verification completes, exposing unverified objects to concurrent requests (`server/src/routes/repos.ts:701-716`).

---

## 9. Medium Findings

1. **SEC-007: CI Secrets Key Coupled to Session Cookie Secret:**
   - In `server/src/lib/secrets.ts:4`, deriving encryption keys from `COOKIE_SECRET` causes all CI secrets at rest to become unreadable upon cookie secret rotation.
2. **SEC-019: High-Severity Dependencies in Web Tier:**
   - 13 High-severity advisories exist in Next.js 14.2.35 and transitive packages (Server Component cache poisoning, redirect poisoning).

---

## 10. Low Findings

1. **SEC-018: System Information Leakage in Generic Error Handlers:**
   - Error messages returning raw system exceptions can reveal filesystem paths. Resolved via correlation ID masking in `server/src/index.ts:132-136`.
2. **SEC-020: Absence of Structured Security Audit Logging:**
   - Resolved via PostgreSQL `audit_logs` table (`010_audit.sql`) and `server/src/lib/audit.ts`.

---

## 11. Existing Controls (Verified Sound)

- **Zero Unsafe Rust:** All VCS logic is 100% safe Rust.
- **Decompression Streaming Bounds:** `vcs/src/object/store.rs` enforces `take(64M+1)` on zlib streams.
- **Path Containment:** `validateRepoPath` in TypeScript and `ensure_no_symlink_and_inside_repo` in Rust prevent traversal outside repository roots.
- **Subprocess Environment Isolation:** Subprocesses only inherit `PATH, LANG, HOME, USER, TMPDIR, SHELL`.
- **Markdown Sanitization:** `rehype-sanitize` with default schema filters malicious HTML and dangerous URI protocols.
- **SQL Injection Prevention:** 100% parameterized queries via `$1, $2` placeholders.

---

## 12. False Positives Ruled Out

- `child_process.spawn` is not vulnerable to shell injection (uses array parameters, `shell: false`).
- `ReactMarkdown` without raw HTML does not execute Stored XSS.
- Clamped SQL query limits do not constitute SQL injection.

---

## 13. Security Testing Gaps

1. Lack of concurrent multi-writer push tests verifying `.lock` acquisition under contention.
2. Lack of automated regression tests asserting that `is_private_host("localhost")` fails closed.
3. Lack of load tests verifying memory stability during concurrent 64 MiB object uploads.

---

## 14. Remediation Order (Strict Phased Plan)

- **Phase S1 — Critical Vulnerability Triage & Safe Proofs:** Formalize findings, define reproduction test cases, and establish proof-of-concept conditions.
- **Phase S2 — Authentication & Session Hardening:** Fail closed on development secrets; enforce proxy trust in Fastify.
- **Phase S3 — Authorization & Collaboration Matrix:** Fix cross-fork pull request creation; enforce proper read/write boundaries.
- **Phase S4 — Filesystem & Object Placement Safety:** Fix CAS placement race condition (verify before rename); maintain path and symlink containment.
- **Phase S5 — Subprocess & Command Execution:** Maintain strict process environment allowlists and flag validation.
- **Phase S6 — VCS Parser & Packfile Hardening:** Bound packfile length allocation (`len <= 64 MiB`) and parser recursions.
- **Phase S7 — Resource Exhaustion & Buffer Management:** Replace quadratic `Buffer.concat` with chunk arrays in octet-stream body parsing.
- **Phase S8 — Database & Secrets Isolation:** Decouple CI secret encryption keys from web cookie secrets.
- **Phase S9 — CSRF & Browser Security:** Eliminate fail-open check in CSRF middleware; strictly require double-submit tokens with HMAC verification.
- **Phase S10 — Outbound Transport & SSRF Lockdown:** Remove `localhost` exemption in `is_private_host()`.
- **Phase S11 — Dependency & Supply Chain Hardening:** Update Next.js and apply package overrides for high-severity advisories.
- **Phase S12 — Final Re-Audit & Verification:** Execute full end-to-end regression test suite.

---

## 15. Residual Risks

- CI containers share the host Linux kernel; rootless container isolation mitigates most breakout vectors, but true multi-tenant untrusted code platforms benefit from microVMs.
- In-memory rate limiting counters reset upon server restart.
