# Security Phase S7 — Resource Exhaustion, DoS, & Async Decompression

**Status:** ✅ Complete  
**Date:** 2026-09-02  
**Owner:** Principal Security Engineer  
**Scope:** Event-loop starvation elimination via asynchronous zlib decompression ([SEC-015](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-015--event-loop-starvation-dos-via-synchronous-64-mib-decompression)), unauthenticated CPU/subprocess exhaustion prevention on user contributions ([SEC-021](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-021--unauthenticated-remote-cpu--subprocess-exhaustion-via-contributions)), and interval query SQL injection neutralization ([SEC-020](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-020--sql-string-interpolation-for-interval-filter-in-user-contributions)).

---

## 1. Objective

Prevent denial of service, thread starvation, CPU overload, and event-loop freezing across all VCS operations, heavy object ingestion, and public API endpoints.

---

## 2. Threat Analysis & Defensive Matrix

| Threat | Attack Path | Previous State | Implemented Control (S7) |
|---|---|---|---|
| **Event-Loop Starvation via Synchronous Decompression** (SEC-015) | Attackers upload 64 MiB compressed objects via `POST /api/repos/:owner/:repo/objects`. The server executed `zlib.inflateSync` directly on Node's main event-loop thread. During decompression, the entire event loop froze, blocking health checks, authentication, and all concurrent user requests. | `server/src/routes/repos.ts` called `zlib.inflateSync(body, { maxOutputLength: 64M })`. | Replaced with `await promisify(zlib.inflate)(body, { maxOutputLength: 64M })`, offloading decompression to the libuv threadpool and keeping the Node.js event loop fully responsive. |
| **Unauthenticated Remote CPU & Subprocess Exhaustion** (SEC-021) | Attackers hammered `GET /api/users/:username/contributions` with arbitrary query parameters. For every unauthenticated request, the server spawned `itehaas log` child processes across all owned and member repositories. 10 concurrent requests could spawn hundreds of processes, crashing the server. | The route had no per-IP rate limiting and unbounded repository iteration. | Enforced per-IP sliding rate limiting (20 requests/minute via `checkRateLimit`), and capped repository scanning to at most 15 repositories per request. |
| **SQL String Interpolation in Activity Query** (SEC-020) | In the contributions route, the query used `'now() - interval \'${days} days\''`, concatenating query params directly into the SQL string. | Unparameterized interval interpolation. | Replaced with parameterized query: `now() - ($2::text \|\| ' days')::interval` with `[target.id, String(days)]`. |

---

## 3. Files Modified

1. `server/src/routes/repos.ts`: Replaced `zlib.inflateSync` with asynchronous `inflateAsync` using `util.promisify`.
2. `server/src/routes/users.ts`: Added rate limiting (20 req/min per IP) and repository scan bounds (max 15 repos) to the contributions route; parameterized interval filter query.
3. `server/src/routes/s7-dos.test.ts`: Added regression tests verifying `inflateAsync` adoption, rate limiting on contributions, and repository scan bounds.

---

## 4. Verification & Regression Tests

- **DoS & Resource Exhaustion Test Suite (`server/src/routes/s7-dos.test.ts`):** 11/11 tests passing:
  - `SEC-015: repos.ts uses async decompression (inflateAsync) instead of blocking inflateSync`.
  - `SEC-021: users contributions endpoint enforces rate limiting (429 on 21st request)`.
  - `SEC-021: users.ts caps repositories scanned per request to 15`.
  - `S7-01 isAncestor bounded (MAX_STEPS 2000)`.
  - `S7-02 revwalk bounded (visited > 10000)`.
  - `S7-03 search query length & limit bounding`.
  - `S7-04 CI run rate-limiting & queue bounds`.
  - `SEC-014 linear chunk collection`.
- **Full Project Regression Test Suites:**
  - `pnpm --filter server test`: 22 test files, 187/187 tests green.
  - `cargo test`: 124/124 tests green.

---

## 5. Acceptance Criteria Checklist

- [x] Synchronous `zlib.inflateSync` replaced with threadpool async decompression (SEC-015)
- [x] Unauthenticated contributions endpoint rate limited and repo scans bounded (SEC-021)
- [x] SQL interval string interpolation eliminated (SEC-020)
- [x] Zero functional regressions in existing tests
- [x] Vulnerability register updated
- [x] `PLAN.md` updated

---

## 6. Next Phase Gate

- **Active Phase Status:** S7 COMPLETE.
- **Next Phase:** `SECURITY PHASE S8 — DATABASE SECURITY & SQL INJECTION DEFENSE`
- **Scope:** Complete SQL injection audit across all queries, parameterized statement validation, transaction isolation, advisory locks, and connection pool exhaustion defense.
