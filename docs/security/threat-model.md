# Itehaas — Comprehensive Threat Model

**Version:** 2.0.0 (Phase S0 Reconnaissance)  
**Date:** 2026-09-02  
**Role:** Principal Security Engineer  
**Status:** Canonical Reference Document  
**Scope:** Architectural trust boundaries, threat actors, assets, data flows, attack surfaces, and defensive boundaries across the Rust VCS engine (`itehaas`), Node.js/Fastify API tier, Next.js frontend, PostgreSQL metadata layer, Docker runtime, and host OS.

---

## 1. Executive Summary & Security Philosophy

Itehaas is a self-hosted developer platform designed to unify Git-like content-addressable version control with modern web collaboration and integrated CI/CD workflows. The security philosophy governing this threat model is:

> **Treat every boundary as hostile until proven otherwise.**

Itehaas operates under a **zero-trust boundary model** with zero reliance on trusted-user assumptions:
- Users may be malicious or actively compromised.
- Repository contents (blobs, trees, commit messages, branch names, file paths, and Markdown) are attacker-controlled data.
- VCS objects and compression streams are potentially weaponized.
- CI configuration files (`itehaas.yml`) and build execution scripts are untrusted input running in an assumed-compromised execution domain.
- Filesystem and database states may race concurrently with authorization checks.

---

## 2. High-Value Assets & Impact Matrix

| Asset | Classification | Storage Location | Threat Scenarios & Impact |
|---|---|---|---|
| **User Authentication Credentials** | Critical | PostgreSQL `users.password_hash`, sessions table | Offline password cracking if DB is dumped; session hijacking via cookie theft or token leakage. Mitigated by Argon2id (`m=65536, t=3, p=1`). |
| **Active Session Tokens & CSRF Tokens** | High | PostgreSQL `sessions.id`, HTTP Cookies (`itehaas_session`) | Impersonation of repository owners, privilege escalation, cross-site request forgery. |
| **Private Repository Source Code & History** | High | Host CAS Filesystem: `data/repos/{owner}/{repo}/.itehaas/objects/` | Intellectual property exfiltration, corporate espionage via BOLA/IDOR, path traversal, or remote filesystem fetch. |
| **CI Secrets & Deployment Keys** | Critical | PostgreSQL `ci_secrets.value`, container environment | Cloud provider compromise, production service takeover, API secret theft via untrusted fork pull requests or log leakage. |
| **Host System Integrity & Runtime Isolation** | Critical | Host OS (Ubuntu / macOS), Docker daemon | Remote code execution (RCE) on host via container breakout, Docker socket access, or command injection. |
| **Platform Availability & Resource Budgets** | Medium | Fastify event loop, PostgreSQL connection pool, VCS CPU/RAM | Denial of service (DoS) via algorithmic complexity bombs (DAG traversal), zip bombs, memory exhaustion, or unthrottled subprocess spawning. |
| **Audit Logs & Security Observability** | Medium | PostgreSQL `audit_logs` table, Fastify structured logger | Tampering with or evasion of incident response records, unauthorized action repudiation. |

---

## 3. Threat Actors & Capabilities

1. **Anonymous External Attacker:**
   - Possesses network access to exposed HTTP ports (public internet, local network, or Tailscale network interface).
   - Capable of sending malformed HTTP requests, probing unauthenticated routes, forging host/origin headers, attempting credential brute-forcing, exploiting rate-limit bypasses, and triggering SSRF or DoS conditions.

2. **Authenticated Low-Privilege User:**
   - Holds valid credentials and an active session with permissions on their own repositories or organizations.
   - Aims to access other users' private repositories (horizontal privilege escalation / IDOR), elevate permissions to repository administrator or organization owner (vertical privilege escalation), or abuse collaboration features (issues, PRs, comments).

3. **Malicious Contributor / Fork Author:**
   - Controls an external fork of a public or shared repository.
   - Submits adversarial pull requests, commits, branches, or workflows containing scripts intended to exfiltrate CI secrets, abuse container runners for cryptocurrency mining, or corrupt target repositories.

4. **Hostile Repository Content (Data-as-Code):**
   - Data stored inside Git/VCS objects (tree entries, blobs, symlinks, filenames, submodule pointers).
   - Aims to exploit filesystem path resolution during checkout (symlink traversal, case-insensitivity collisions, `.itehaas` metadata overwrites), crash binary parsers with malformed headers, or execute stored XSS in web browsers.

