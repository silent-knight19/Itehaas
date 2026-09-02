# Itehaas — Critical Findings & Vulnerability Triage (Phase S1)

**Date:** 2026-09-02  
**Auditor:** Principal Security Engineer  
**Purpose:** Rigorous validation, classification, and remediation prioritization for all Critical (P0) and High (P1) findings identified in Phase S0.  
**Rule:** No broad source refactoring during triage. Define preconditions, exact code lines, realistic impact, safe verification steps, and remediation priority.

---

## 1. Triage Summary & Priority Matrix

| Priority | Finding ID | Title | Component | Severity | Remediation Target Phase |
|---|---|---|---|---|---|
| **P0** | **SEC-004** | CSRF Double-Submit Validation Fails Open when Cookie Missing | `server/src/middleware/csrf.ts` | **Critical / High** | Phase S2 / Phase S11 |
| **P0** | **SEC-005** | Rate Limiting Proxy IP Collapsing & Instance-Wide DoS | `server/src/lib/rateLimit.ts` | **High** | Phase S2 / Phase S14 |
| **P0** | **SEC-014** | Quadratic Buffer Churn DoS during 64 MiB Object Uploads | `server/src/routes/repos.ts` | **High** | Phase S7 |
| **P0** | **SEC-015** | Unbounded Memory Allocation in Packfile Header Parsing | `vcs/src/pack.rs` | **High** | Phase S6 |
| **P0** | **SEC-016** | Outbound SSRF Bypass via `localhost` Exception in Remote Fetch | `vcs/src/remote/http.rs` | **High** | Phase S12 |
| **P0** | **SEC-021** | Race Condition on Unverified Object CAS Placement | `server/src/routes/repos.ts` | **High** | Phase S4 |
| **P0** | **SEC-011** | Over-Securing Breaks Cross-Fork Pull Request Workflow | `server/src/routes/pulls.ts` | **High (Defect)** | Phase S3 |
| **P1** | **SEC-001** | Production Fallback to Insecure Credentials (Fail-Open Risk) | `server/src/config.ts` | **Critical (Config)** | Phase S2 / S17 |
| **P1** | **SEC-002** | Compose Hardcoded Insecure Credentials in Manifest | `docker-compose.yml` | **Critical (Deploy)** | Phase S17 |
| **P1** | **SEC-003** | Permissive CORS with Credentials in Development Mode | `server/src/index.ts` | **High** | Phase S11 |
| **P2** | **SEC-007** | CI Secrets Key Coupled to Web Session Cookie Secret | `server/src/lib/secrets.ts` | **Medium** | Phase S9 |
| **P2** | **SEC-019** | Outdated High-Severity Dependencies in Web Tier | `web/package.json` | **Medium** | Phase S16 |

---

## 2. Deep Triage of Critical & High Vulnerabilities

---

### SEC-004: CSRF Double-Submit Validation Fails Open when Cookie Missing

