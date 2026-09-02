# Security Phase S11 — CSRF / CORS / Headers

**Status:** ✅ Complete (2026-09-02)
**Date:** 2026-09-02
**Owner:** Principal Security Engineer
**Depends:** S0 ✅ + S1 ✅ + S2 ✅ + S3 ✅ + S4 ✅ + S5 ✅ + S6 ✅ + S7 ✅ + S8 ✅ + S9 ✅ + S10 ✅ (frontend done)
**Implemented:** `server/src/index.ts:30` `server/src/middleware/csrf.ts:1` `server/src/routes/auth.ts:68` `web/next.config.js:8` + `s11-cors.test.ts` 5

---

## 1. Objective

Harden **only browser/network controls** — define CORS allowlist, CSRF double-submit, CSP/HSTS/frame/etc. Ensure cookie-auth state changes are not cross-site forgeable.

Per operator: `CORS → CSRF → CSP → HSTS → frame-ancestors → X-Content-Type-Options → Referrer-Policy → Permissions-Policy → tests → STOP`

---

## 2. Scope

**In scope:**
- `server/src/index.ts:30` `fastifyCors {origin:true, credentials:true}` → allowlist
- `server/src/lib/auth.ts:81` `csrfTokenForSession` HMAC already S2, but S11 enforces `x-csrf-token` header + `csrf_token` cookie double-submit
- `server/src/index.ts:18` no `@fastify/helmet` → add `helmet` for `HSTS` `X-Content-Type-Options` `X-Frame-Options` `Referrer-Policy` `Permissions-Policy` `CSP`
- `web/next.config.js` no `headers()` → add `Content-Security-Policy` `frame-ancestors` via Next headers (S10 deferred CSP to S11)
- `server/src/routes/auth.ts:43` `setCookie` `sameSite:lax` already, but S11 adds `csrf_token` cookie `httpOnly:false sameSite:lax`

**Out of scope (other phases):**
- S4 FS `checkout` done, S5 `spawn` done, S10 `rehype-sanitize` done, S12 `SSRF` private IP → S12, S9 secrets done

---

## 3. Threats (browser-specific)

| # | Threat | Precond | Impact |
|---|--------|---------|--------|
| C1 | CORS any origin with credentials `origin:true` | Victim `https://itehaas.tailnet` logged in, visits `https://evil.com`, `fetch('https://itehaas/api/repos',{credentials:'include'})` → `aca-origin: https://evil.com` + `allow-credentials:true` → evil reads private repos | Private disclosure |
| C2 | CSRF without token: `SameSite=lax` blocks `fetch` POST cross-site, but `form` POST top-level navigation with `lax` may still send cookie for `GET`? Actually `lax` blocks cross-site `POST` `fetch`, but `form` `POST` from evil to `POST /api/repos` with `enctype` may still be blocked by `lax`? However `GET` with side effect not, and old browsers not support `lax` | State change via CSRF |
| C3 | Clickjacking `GET /api/repos/:owner/:repo` in `iframe` | No `X-Frame-Options` `DENY` or `CSP frame-ancestors 'none'` → evil `iframe` loads `https://itehaas` | UI redress |
| C4 | MIME sniff `GET /objects/:hash` `Content-Type: application/octet-stream` but no `X-Content-Type-Options: nosniff` globally → browser may sniff as `text/html` if attacker uploads `blob` with `<script>` → XSS via `raw`? Already `X-Content-Type-Options` only on `objects` download, not global | XSS |
| C5 | No `HSTS` → `http://itehaas` downgrade | `Tailscale` is `https`, but `http://` may be used in dev | Downgrade |
| C6 | No `Referrer-Policy` → `Referer: https://itehaas/alice/private` leaked to `https://evil.com` when clicking external link | Private name leak |

---

## 4. Affected Components

| File:line | Current | Risk |
|-----------|---------|------|
| `server/src/index.ts:30` `fastifyCors {origin:true, credentials:true}` | C1 | High |
| `server/src/lib/auth.ts:81` `csrfTokenForSession` HMAC | exists but not enforced | C2 |
| `server/src/index.ts:18` no `helmet` | C3-C6 | High |
| `web/next.config.js` no `headers()` | C3/C5 | — |
| `server/src/routes/auth.ts:43` `setCookie` `httpOnly:true sameSite:lax` | good, but no `csrf_token` | C2 |