5. **Compromised CI Runner:**
   - The execution context inside an ephemeral container running user-supplied workflow scripts.
   - Assumed fully hostile; attempts container breakout, host filesystem probing, network port scanning, denial-of-service, or secret harvesting from the environment.

---

## 4. Architectural Trust Boundaries

```
[ External Untrusted Network / Tailscale Client / Web Browser ]
                               │
               Boundary 1: Web ◄──► API (HTTP / CORS / CSRF / Headers)
                               ▼
                 ┌───────────────────────────┐
                 │   Next.js 14 Web Tier     │  (Port 3000)
                 └─────────────┬─────────────┘
                               │
               Boundary 2: Browser ◄──► DOM (XSS / Sanitization / CSP)
                               │
                               ▼
                 ┌───────────────────────────┐
                 │    Fastify 4 API Tier     │  (Port 3001)
                 │  AuthN, AuthZ, Validation │
                 └──────┬──────────────┬─────┘
                        │              │
      Boundary 3: Node ◄► DB           │ Boundary 4: Node ◄► Rust
                        ▼              ▼
         ┌────────────────────┐   ┌───────────────────────────────┐
         │  PostgreSQL 16 DB  │   │  Rust VCS Engine (`itehaas`)  │
         │  Metadata, Secrets │   │  Object parsing, DAG, Pack    │
         └────────────────────┘   └──────────────┬────────────────┘
                                                 │
                                 Boundary 5: API / Rust ◄► Filesystem
                                                 ▼
                                  ┌───────────────────────────────┐
                                  │ Filesystem CAS (`.itehaas/`)  │
                                  │ Loose objects, refs, working  │
                                  └───────────────────────────────┘

[ Asynchronous / Outbound Boundaries ]
Boundary 6: API Tier ◄──► CI Runner Container (Isolation, Docker daemon, Secrets injection)
Boundary 7: CI Runner Container ◄──► Host OS / Network (Breakout boundary)
Boundary 8: Rust Engine / Server ◄──► External Network (SSRF / Git Remote Protocol)
Boundary 9: Multi-Tenant Organization / Team Privilege Boundary
```

---

## 5. Detailed Boundary Analysis & Threat Vectors

### Boundary 1: Web Browser / External Client ◄──► Fastify API Tier
- **Location:** HTTP transport interface (`server/src/index.ts`, `routes/`, `middleware/`).
- **Data Ingress:** HTTP request headers, query parameters, cookie tokens, JSON bodies, raw `application/octet-stream` byte payloads.
- **Enforced Controls:**
  - Fastify Helmet security headers (HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy).
  - CORS allowlist (strict in production).
  - CSRF double-submit token checking with timing-safe comparisons.
  - Global and endpoint-specific rate limiting (`server/src/lib/rateLimit.ts`).
- **Identified Weaknesses & Threats:**
  - *CSRF Fallback Bypass:* In `server/src/middleware/csrf.ts`, if `headerToken && cookieToken` match each other, the check passes without requiring the valid HMAC signature from the server session ID, enabling cookie-tossing attacks.
  - *CSRF Exclusion on Logout:* `POST /api/auth/logout` is excluded from CSRF checks, allowing cross-site forced logout.
  - *Synchronous Event-Loop Blocking:* Object uploads parse 64 MiB payloads and run `zlib.inflateSync` directly on the event loop, causing denial of service.

### Boundary 2: Web Application ◄──► Browser DOM (XSS Boundary)
- **Location:** React components (`web/components/MarkdownViewer.tsx`, `FileViewer.tsx`, `DiffViewer.tsx`).
- **Data Ingress:** README content, commit messages, issue bodies, comments, filenames, author names.
- **Enforced Controls:**
  - `react-markdown` with `rehype-sanitize` using `defaultSchema`.
  - Protocol allowlist blocking `javascript:`, `data:`, `vbscript:`.
  - Next.js CSP header (`script-src 'self'`, `default-src 'self'`).
- **Identified Weaknesses & Threats:**
  - SVG or nested HTML in user-controlled diffs or raw file viewers if rendered with unsafe innerHTML.
  - Inconsistency between frontend CSP (`connect-src 'self'`) and API port (`http://localhost:3001`), risking broken requests or overly broad relaxation.

### Boundary 3: Node.js API ◄──► PostgreSQL Database
- **Location:** Database access layer (`server/src/db/index.ts`, `server/src/routes/*`).
- **Data Ingress:** SQL parameters, query strings, transaction commands.
- **Enforced Controls:**
  - Parameterized queries (`$1, $2, ...`) across all core routes.
  - Connection timeout (5,000ms) and statement timeout (5,000ms).
