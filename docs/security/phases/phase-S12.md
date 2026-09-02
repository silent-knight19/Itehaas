# Security Phase S12 — CSRF, CORS, & Defensive Transport Headers

**Status:** ✅ Complete  
**Date:** 2026-09-02  
**Owner:** Principal Security Engineer  
**Scope:** Elimination of development CORS wildcard origin reflection ([SEC-003](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-003--development-cors-wildcard-origin-reflection)), elimination of CSRF double-submit bypass via cookie tossing ([SEC-004](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-004--cross-subdomain-cookie-tossing-and-session-fixation)), protection of logout against unauthorized cross-origin trigger, origin verification, and preflight max-age caching.

---

## 1. Objective

Harden cross-origin resource sharing (CORS), protect against cross-site request forgery (CSRF) across all state-changing endpoints, and prevent session termination / data exfiltration via cookie tossing or unvalidated origin reflection.

---

## 2. Threat Analysis & Defensive Matrix

| Threat | Attack Path | Previous State | Implemented Control (S12) |
|---|---|---|---|
| **Permissive CORS with Credentials in Development** (SEC-003) | Fastify CORS was initialized with `origin: true` and `credentials: true` in non-production mode. If a developer visited a malicious website while running Itehaas locally, malicious scripts could issue authenticated cross-origin requests (`credentials: 'include'`) and exfiltrate private source code or session data. | `origin: true` dynamically reflected any `Origin` header. | In `server/src/index.ts:58-85`, replaced `origin: true` with strict allowlist matching. Disallowed origins and `null` origins are strictly rejected with `cb(null, false)`. Added `maxAge: 86400` preflight caching. |
| **CSRF Bypass via Subdomain Cookie Tossing** (SEC-004) | In `csrfCheck`, if `headerToken && cookieToken && safeCompare(headerToken, cookieToken)` matched, the request was accepted without validating against the server HMAC. An attacker on a sibling subdomain (e.g. `user-site.example.com`) could toss an arbitrary `csrf_token` cookie and send a matching header, bypassing CSRF validation completely. | Permitted arbitrary matching tokens between header and cookie. | Removed the bypass in `server/src/middleware/csrf.ts:68-85`. Enforced that `headerToken` MUST match `csrfTokenForSession(sessionId)`. If a `cookieToken` is provided, it must also match `csrfTokenForSession(sessionId)`, completely neutralizing tossed cookies. |
| **Forced Logout via Cross-Origin POST** (SEC-004) | `/api/auth/logout` was excluded from CSRF checks in `csrfCheck:23`, allowing attackers to forge cross-origin POST requests terminating user sessions. | Explicit exclusion in `csrfCheck`. | Removed `/api/auth/logout` from the bypass list. Logout now requires CSRF validation or valid origin verification. |
| **Cross-Origin Spoofing / Null Origin Exploitation** | Attackers use sandboxed iframes (`<iframe sandbox="...">`) or data URIs to generate `Origin: null`. | Null origin was not explicitly rejected. | `csrfCheck` and `fastifyCors` explicitly reject `Origin: 'null'`. |

---

## 3. Files Modified

1. `server/src/middleware/csrf.ts`: Enforced HMAC validation on all state-changing requests; removed the `headerToken === cookieToken` bypass; added Origin verification against allowed origins; removed `/api/auth/logout` from CSRF exclusion list.
2. `server/src/index.ts`: Replaced permissive CORS `origin: true` with strict origin allowlist callback; explicitly rejected `null` origins; configured preflight `maxAge: 86400`.
3. `server/src/routes/s12-csrf.test.ts`: Created regression test suite verifying SEC-003 and SEC-004 mitigations.
4. `server/src/routes/s11-cors.test.ts`: Updated CORS assertion to reflect SEC-003 allowlist enforcement.

---

## 4. Verification & Regression Tests

- **CSRF / CORS Test Suites (`server/src/routes/s12-csrf.test.ts` & `s11-cors.test.ts`):** 13/13 tests passing:
  - `rejects forged cookie-tossing attack where header matches cookie but not server HMAC (SEC-004)`.
  - `rejects state-changing request when cross-origin does not match allowlist`.
  - `allows state-changing request with valid HMAC token and matching/allowed origin`.
  - `protects /api/auth/logout from unauthorized cross-origin trigger (SEC-004)`.
  - `allows configured dev origins and sets Access-Control-Allow-Origin`.
  - `rejects untrusted third-party origins in CORS preflight (SEC-003)`.
  - `explicitly rejects null origin`.
  - `S11-03 helmet headers present on GET /health`.
  - `SEC-003 CORS allowlist: untrusted origin is blocked and allowed origin is permitted`.
  - `S11-02 CSRF missing token → 403 when csrf_token cookie present`.
  - `S11-02 CSRF with correct x-csrf-token → 201`.
  - `S11-02 login sets csrf_token cookie`.
  - `SEC-004: In production mode, CSRF fails closed if token missing`.
- **Full Project Regression Test Suites:**
  - `pnpm --filter server test`: 25 test files, 215/215 tests green.
  - `cargo test`: 124/124 tests green.

---

## 5. Acceptance Criteria Checklist

- [x] Permissive dev CORS wildcard reflection eliminated (SEC-003)
- [x] Preflight `maxAge: 86400` caching configured
- [x] Cookie-tossing arbitrary token bypass eliminated (SEC-004)
- [x] Forced logout via cross-origin POST neutralized (SEC-004)
- [x] Null origin explicitly rejected
- [x] Strict HMAC CSRF token verification enforced
- [x] Vulnerability register updated
- [x] `PLAN.md` updated

---

## 6. Next Phase Gate

- **Active Phase Status:** S12 COMPLETE.
- **Next Phase:** `SECURITY PHASE S13 — SSRF, WEBHOOK, & REMOTE FETCH SECURITY`
- **Scope:** DNS rebinding protection ([SEC-018](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-018--dns-rebinding-ssrf-in-remote-fetch-transport)), IP pinning in remote fetch transport, private/loopback/link-local address filtering, cloud metadata protection (`169.254.169.254`), and webhook delivery isolation.
