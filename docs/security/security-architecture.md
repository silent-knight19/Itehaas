# Itehaas — Security Architecture Specification

**Date:** 2026-09-02  
**Auditor:** Principal Security Engineer  
**Scope:** Security boundaries, defense-in-depth mechanisms, isolation layers, and hardening design principles.

---

## 1. System Segmentation & Boundary Separation

Itehaas enforces a strict separation of concerns between metadata management and raw content-addressable storage:

1. **Metadata Plane (Node.js & PostgreSQL):**
   - Handles authentication, access control evaluation, collaboration entities (issues, pull requests, reviews, stars), CI job queues, and security audit logging.
   - Filesystem content and raw git objects are **never stored as SQL bytea/blobs** in PostgreSQL.
   - All database communication uses parameterized queries via node-postgres (`pg`) with strictly bounded limit/offset values.

2. **Storage & VCS Engine Plane (Rust & Local Filesystem):**
   - Implements the pure cryptographic data structures of the repository DAG (`.itehaas/objects/`, `refs/`, `index`).
   - Node.js invokes the `itehaas` CLI via `child_process.spawn(bin, args, { cwd: repoPath, env: allowedEnv })`.
   - The process interface operates with a strict concurrency semaphore (max 3 concurrent subprocesses per repository), explicit 30-second timeouts, and a 1 MiB stream capture cap.

3. **Execution Sandbox Plane (Docker CI Runner):**
   - Repository workflow definitions (`.itehaas/workflows/*.yml` or `itehaas.yml`) execute inside disposable Alpine Linux containers.
   - Containers run with `--network none`, `--memory 512m`, `--pids-limit 128`, `--user 65534:65534` (nobody), `--read-only` rootfs, `--tmpfs /tmp`, and `--cap-drop ALL`.
   - Host fallback (`spawn('sh')`) is strictly disabled; if the Docker engine is unreachable, pipelines fail closed.

---

## 2. Defensive Controls Matrix

| Domain | Implemented Defensive Control | Code Reference | Robustness Evaluation |
|---|---|---|---|
| **Credential Storage** | Argon2id hashing with memory cost 64 MiB, time cost 3, parallelism 1. | `server/src/lib/auth.ts:6-13` | **Strong.** Highly resistant to GPU/ASIC offline attacks. |
| **Account Enumeration** | Uniform 409 responses and timing-equalized dummy Argon2 hash verification for non-existent users. | `server/src/routes/auth.ts:14-28` | **Strong.** Defeats timing-based user enumeration. |
| **Object Immutability** | Cryptographic hash re-verification on read, fanout storage, atomic write via temporary file rename. | `vcs/src/object/store.rs:20-50` | **Strong.** Ensures CAS integrity and prevents partially written objects. |
| **Decompression Bounds** | Streaming `take(64M + 1)` read limit on zlib decoders. | `vcs/src/object/store.rs:69` | **Strong.** Eliminates classic zip-bomb memory spikes. |
| **Path Traversal Protection** | Regex character filtering, canonical `realpath` resolution, and symlink parent inspection. | `server/src/lib/vcs.ts:90-137`, `vcs/src/checkout.rs:12-59` | **Strong.** Defeats `../`, encoded traversals, and symlink escapes. |
| **Process Environment** | Minimal environment allowlist (`PATH, LANG, HOME, USER, TMPDIR, SHELL`) on subprocess spawn. | `server/src/lib/vcs.ts:18-28` | **Strong.** Prevents inadvertent leakage of database credentials or cookie secrets. |
| **Browser Security Headers** | Fastify Helmet (CSP, HSTS, X-Frame-Options: DENY, nosniff, Referrer-Policy: no-referrer). | `server/src/index.ts:33-52`, `web/next.config.js:8-20` | **Good.** Restricts DOM embedding and script origins. |
| **Markdown Sanitization** | ReactMarkdown with rehype-sanitize (Default Schema) and dangerous URI protocol filtering. | `web/components/MarkdownViewer.tsx:39-57` | **Good.** Neutralizes Stored XSS vectors in README files. |

---

## 3. Architectural Deficiencies & Vulnerability Points

Through direct source inspection, the following architectural gaps were identified:

```
[ Problem 1: CSRF Fail-Open in csrf.ts ]
Incoming Request ──► Is cookie present? ──No──► ALLOWED! (Bypass!)
                                        ──Yes──► Validate Token

[ Problem 2: Proxy IP Collapsing in rateLimit.ts ]
Reverse Proxy (127.0.0.1) ──► Fastify (trustProxy=false)
                                     │
                                     ▼
                      req.ip = "127.0.0.1" for ALL users!
                                     │
                                     ▼
                      Global Rate Limit Locks Out Entire Site!

[ Problem 3: SSRF Bypass in http.rs ]
URL Host ──► Is "localhost"? ──Yes──► ALLOWED! (Hits loopback services!)
                             ──No──► Check RFC 1918 Private IPs
```

1. **CSRF Middleware Fail-Open (`server/src/middleware/csrf.ts:20`):**
   - Skipping token verification when `cookieToken` is undefined defeats CSRF protection for cross-site requests that omit the cookie.
2. **Reverse Proxy Rate Limit Lockout (`server/src/index.ts:20`, `server/src/lib/rateLimit.ts:8-13`):**
   - Without `trustProxy: true`, all client IPs behind a reverse proxy or Tailscale serve collapse to `127.0.0.1`, creating an immediate Denial of Service vector.
3. **SSRF Loopback Exception (`vcs/src/remote/http.rs:40-46`):**
   - Unconditional exemption of `localhost` in `is_private_host()` allows outbound VCS requests to reach internal host ports.
4. **Unbounded Packfile Allocation (`vcs/src/pack.rs:104-105`):**
   - Parsing pack entries allocates memory directly from an untrusted 32-bit integer length, exposing the engine to memory exhaustion.
5. **Repeated Buffer Concatenation in HTTP Uploads (`server/src/routes/repos.ts:571-574`):**
   - In-stream `Buffer.concat` on every payload event generates quadratic allocation overhead (30+ GB for 64 MiB payloads).
6. **Object Upload Race Condition (`server/src/routes/repos.ts:701-716`):**
   - Renaming uploaded files into permanent CAS storage before running cryptographic verification exposes corrupt objects to concurrent requests.

---

## 4. Hardening Architecture Roadmap

Subsequent security phases will reinforce the architecture according to these core guidelines:

1. **Fail Closed by Default:** All security checks (CSRF, proxy validation, configuration parsing) must deny access or abort execution if input is missing or unverified.
2. **True Ephemeral Isolation:** CI containers must receive cloned repository copies in temporary workspaces rather than bind-mounting live host storage.
3. **Independent Cryptographic Keys:** Decouple data-at-rest encryption (CI secrets) from ephemeral session credentials.
4. **Defensive Stream Parsing:** Replace chunk-by-chunk buffer concatenation with chunk arrays and pre-allocated length bounds across all parsers.