- **Identified Weaknesses & Threats:**
  - *String Interpolation:* `server/src/routes/users.ts:417` interpolates `interval '${days} days'` into SQL text.
  - *Lack of Role Separation:* Application connects using a single superuser-equivalent role (`itehaas`) with full DDL/DML permissions; no separate read-only or migration-only database role.
  - *Advisory Lock Hash Collisions:* `hashStringToInt` uses a 31-bit polynomial rolling hash, risking hash collisions between unrelated repository IDs.

### Boundary 4: Node.js ◄──► Rust VCS Subprocess
- **Location:** Subprocess boundary (`server/src/lib/vcs.ts:execItehaas`).
- **Data Ingress:** CLI arguments array, working directory (`cwd`), stdin buffers.
- **Enforced Controls:**
  - Rejection of shell execution (`spawn` directly invokes binary path).
  - Environment allowlist (`ALLOWED_ENV_KEYS: PATH, LANG, HOME, USER, TMPDIR, SHELL`) prevents leakage of `DATABASE_URL`, `COOKIE_SECRET`, or CI tokens.
  - Argument sanitization: rejection of null bytes, newlines, and unlisted CLI flags starting with `-`.
  - Concurrency control: `vcsSemaphore` limits concurrent subprocesses to 3.
  - Execution timeout (30s) with SIGTERM followed by SIGKILL escalation.
  - Output stream capping at 1 MiB.
- **Identified Weaknesses & Threats:**
  - *Subprocess Storm in Ancestor Check:* `isAncestor` invokes `itehaas cat-file -p` in a sequential loop up to 2,000 times for a single push, monopolizing the global VCS semaphore and starving other requests.
  - *Binary Path Verification in Production:* Debug binary path (`../../target/debug/itehaas`) is used as fallback, and file existence is not validated at application startup.

### Boundary 5: API / Rust Engine ◄──► Filesystem Storage (Repository Root)
- **Location:** File I/O operations in `server/src/lib/vcs.ts` and `vcs/src/checkout.rs`.
- **Data Ingress:** Relative paths, branch names, repository names, tree entry filenames.
- **Enforced Controls:**
  - `validateRepoPath` checks that paths resolve within `config.reposRoot` and inspects parent directory chains for symbolic links.
  - `ensure_no_symlink_and_inside_repo` verifies path containment during checkout.
- **Identified Weaknesses & Threats:**
  - *Case-Insensitive Filesystem Metadata Overwrite:* `vcs/src/checkout.rs:23` uses case-sensitive comparisons (`s == ".itehaas"`). On case-insensitive file systems (macOS APFS, Windows NTFS), checkout of entries named `.Itehaas` or `.Git` directly overwrites repo metadata and control structures.
  - *Single-Dot/Double-Dot Directory Confusion:* `repoPathFor` regex `/^[a-zA-Z0-9._-]{1,100}$/` accepts `.` and `..`, allowing path hierarchy collapsing inside `data/repos`.
  - *Unbounded Checkout Size:* Checkout writes blobs without checking total disk quotas.

### Boundary 6: API Tier ◄──► CI Runner Container
- **Location:** CI execution pipeline (`server/src/routes/ci.ts:executeInRunner`).
- **Data Ingress:** Untrusted workflow YAML (`itehaas.yml`), job step shell commands, environment variables.
- **Enforced Controls:**
  - YAML parser limits (64 KiB max file, 10 jobs max, 20 steps max, 5,000 char step limit).
  - Hardened Docker runner flags: `--network none`, `--memory 512m`, `--pids-limit 128`, `--user 65534:65534`, `--read-only`, `--tmpfs /tmp`, `--cap-drop ALL`, `--security-opt no-new-privileges:true`.
  - Host execution fallback disabled (fail closed).
- **Identified Weaknesses & Threats:**
  - *CRITICAL Fork Secret Exfiltration:* `server/src/routes/ci.ts:264` attempts to identify untrusted fork commits via `!fs.existsSync(objPath)`. However, `server/src/routes/pulls.ts:115` (`copyMissingObjects`) copies all fork objects into the repository *before* CI triggers. As a result, the target repository's CI secrets are passed to untrusted fork PR builds!
  - *Read-Write Repository Bind-Mount:* `-v ${repoPath}:/workspace` is mounted without `:ro`, allowing containerized scripts to modify repository files and Git metadata if file permissions permit.
  - *Naive Secret Masking:* `fullLogs.split(v).join('***')` is easily bypassed if scripts encode secrets in base64, hex, or split strings.