- **Severity:** Critical / High (CVSS 8.1)
- **CWE:** CWE-352 (Cross-Site Request Forgery), CWE-305 (Authentication Bypass by Primary Weakness)
- **Affected File & Lines:** [`server/src/middleware/csrf.ts:17-25`](file:///Users/sachinkumarsingh/Projectss/Itehaas/server/src/middleware/csrf.ts#L17-L25)
- **Code Evidence:**
  ```typescript
  const headerToken = (req.headers['x-csrf-token'] as string | undefined) || (req.headers['x-xsrf-token'] as string | undefined);
  const cookieToken = (req.cookies as any)?.['csrf_token'] as string | undefined;
  // S11: allow missing csrf_token cookie for backwards compat (old tests/clients), but if cookie present, require header
  if (!cookieToken) return; // no csrf cookie yet (old client), skip
  const expected = csrfTokenForSession(sessionId);
  let ok = false;
  if (headerToken && headerToken === expected) ok = true;
  else if (headerToken && cookieToken && headerToken === cookieToken) ok = true;
  ```
- **Preconditions:**
  1. Victim has an active browser session on Itehaas (`itehaas_session` cookie set).
  2. Victim visits an external third-party site or is tricked into submitting a cross-origin form/request.
- **Vulnerability Mechanics & Scenario:**
  1. An external site triggers a cross-origin state-changing mutation (e.g., `POST /api/repos` or `DELETE /api/repos/:owner/:repo`).
  2. If the request does not include the `csrf_token` cookie (or the cookie has expired or was removed), line 20 executes: `if (!cookieToken) return;`.
  3. The CSRF check exits immediately without error, treating the unverified request as valid.
  4. Furthermore, line 24 accepts `headerToken === cookieToken` without verifying that the token was signed with `csrfTokenForSession(sessionId)`, allowing attackers who can inject cookies to pass arbitrary matching strings.
- **Impact:** Complete bypass of CSRF protection on all state-changing endpoints for any client lacking the cookie token.
- **Remediation Plan:**
  - For all state-changing HTTP methods (`POST`, `PUT`, `PATCH`, `DELETE`) authenticated via cookie, strictly require *both* the `csrf_token` cookie and the `X-CSRF-Token` header.
  - Fail closed: reject requests with `403 Forbidden` if either is missing.
  - Verify that the header token cryptographically matches `csrfTokenForSession(sessionId)`.

---

### SEC-005: Rate Limiting Proxy IP Collapsing & Instance-Wide DoS

- **Severity:** High (CVSS 7.5)
- **CWE:** CWE-770 (Allocation of Resources Without Limits), CWE-307 (Improper Restriction of Excessive Authentication Attempts)
- **Affected File & Lines:** [`server/src/lib/rateLimit.ts:8-13`](file:///Users/sachinkumarsingh/Projectss/Itehaas/server/src/lib/rateLimit.ts#L8-L13), [`server/src/index.ts:20`](file:///Users/sachinkumarsingh/Projectss/Itehaas/server/src/index.ts#L20)
- **Code Evidence:**
  ```typescript
  // rateLimit.ts:
  function keyFor(req: any, suffix: string): string {
    const ip = (req.ip as string) || (req.headers['x-forwarded-for'] as string) || ...;
    const cleanIp = String(ip).split(',')[0].trim().slice(0, 80);
    return `${cleanIp}:${suffix}`;
  }
  // index.ts:
  const app = Fastify({ logger: { ... } }); // trustProxy is not set!
  ```
- **Preconditions:**
  1. Itehaas is deployed behind a reverse proxy (e.g., Tailscale serve, Nginx, or Docker port-forwarding).
- **Vulnerability Mechanics & Scenario:**
  1. In Fastify, unless `trustProxy: true` is configured on app initialization, `req.ip` is populated directly from the TCP socket remote address.
  2. For reverse-proxied traffic, the socket remote address is always `127.0.0.1`.
  3. Because `(req.ip as string)` evaluates to `"127.0.0.1"` (truthy), the fallback to `x-forwarded-for` is never reached.
  4. Every user request from across the network is keyed as `127.0.0.1:global` or `127.0.0.1:login-fails:<user>`.
  5. If an automated script sends 100 requests within one minute, the global bucket `127.0.0.1:global` exhausts the limit (100 req/min).
- **Impact:** Instance-wide Denial of Service; all legitimate users receive HTTP 429 ("too many requests"). In addition, 5 failed login attempts for any account locks out that account for all users connecting via the proxy.
- **Remediation Plan:**
  - Initialize Fastify with `trustProxy: true` (or an explicit trusted subnet allowlist).
  - Use Fastify's standardized `req.ip` resolution rather than ad-hoc header splitting.

---

### SEC-014: Quadratic Buffer Churn DoS during 64 MiB Object Uploads

- **Severity:** High (CVSS 7.5)
- **CWE:** CWE-770 (Allocation of Resources Without Limits), CWE-400 (Uncontrolled Resource Consumption)
- **Affected File & Lines:** [`server/src/routes/repos.ts:570-580`](file:///Users/sachinkumarsingh/Projectss/Itehaas/server/src/routes/repos.ts#L570-L580)
- **Code Evidence:**
  ```typescript
  app.addContentTypeParser('application/octet-stream', function (request: any, payload: any, done: any) {
    let data = Buffer.alloc(0);
    payload.on('data', (chunk: Buffer) => {
      data = Buffer.concat([data, chunk]); // Quadratic reallocation!
      if (data.length > 64 * 1024 * 1024 + 1024) {
        (payload as any).destroy(new Error('Payload too large'));
      }
    });
    payload.on('end', () => done(null, data));
  });
  ```
- **Preconditions:**
  1. Authenticated user uploading legitimate or large git blobs up to the platform limit of 64 MiB.
- **Vulnerability Mechanics & Scenario:**
  1. A 64 MiB payload arrives over TCP in ~1,000 chunks of ~64 KiB each.
  2. On each chunk, `Buffer.concat([data, chunk])` creates a new buffer of size `current + chunk` and copies all previous bytes.
  3. Total allocated memory over the upload stream = $\sum_{k=1}^{1000} (k \times 64\text{ KiB}) \approx 32\text{ Gigabytes}$.
  4. V8 garbage collection experiences severe thrashing, latency spikes on the event loop, and rapid heap exhaustion.
- **Impact:** Denial of Service; server process OOM crash under concurrent uploads.
- **Remediation Plan:**
  - Accumulate incoming chunks into an array: `const chunks: Buffer[] = []; chunks.push(chunk);`.
  - Maintain a running integer length check: `totalLength += chunk.length`.
  - Execute a single `Buffer.concat(chunks, totalLength)` upon the `end` event.

---

### SEC-015: Unbounded Memory Allocation in Packfile Header Parsing

- **Severity:** High (CVSS 7.5)
- **CWE:** CWE-789 (Memory Allocation with Excessive Size Value), CWE-400
- **Affected File & Lines:** [`vcs/src/pack.rs:102-106`](file:///Users/sachinkumarsingh/Projectss/Itehaas/vcs/src/pack.rs#L102-L106)
- **Code Evidence:**
  ```rust
  let mut len_buf = [0u8; 4];
  f.read_exact(&mut len_buf)?;
  let len = u32::from_be_bytes(len_buf) as usize;
  let mut data = vec![0u8; len]; // Unbounded vector allocation!
  f.read_exact(&mut data)?;
  ```
- **Preconditions:**
  1. Repository packfile supplied to `verify_pack()` or received over network transfer.
- **Vulnerability Mechanics & Scenario:**
  1. The packfile parser reads entry metadata declaring a 32-bit entry length `len`.
  2. It immediately executes `vec![0u8; len]` before verifying whether `len` exceeds the repository object limit (64 MiB).
  3. If a malformed or crafted packfile declares `len = 0xFFFFFFFF` (4 GiB), the allocator attempts to reserve 4.29 GB of memory immediately.
  4. On systems with standard memory limits, the Rust runtime aborts with an allocation failure.
- **Impact:** Immediate crash of the VCS parser binary, leading to repository command failure and potential server worker exhaustion.
- **Remediation Plan:**
  - Verify that `len <= 64 * 1024 * 1024` before allocating the vector.
  - Reject entries exceeding the limit with `ItehaasError::ObjectTooLarge`.

---

### SEC-016: Outbound SSRF Bypass via `localhost` Exception in Remote Fetch

- **Severity:** High (CVSS 7.5)
- **CWE:** CWE-918 (Server-Side Request Forgery)
- **Affected File & Lines:** [`vcs/src/remote/http.rs:40-46`](file:///Users/sachinkumarsingh/Projectss/Itehaas/vcs/src/remote/http.rs#L40-L46)
- **Code Evidence:**
  ```rust
  fn is_private_host(host: &str) -> bool {
      // Allow localhost explicitly for tests and local dev (resolves to 127.0.0.1 but should be allowed)
      let lower = host.to_ascii_lowercase();
      if lower == "localhost" || lower.starts_with("localhost:") {
          return false; // Permitted!
      }
      ...
  ```
- **Preconditions:**
  1. User has permissions to configure a remote repository URL (`itehaas remote add` or server-side sync).
- **Vulnerability Mechanics & Scenario:**
  1. While private RFC 1918 IPv4 and IPv6 subnets are blocked, `localhost` is explicitly exempt from the check.
  2. An attacker configures a remote URL targeting `http://localhost:3001/api/repos/...` or internal management services running on loopback ports.
  3. When `git fetch` or `git clone` executes, `ureq` establishes connections to internal local ports, facilitating loopback SSRF.
- **Impact:** Internal service reconnaissance, interaction with unauthenticated loopback endpoints, and SSRF.
- **Remediation Plan:**
  - Treat `localhost`, `127.0.0.1`, and `::1` as private hosts by default.
  - Require an explicit environment flag (`ALLOW_PRIVATE_REMOTES=true`) only for test harnesses.

---

### SEC-021: Race Condition on Unverified Object CAS Placement

- **Severity:** High (CVSS 7.0)
- **CWE:** CWE-367 (Time-of-check Time-of-use Race Condition), CWE-372 (Pipelining Incomplete File State)
- **Affected File & Lines:** [`server/src/routes/repos.ts:696-717`](file:///Users/sachinkumarsingh/Projectss/Itehaas/server/src/routes/repos.ts#L696-L717)
- **Code Evidence:**
  ```typescript
  await fs.promises.writeFile(tmp, body);
  // Atomic rename to final path occurs BEFORE verify!
  await fs.promises.rename(tmp, objectPath);
  // Verify after rename:
  const ver = await execItehaas(['verify', hash], { cwd: repoPath });
  if (ver.code !== 0) {
    try { await fs.promises.unlink(objectPath); } catch {}
    return reply.status(400).send({ error: 'Corrupt object: hash mismatch' });
  }
  ```
- **Preconditions:**
  1. Concurrent clients pushing objects to the repository.
- **Vulnerability Mechanics & Scenario:**
  1. A client uploads a corrupted or invalid object with a mismatched hash.
  2. The server moves the object into `.itehaas/objects/ab/cdef`.
  3. During the window between `rename()` and `unlink()`, another concurrent request checks `stat.isFile(objectPath)`.
  4. The concurrent request treats the corrupt object as already present (`dedup: true`) and skips re-upload.
  5. Furthermore, if the server worker terminates or crashes during `verify`, the corrupt object remains permanently in CAS storage.
- **Impact:** Repository corruption, cache poisoning, broken commit trees.
- **Remediation Plan:**
  - Verify the object's cryptographic integrity while it resides in the temporary path or in memory.
  - Only execute `rename(tmp, objectPath)` after verification has succeeded with exit code 0.

---

### SEC-011: Over-Securing Breaks Cross-Fork Pull Request Workflow

- **Severity:** High (Functional & Authorization Defect)
- **CWE:** CWE-285 (Improper Authorization), CWE-863 (Incorrect Authorization)
- **Affected File & Lines:** [`server/src/routes/pulls.ts:74`](file:///Users/sachinkumarsingh/Projectss/Itehaas/server/src/routes/pulls.ts#L74)
- **Code Evidence:**
  ```typescript
  const meta = await getRepoMeta(owner, repo);
  if (!meta) return reply.status(404).send({ error: 'not found' });
  if (!(await canWrite(meta.id, user.id))) return reply.status(403).send({ error: 'forbidden: write required' });
  ```
- **Preconditions:**
  1. An external user forks a public repository `owner/project` to `contributor/project`.
  2. The contributor creates a branch and attempts to open a pull request against `owner/project`.
- **Defect Mechanics:**
  1. The route checks `canWrite(meta.id, user.id)` on the *target* repository (`owner/project`).
  2. The contributor does not have write access to `owner/project` (only to their own fork).
  3. The request is rejected with `403 forbidden: write required`, completely disabling external contributions.
- **Impact:** Broken open-source collaboration workflow; legitimate pull requests cannot be opened.
- **Remediation Plan:**
  - If `isCrossFork` is true: verify `canWrite` on `source_repo` (contributor's fork) and `canRead` on `target_repo`.
  - If `isCrossFork` is false (in-repo branch PR): verify `canWrite` on the repository.

---

## 3. False Positives Ruled Out During Triage

1. **Subprocess Shell Injection (`server/src/lib/vcs.ts:193`):**
   - Verified that `child_process.spawn` does not invoke a shell (`shell: false`). Arguments are strictly passed as elements of an array. Shell metacharacters (`|`, `;`, `&`, `$()`) are not interpreted.
2. **README Stored Cross-Site Scripting (`web/components/MarkdownViewer.tsx`):**
   - Verified that `rehype-sanitize` with `defaultSchema` actively neutralizes script execution and filters `javascript:`, `data:`, and `vbscript:` protocols.
3. **SQL Injection in Clamped Query Limits:**
   - Verified that limits use `parseInt` with explicit mathematical clamping (`Math.min(Math.max(1, limit), 100)`) prior to interpolation into SQL queries.

---

## 4. Remediation Phase Mapping

- **Security Phase S2 (Authentication Hardening):**
  - Implement Fastify `trustProxy: true` configuration to eliminate proxy rate limit collapsing (`SEC-005`).
- **Security Phase S3 (Authorization Hardening):**
  - Fix cross-fork pull request authorization matrix (`SEC-011`).
- **Security Phase S4 (Filesystem & CAS Integrity):**
  - Fix CAS placement race condition: verify cryptographic hashes before renaming into permanent storage (`SEC-021`).
- **Security Phase S6 (VCS Parser Hardening):**
  - Enforce upper length bounds on packfile entries (`SEC-015`).
- **Security Phase S7 (Resource Exhaustion & DoS Prevention):**
  - Replace quadratic `Buffer.concat` with chunk array accumulation in octet-stream parser (`SEC-014`).
- **Security Phase S11 (Browser Security & CSRF):**
  - Fix CSRF middleware fail-open defect; strictly require valid double-submit tokens (`SEC-004`).
- **Security Phase S12 (Outbound Transport & SSRF):**
  - Remove loopback exemption in `is_private_host()` (`SEC-016`).

---

**Phase S1 Acceptance Gate:** Complete. Triage document finalized. Ready to proceed to **Phase S2 implementation** upon user approval.
