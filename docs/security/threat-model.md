# Itehaas — Comprehensive Threat Model

**Date:** 2026-09-02  
**Auditor:** Principal Security Engineer  
**Scope:** Trust boundaries, threat actors, assets, data flows, and attack vectors across VCS, Node.js API, Next.js frontend, PostgreSQL, and Docker.

---

## 1. Architectural Trust Boundaries

```
[ External Untrusted Network / Tailscale Client / Browser ]
                           │
                           │  HTTP(S) Requests (Headers, Cookies, Body, Query Params)
                           ▼
             ┌───────────────────────────┐
             │   Next.js 14 Web Tier     │  (Port 3000)
             │   App Router / SSR        │
             └─────────────┬─────────────┘
                           │  Credentials: include
                           │  JSON / Octet-stream
                           ▼
             ┌───────────────────────────┐
             │   Fastify 4 API Tier      │  (Port 3001)
             │   AuthN & AuthZ Boundary  │
             └──────┬──────────────┬─────┘
                    │              │
       SQL ($1, $2) │              │ child_process.spawn(bin, args, {env})
                    ▼              ▼
     ┌────────────────────┐   ┌───────────────────────────────┐
     │  PostgreSQL 16 DB  │   │  Rust VCS Engine (`itehaas`)  │
     │  Metadata, Secrets │   │  Object parsing, DAG, Pack    │
     └────────────────────┘   └──────────────┬────────────────┘
                                             │
                                             │ Direct Filesystem I/O
                                             ▼
                              ┌───────────────────────────────┐
                              │ Filesystem CAS (`.itehaas/`)  │
                              │ Loose objects, refs, index    │
                              └───────────────────────────────┘

[ Disconnected Trust Boundaries ]
1. Repository Content (README/Markdown) ──► Sanitizer ──► Browser DOM (XSS Boundary)
2. Workflow YAML (`itehaas.yml`) ──► CI Runner ──► Docker Container (Isolation Boundary)
3. Remote VCS URLs (`git clone/fetch`) ──► `ureq` HTTP Agent ──► External Web (SSRF Boundary)
```

---

## 2. High-Value Assets & Impact Matrix

| Asset | Sensitivity | Primary Location | Failure Modes & Impact |
|---|---|---|---|
| **User Password Hashes** | High | PostgreSQL `users.password_hash` | Offline brute-force cracking if database leaked. Mitigated by Argon2id parameters (`m=65536, t=3, p=1`). |
| **Session Identifiers** | High | PostgreSQL `sessions.id`, HTTP Cookies | Session hijacking, impersonation of repository owners and admins. |
| **Private Repository Objects** | High | Host Filesystem `data/repos/{owner}/{repo}/.itehaas/objects/` | Unauthorized access to proprietary code, intellectual property theft via BOLA/IDOR or path traversal. |
| **CI Secrets** | Critical | PostgreSQL `ci_secrets.value`, Container Environment | Exposure of cloud deployment credentials, API tokens, and signing keys via logs, fork PRs, or direct DB query. |
| **Host System Integrity** | Critical | Vivobook Host OS (Ubuntu 24.04), Docker Daemon | Host RCE via container breakouts, arbitrary Docker socket access, or command injection. |
| **Application Availability** | Medium | Fastify Server Event Loop, PostgreSQL Connection Pool, VCS CPU/RAM | Denial of Service via algorithmic complexity (DAG traversal), decompression bombs, memory exhaustion, or rate limit abuse. |

---

## 3. Threat Actors & Capabilities

1. **Anonymous Remote Attacker:**
   - Possesses network access to the HTTP port (via public internet, local LAN, or Tailscale network).
   - Aims to exploit unauthenticated endpoints, bypass authentication, enumerate accounts or private repositories, trigger DoS, or execute SSRF attacks.
2. **Authenticated Low-Privilege User:**
   - Legitimate account on the platform with read-only or member permissions on certain repositories.
   - Aims to escalate privileges to repository admin, read private repositories belonging to other tenants (BOLA/IDOR), modify refs without authorization, or inject malicious payloads.
3. **Malicious Contributor / Fork Author:**
   - Creates a fork of a repository or pushes adversarial commits, branches, or PRs.
   - Attempts to exfiltrate CI secrets via pull request workflows, abuse the CI runner for cryptocurrency mining or host compromise, or store malformed objects that crash parsers.