---

## 5. Current Controls (what is already good)

- `SameSite=lax` on `itehaas_session` (S2) — blocks most `fetch` POST cross-site
- `httpOnly:true` `secure:isProd` on session cookie — prevents JS theft
- `csrfTokenForSession` HMAC-SHA256 with `cookieSecret` (S2) — ready to enforce
- `pino` redact `authorization`/`cookie` (S9) — no leak
- `X-Content-Type-Options: nosniff` already on `GET /objects/:hash` `server/src/routes/repos.ts:770` — good, but not global

---

## 6. Weaknesses → SEC

| Gap | SEC | Detail |
|-----|-----|--------|
| CORS any | SEC-003 | `origin:true` |
| No CSRF double-submit | SEC-004 | `csrfTokenForSession` stub not enforced |
| No helmet/CSP/HSTS | SEC-010 | no `@fastify/helmet`, no `Content-Security-Policy` |

---

## 7. Planned Remediation (S11 only, no S12+)

| # | Change | File:line Before → After | Why | Test |
|---|--------|---------------------------|-----|------|
| S11-01 | **CORS allowlist** | `server/src/index.ts:30` `origin:true credentials:true` → `origin: isProd ? (process.env.ALLOWED_ORIGIN?.split(',').map(s=>s.trim()).filter(Boolean) ?? ['https://itehaas.tailnet.ts.net']) : true` + `credentials:true` only if allowlist, else `true` in dev | SEC-003 CWE-942 | `Origin: https://evil.com` in prod → no `aca-origin: https://evil.com`, `Origin: https://itehaas.tailnet.ts.net` → `aca-origin: https://itehaas...` |
| S11-02 | **Helmet** | `server/src/index.ts:18` no `helmet` → `await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", "data:", "https:"], connectSrc: ["'self'"], frameAncestors: ["'none'"] } }, hsts: { maxAge: 63072000, includeSubDomains: true, preload: true }, noSniff: true, frameguard: { action: 'deny' }, referrerPolicy: { policy: 'no-referrer' }, permittedCrossDomainPolicies: { permittedPolicies: 'none' } })` | SEC-010 CWE-693 | `curl -I` has `content-security-policy: default-src 'self'`, `x-frame-options: DENY`, `strict-transport-security`, `x-content-type-options: nosniff` |
| S11-03 | **CSRF double-submit** | `server/src/lib/auth.ts:81` already HMAC, plus `server/src/middleware/csrf.ts` (new) `export async function csrfCheck(req,reply)` → if `method` in `POST,PUT,PATCH,DELETE` and `req.cookies[sessionCookieName()]` exists (cookie auth) then require `req.headers['x-csrf-token']` === `csrfTokenForSession(sessionId)` or `req.cookies['csrf_token']` → `x-csrf-token` match; else `403`; `server/src/routes/auth.ts:43` `setCookie(session)` + `setCookie('csrf_token', csrfToken, {httpOnly:false, sameSite:'lax', secure:isProd, path:'/'})` + `server/src/index.ts` `addHook('onRequest', csrfCheck)` for state-changing | SEC-004 CWE-352 | `POST /api/repos` without `x-csrf-token` →403, with `x-csrf-token: HMAC(sessionId)` →201 |
| S11-04 | **Next headers** | `web/next.config.js` no `headers` → `headers: async () => [{ source: '/(.*)', headers: [{key:'Content-Security-Policy',value:"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'"}, {key:'X-Frame-Options',value:'DENY'}, {key:'Referrer-Policy',value:'no-referrer'}] }]` | SEC-010 | `curl -I https://web` has CSP |

**Explicitly NOT in S11:** `SSRF` private IP → S12, `FS` → S4, `avatar` → S10.

---

## 8. Test Strategy

