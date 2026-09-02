# Itehaas — Security Maturity Scorecard

**Date:** 2026-09-02  
**Auditor:** Principal Security Engineer  
**Evaluation Scale:** Unknown | Weak | Basic | Good | Strong | Hardened  
*(Note: Per engineering standard §34, security maturity is evaluated qualitatively based on evidence and verifiable controls, never through arbitrary percentages).*

---

## 1. Domain Maturity Ratings

| Security Domain | Current Rating | Baseline Evidence & Rationale | Target State |
|---|---|---|---|
| **Authentication** | **Good** | Argon2id implemented with tuned parameters (`m=65536, t=3, p=1`), unguessable UUID tokens, timing-equalized enumeration defenses, brute-force lockout. Lacks multi-factor authentication (MFA). | **Strong** |
| **Authorization** | **Basic** | Centralized `authorizeRepo()` with consistent 404-masking for private repositories. However, cross-fork pull request creation is improperly restricted by checking `canWrite` on target repos (SEC-011). | **Hardened** |
| **Session Security** | **Good** | 30-day session lifetimes, opportunistic database cleanup, HttpOnly/SameSite cookies, explicit session deletion upon logout. | **Strong** |
| **API Security** | **Basic** | Parameterized SQL queries and Zod schema validation. Weakened by CSRF fail-open behavior (SEC-004) and proxy IP collapsing under rate limiting (SEC-005). | **Hardened** |
| **Filesystem Safety** | **Strong** | Strict regex character allowlisting, canonical `realpath` validation, and recursive ancestor `symlink_metadata` checks prevent directory traversal and symlink escapes. | **Hardened** |
| **VCS Engine (Rust)** | **Strong** | Zero `unsafe` blocks, deterministic object framing, streaming zlib decompression limits (`take(64M+1)`), tree entry sorting/uniqueness, and depth caps. | **Hardened** |
| **Object Storage** | **Good** | Content-addressable storage with fanout directories (2/62), atomic file rename, deduplication. Affected by upload CAS race condition prior to verification (SEC-021). | **Hardened** |
| **Remote Transport** | **Basic** | Outbound requests enforce HTTP/HTTPS schemes, valid API paths, and TLS certificate validation. Compromised by unconditional `localhost` SSRF allowance (SEC-016). | **Strong** |
| **CI / Sandbox** | **Basic** | Host execution fallback removed (fails closed), container args drop capabilities (`ALL`) with unprivileged user and `--network none`. Lacks ephemeral workspace cloning (bind-mounts host directory). | **Strong** |
| **Containers** | **Basic** | Non-root container user (`65534`), read-only root filesystems, and `tmpfs` mounts. Docker compose manifest contains hardcoded default secrets (SEC-002). | **Strong** |
| **Secrets Management** | **Basic** | Minimal environment variable inheritance for subprocesses. CI secrets encryption key is coupled to web session cookie secret (SEC-007). | **Strong** |
| **Database Security** | **Strong** | 100% parameterized queries via `$1` placeholders, strict type validation, transactional migrations. Secrets encrypted prior to database insertion. | **Hardened** |
| **Frontend Security** | **Good** | React DOM auto-escaping, Markdown rendering secured via `rehype-sanitize` with default schema, dangerous URI protocols stripped. Zero `dangerouslySetInnerHTML`. | **Strong** |
| **Cross-Site Scripting (XSS)** | **Good** | MarkdownViewer component sanitizes HTML, filters `javascript:`/`data:` links. Strong defense-in-depth provided by Helmet CSP headers. | **Hardened** |
| **Cross-Site Request Forgery (CSRF)** | **Weak** | Double-submit token logic fails open when the `csrf_token` cookie is absent, and accepts header-cookie equality without cryptographic HMAC verification (SEC-004). | **Hardened** |
| **Server-Side Request Forgery (SSRF)** | **Weak** | Outbound VCS fetch agent exempts `localhost` from private host filtering, allowing loopback requests (SEC-016). | **Hardened** |
| **Denial of Service (DoS)** | **Weak** | In-stream `Buffer.concat` generates quadratic heap allocation overhead (>30 GB for 64 MiB objects) in `server/src/routes/repos.ts` (SEC-014), and packfile parsing lacks length bounds (SEC-015). | **Strong** |
| **Concurrency & TOCTOU** | **Basic** | PostgreSQL advisory locks and filesystem `.lock` files protect ref updates. CAS object placement has a race window where corrupt objects can be seen before verification (SEC-021). | **Hardened** |
| **Supply Chain Security** | **Basic** | Zero critical vulnerabilities in production, but 13 high-severity advisories remain in Next.js 14.2.35 and transitive packages (SEC-019). | **Good** |
| **Logging & Telemetry** | **Good** | Structured JSON logging with Pino, automatic redaction of Authorization headers, Cookie headers, and database credentials. Generic 500 error responses with correlation IDs. | **Strong** |
| **Monitoring** | **Basic** | Prometheus metrics endpoint (`/metrics`) tracks HTTP request counts, authentication failures, and rate limit events. Lacks external alerting integration. | **Good** |
| **Deployment Hardening** | **Basic** | Localhost binding defaults (`127.0.0.1:5432:5432`, `127.0.0.1:3001:3001`) protect interfaces from public network exposure, but compose file includes default credentials. | **Strong** |
| **Backup & Recovery** | **Basic** | Filesystem layout separates metadata from hot repository data. Comprehensive incident response procedures documented in `docs/security/incident-response.md`. | **Good** |

---

## 2. Overall Assessment Summary

- **Current Baseline Posture:** **Basic**  
  The application benefits from clean systems architecture and strong cryptographic building blocks. However, several critical implementation gaps (CSRF fail-open, proxy rate limit collapsing, buffer churn DoS, and loopback SSRF) must be remediated to transition the system to a truly defensible state.
- **Target Posture after Remediation:** **Hardened**
