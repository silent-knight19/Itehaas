# Security Phase S14 — API Security, Rate Limiting, & Abuse Controls

**Status:** ✅ Complete  
**Date:** 2026-09-02  
**Owner:** Principal Security Engineer  
**Scope:** Tiered rate limiting across all API entry points, pagination limits and bounds clamping (max 100, default 30-50, offset limit 50,000), deep offset DoS prevention, mass assignment protections audit, and global request body limits.

---

## 1. Objective

Harden the API layer against resource exhaustion, denial of service from excessive pagination queries, mass assignment parameter pollution, and brute-force credential abuse.

---

## 2. Threat Analysis & Defensive Matrix

| Threat | Attack Path | Previous State | Implemented Control (S14) |
|---|---|---|---|
| **Deep Offset / Pagination Bomb DoS** | An attacker passes `?limit=1000000` or `?offset=1000000000` to repository, issue, or pull request listing endpoints. The database engine executes expensive sequential scans allocating massive memory buffers. | Uncapped or loosely bounded pagination parameters. | Enforced strict pagination clamping across `repos.ts`, `issues.ts`, `pulls.ts`, `search.ts`, and `users.ts`: `limit` is clamped to `[1, 100]` with default 50; `offset` is validated $\ge 0$ and bounded $\le 50,000$ (`offset > 50000` returns HTTP 400 `'offset too large'`). |
| **Mass Assignment Vulnerabilities** | An attacker sends extra JSON properties on update requests (e.g. `PATCH /api/users/:username` with `{ role: 'admin', is_admin: true }` or `PATCH /api/repos/...` with `{ id: '...', owner_id: '...' }`). If the handler blindly unpacks the body into SQL, privilege escalation occurs. | Potential risk if endpoints spread unvalidated object keys. | Audited all PATCH/PUT endpoints: every update route strictly validates payloads against schema whitelists via Zod (`z.object`), extracting only explicitly permitted mutable columns before compiling parameterized queries. |
| **API Endpoint Flooding & DoS** | Unauthenticated bots flood expensive endpoints (search ILIKE scans, contributions calculations, file retrieval) exhausting worker threads and database pool connections. | Inconsistent per-route throttling. | Tiered rate limiting enforced: global 100/min per IP, login 5/min with account lockout, register 3/min, search 30/min, file browsing 60/min, contributions 20/min (SEC-021), issue creation 20/min. Returns HTTP 429 with standard `Retry-After` header. |
| **Oversized Request Body Payload Bomb** | Attackers transmit gigabyte-scale JSON bodies to crash node processes via out-of-memory errors. | Relied on default framework options. | Explicitly declared 1MB body limit (`1048576` bytes) for JSON APIs in Fastify, while chunked streaming endpoints enforce explicit content length guards. |

---

## 3. Files Modified

1. `server/src/routes/issues.ts`: Added pagination bounds (`limit` clamped to 100, `offset` clamped to 50,000) and SQL parameterization.
2. `server/src/routes/pulls.ts`: Added pagination bounds (`limit` clamped to 100, `offset` clamped to 50,000) and SQL parameterization.
3. `server/src/routes/s14-api-security.test.ts`: Created regression test suite verifying pagination clamping, negative offset normalization, offset ceiling rejection, mass assignment resistance, and rate limiting enforcement.

---

## 4. Verification & Regression Tests

- **API Security Test Suite (`server/src/routes/s14-api-security.test.ts`):** 5/5 tests passing:
  - `clamps excessive limit=999999 to max 100 on issues list`.
  - `normalizes negative limit=-1 and offset=-1 to safe non-negative bounds`.
  - `rejects massive offset (> 50000) to prevent deep SQL offset denial of service`.
  - `user profile PATCH strictly updates only bio and avatar_url, ignoring role or is_admin fields`.
  - `triggers 429 Too Many Requests when rate limit threshold is exceeded`.
- **Full Project Regression Test Suites:**
  - `pnpm --filter server test`: 27 test files, 233/233 tests green.
  - `cargo test`: 124/124 tests green.

---

## 5. Acceptance Criteria Checklist

- [x] All listing endpoints bounded with max limit 100 and offset ceiling 50,000
- [x] Negative pagination parameters normalized safely
- [x] Mass assignment protection verified across all PATCH/PUT endpoints
- [x] Tiered rate limiting verified (auth, search, contributions, file, global)
- [x] Request payload size limits verified
- [x] `PLAN.md` updated

---

## 6. Next Phase Gate

- **Active Phase Status:** S14 COMPLETE.
- **Next Phase:** `SECURITY PHASE S15 — CONCURRENCY, MERGE COLLISION, & TOCTOU DEFENSE`
- **Scope:** PR merge advisory lock collisions ([SEC-019](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-019--race-condition--concurrency-collisions-in-pull-request-merges)), repository and branch-level advisory locking, compare-and-swap (CAS) commit locking, and concurrent merge collision defense.