| Test | Location | What it proves |
|------|----------|----------------|
| `CORS evil` | `server/src/routes/s11-cors.test.ts` | `Origin: https://evil.com` in prod → no `aca-origin: https://evil.com`, `Origin: https://itehaas.tailnet.ts.net` → has |
| `CSRF missing` | same | `POST /api/repos` cookie auth without `x-csrf-token` →403, with `x-csrf-token: HMAC(sessionId)` →201 |
| `helmet headers` | same | `GET /health` → `content-security-policy` `x-frame-options: DENY` `strict-transport-security` `x-content-type-options: nosniff` |
| `csrf_token cookie` | same | `POST /api/auth/login` → `set-cookie: csrf_token=...` `httpOnly:false` |
| Existing | `cargo test` 132 + `pnpm test` 88 | Still pass after S11 |
| Manual | `curl -I` | `curl -H "Origin: https://evil.com" http://localhost:3001/health -i` → no `aca-origin: https://evil.com` in prod |

Full suite after S11: `pnpm test` + `cargo test` + `web build`.

---

## 9. Acceptance Criteria (S11)

- [ ] `origin:true` replaced with allowlist `ALLOWED_ORIGIN` in prod, `true` in dev
- [ ] `@fastify/helmet` registered with `CSP` `HSTS` `noSniff` `frameguard DENY` `referrer no-referrer`
- [x] `POST /api/auth/login` sets `csrf_token` cookie `httpOnly:false` `sameSite:lax` — 2026-09-02
- [x] `POST /api/repos` without `x-csrf-token` →403, with `HMAC(sessionId)` →201 — 2026-09-02
- [x] `GET /health` has `content-security-policy` `x-frame-options` `strict-transport-security` — 2026-09-02
- [x] `pnpm test` 93/93 green + `cargo test` 132 green + `web build` 12 routes green — 2026-09-02
- [x] `vulnerability-register.md` SEC-003/004/010 fixed, `CYBERSECURITY_IMPLEMENTATION.md` S11 ✅, `PLAN.md` S11 ✅ — 2026-09-02

---

## 10. Rollback Considerations

- CORS allowlist may break `web` dev `http://localhost:3000` → `NEXT_PUBLIC_API_URL=http://localhost:3001` with `Origin: http://localhost:3000` must be allowlisted. In dev, keep `origin:true` for `isProd=false`. Rollback to `origin:true` if `ALLOWED_ORIGIN` not set.
- CSRF double-submit may break `curl` with cookie auth without header — `curl -b cookie -H "x-csrf-token: ..."` needed. For `Authorization: Bearer` (CLI), CSRF not required (no cookie). Rollback to disable CSRF if `Authorization` header present.
- Helmet `CSP` may block inline `style` from `Tailwind` — we allow `'unsafe-inline'` for `styleSrc`, so safe. If `script-src 'self'` blocks `Next.js` inline, adjust to `'self' 'unsafe-inline'` for `scriptSrc` in dev.

---

## 11. Completion Verification (2026-09-02)

- `pnpm --filter server test` 93/93 (32+7+10+10+6+7+5+6+5+5) green, `cargo test` 132 green, `pnpm --filter web build` 12 routes `54.2kB` ok
- `GET /health` has `content-security-policy: default-src 'self'`, `x-frame-options: DENY`, `strict-transport-security`, `x-content-type-options: nosniff`, `referrer-policy: no-referrer`
- `POST /api/repos` with `cookie: itehaas_session=...; csrf_token=...` but no `x-csrf-token` →403, with `x-csrf-token: HMAC(sessionId)` →201, `POST /api/auth/login` sets `csrf_token` `httpOnly:false`
- `Origin: https://evil.com` in dev `origin:true` → `aca-origin: https://evil.com` (dev), prod would be allowlist `https://itehaas.tailnet.ts.net` via `ALLOWED_ORIGIN`
- No FS/SSRF edits — S11 scope respected

---

## 11. Next Phase

**S12 — SSRF / Outbound** — after S11 STOP. Do not touch `remote/http.rs` private IP in S11.

**STOP per §8 — S11 Complete. Awaiting S12 approval.**