### Boundary 7: CI Runner Container ◄──► Host OS
- **Location:** Docker daemon boundary on the host machine.
- **Enforced Controls:**
  - Socket mounting (`/var/run/docker.sock`) is explicitly forbidden and disabled.
  - Capability dropping (`--cap-drop ALL`) and non-root execution.
- **Identified Weaknesses & Threats:**
  - Shared kernel vulnerabilities or Docker daemon exploits if container engine is unpatched.
  - Disk exhaustion if runner writes excessively to `/tmp` tmpfs or bound workspace.

### Boundary 8: Server / Rust Engine ◄──► External Network (SSRF Boundary)
- **Location:** Remote operations (`server/src/routes/repos.ts:1338`, `vcs/src/remote/http.rs`).
- **Data Ingress:** Remote URLs configured via `POST /api/repos/:owner/:repo/remotes`.
- **Enforced Controls:**
  - `is_private_host` checks IP ranges and blocks private subnets (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, ::1, fc00::/7).
  - HTTP redirects disabled (`redirects(0)`).
- **Identified Weaknesses & Threats:**
  - *CRITICAL Filesystem Remote Cross-Tenant Exfiltration:* `POST /api/repos/:owner/:repo/remotes` accepts `file:///` URLs. Calling `POST /api/repos/:owner/:repo/fetch` causes the Rust engine to resolve the filesystem path to *any other repository on disk* and import all private commits, trees, and blobs into the attacker's repository!
  - *DNS Rebinding SSRF:* `is_private_host` checks DNS resolution upfront, but `ureq::Agent` performs its own separate DNS resolution when establishing the connection, allowing DNS rebinding to loopback services.

### Boundary 9: Multi-Tenant Organization & Team Privilege Boundary
- **Location:** Organization and team routes (`server/src/routes/orgs.ts`, `server/src/lib/permissions.ts`).
- **Enforced Controls:**
  - Role-based access control (`owner`, `admin`, `member`) within organizations.
- **Identified Weaknesses & Threats:**
  - *CRITICAL Universal Repository Takeover:* `POST /api/orgs/:org/teams/:team/repos` does not verify that the user or organization owns or has admin access to the target repository. Any user can create an organization, create a team, and link *any victim's repository* to the team with `'admin'` permission, achieving full administrator takeover of any repository on the platform.
  - *Missing Authorization on Reviewer Deletion:* `DELETE /api/repos/:owner/:repo/pulls/:id/reviewers/:username` does not verify permissions, allowing any authenticated user to remove reviewers from any repository.
  - *BOLA / IDOR in Issue Updates:* `PATCH /api/repos/:owner/:repo/issues/:id` does not verify that `:id` belongs to `:repo`, allowing cross-repository issue modifications.
  - *Unauthenticated PII Harvesting:* `GET /api/users/:username`, `GET /api/orgs/:org/members`, and `GET /api/orgs/:org/teams/:team/members` expose private email addresses to unauthenticated callers.

---

## 6. Security Assumptions & Operational Constraints

1. **Deployment Topology:** Single-host modular monolith running on Linux/macOS, accessed via Tailscale or local reverse proxy. Multi-node clustering and distributed file locking are out of scope.
2. **Reverse Proxy Configuration:** In production, Fastify assumes a trusted reverse proxy terminating TLS. Fastify `trustProxy: true` is configured, meaning the proxy must strip or overwrite client-supplied `X-Forwarded-For` headers.
3. **Database Security:** PostgreSQL is assumed to be running on loopback (`127.0.0.1:5432`) or an internal Docker network, protected from public internet exposure.
4. **Binary Integrity:** The Rust `itehaas` binary is compiled and deployed in a non-world-writable location on the host.

---

## 7. Threat Modeling Conclusion

While foundational security controls were introduced in prior development iterations (parameterized queries, Argon2id hashing, CSP headers, basic rate limits), multiple critical vulnerabilities remain at the trust boundaries:
1. **Universal Authorization Bypass:** Organization team repository assignment lacks repository ownership validation.
2. **Filesystem Remote Exfiltration:** `file://` remotes allow cross-tenant theft of private repositories.
3. **CI Secret Exfiltration:** Fork PRs receive target repository secrets due to premature object copying.
4. **BOLA/IDOR Flaws:** Issue update and reviewer deletion routes lack resource ownership validation.
5. **Denial of Service:** Unbounded DAG expansion bombs in tree parsing and synchronous decompression on the event loop.

These findings are cataloged in `docs/security/vulnerability-register.md` and prioritized for remediation in subsequent phases.