4. **Adversarial Repository Content (Data-as-Code):**
   - Repository content (blobs, trees, commit messages, Markdown files) must be considered intrinsically hostile.
   - Aims to exploit filesystem symlink resolution during checkout, trigger path traversal, or execute Stored XSS in the browser when viewing repository files.

---

## 4. Trust Boundary Crossings & Attack Scenarios

### Boundary 1: Internet / Client ──► Fastify API
- **Attack Vector: CSRF via Fail-Open Token Check:**
  - *Mechanism:* An attacker hosts a malicious website that issues cross-site state-changing POST requests. If the browser does not include the `csrf_token` cookie, `server/src/middleware/csrf.ts:20` skips validation, executing the mutation with the victim's ambient session credentials.
- **Attack Vector: Denial of Service via Proxy IP Collapsing:**
  - *Mechanism:* When deployed behind a reverse proxy, all clients share the IP address `127.0.0.1`. An attacker rapidly sends 100 requests to hit the global rate limit in `server/src/lib/rateLimit.ts`, locking out all users on the instance.

### Boundary 2: Fastify ──► Filesystem & Rust Subprocesses
- **Attack Vector: Race Condition on Unverified Object Upload:**
  - *Mechanism:* An attacker uploads an invalid object to `POST /api/repos/:owner/:repo/objects/:hash`. The server moves the object into the permanent CAS fanout path *before* running `execItehaas(['verify', hash])`. Concurrent requests can read the corrupt file during the verification window, corrupting repository integrity.
- **Attack Vector: Buffer Concatenation Heap Exhaustion:**
  - *Mechanism:* Repeated `Buffer.concat` in the octet-stream body parser for 64 MiB payloads generates tens of gigabytes of garbage objects, exhausting the Node.js heap and crashing the backend process.

### Boundary 3: Rust VCS Engine ──► Object Storage & DAG Parsing
- **Attack Vector: Packfile Unbounded Memory Allocation:**
  - *Mechanism:* A malicious repository packfile declaring an entry length of `0xFFFFFFFF` is supplied to `verify_pack`. The parser allocates a 4 GiB vector directly, causing a fatal out-of-memory crash.
- **Attack Vector: Decompression Bomb:**
  - *Mechanism:* A compact zlib stream that expands to several gigabytes is parsed. Mitigated by `ZlibDecoder.take(64M + 1)` in `vcs/src/object/store.rs`, but requires constant enforcement across all object ingestion points.

### Boundary 4: Server ──► Outbound Remote Git Protocol
- **Attack Vector: Server-Side Request Forgery (SSRF) via `localhost` Exception:**
  - *Mechanism:* In `vcs/src/remote/http.rs:43`, `is_private_host` explicitly permits `localhost`. An attacker adds a remote URL such as `http://localhost:3001/api/repos/...` or `http://localhost:5432/api/repos/...`, forcing the VCS server to issue HTTP requests against internal loopback services.

### Boundary 5: CI Workflow ──► Runner ──► Host
- **Attack Vector: Host Repository Corruption via Bind-Mount:**
  - *Mechanism:* Workflows are executed in Docker with `-v ${repoPath}:/workspace`. Even though the container runs as non-root with dropped capabilities, direct access to the live host repository directory violates the ephemeral sandbox principle.
- **Attack Vector: CI Secret Exfiltration via Fork Pull Requests:**
  - *Mechanism:* An untrusted fork submits a PR with a modified workflow script attempting to print or exfiltrate environment secrets. Mitigated by withholding secrets from fork PRs in `server/src/routes/ci.ts:230`.

### Boundary 6: Repository Content ──► Web UI DOM
- **Attack Vector: Stored Cross-Site Scripting (XSS):**
  - *Mechanism:* Malicious Markdown containing `<script>` tags, inline event handlers (`onload=`), or `javascript:` URI links. Mitigated by `ReactMarkdown` + `rehype-sanitize` in `web/components/MarkdownViewer.tsx:41-54`, but requires strict Content-Security-Policy (CSP) headers as defense-in-depth.

---

## 5. Explicit Non-Goals & Architectural Constraints

1. **Multi-Host Clustering:** Itehaas is engineered as a single-host modular monolith on an Ubuntu 24.04 Vivobook with Tailscale. Distributed consensus (e.g. Raft) and distributed file locking are out of scope.
2. **Third-Party Identity Providers:** OAuth2 and SAML integrations are deferred; authentication relies on internal Argon2id password hashing and session tokens.
3. **Full MicroVM Virtualization:** CI execution relies on container isolation (Docker with dropped capabilities and isolated networks) rather than Firecracker microVMs at this stage.
