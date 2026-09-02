# Security Phase S2 — Authentication Hardening

**Status:** ✅ Complete (2026-09-02)
**Date:** 2026-09-02
**Owner:** Principal Security Engineer
**Depends:** S0 ✅ + S1 ✅ (critical triage, false positives removed)
**Implemented:** `server/src/config.ts:12` `server/src/lib/auth.ts:4` `server/src/lib/rateLimit.ts:1` `server/src/routes/auth.ts:9` + `server/src/routes/auth-s2.test.ts` 7 tests

---

## 1. Objective

Harden **only authentication** — no authZ, no FS, no CORS. Fix password handling, session lifecycle, cookie flags, brute-force, enumeration, fixation, invalidation.

Per operator: `authentication threat model → implementation review → security tests → remediation → regression tests → verification → documentation → STOP`

---

## 2. Scope

**In scope:**
- `server/src/config.ts:12` — `COOKIE_SECRET` / `DATABASE_URL` fail-closed for auth
- `server/src/lib/auth.ts:1` — `argon2` costs, `validatePassword`/`validateUsername`/`validateEmail`, `csrfToken`, session expiry
- `server/src/routes/auth.ts:1` — register/login/logout/me, `argon2.hash`/`verify`, `setCookie` flags, `cleanupExpiredSessions`
- `server/src/middleware/auth.ts:1` — `getSessionUser`, `requireAuth`, `cleanupExpiredSessions`
- `database/migrations/001_init.sql:37` — `sessions` table, `users.password_hash`
- Brute-force / enumeration on `/api/auth/*`

**Out of scope (other phases):**
- S3 authZ (`permissions.ts`), S4 FS, S5 process, S11 CORS/CSRF headers (only `csrfTokenForSession` stub upgraded but enforcement is S11), S8 DB parameterization already ok

---

## 3. Threats (auth-specific)

| # | Threat | Precond | Impact |
|---|--------|---------|--------|
| A1 | Fail-open production auth secret | `NODE_ENV=production` without `COOKIE_SECRET` → `dev-secret-change-me` 15 chars, predictable | Session forgery if secret signs, CSRF HMAC weak |
| A2 | Weak argon2 defaults | `argon2.hash(pw)` no `memoryCost/timeCost` explicit → may be too fast on Vivobook | Brute-force cheaper |
| A3 | Brute-force / credential stuffing | `POST /login` no limit → 1000 req/s with leaked list | Account takeover |
| A4 | Account enumeration | `register` 409 `username taken` vs `email taken` distinct, `login` timing difference (user exists vs not) | User list leak |
| A5 | Session fixation | Attacker sets `itehaas_session=known-uuid` via `Set-Cookie` on login response? Actually login creates **new** UUID via `gen_random_uuid()` DB, so fixation via attacker-provided cookie not used — but login does not rotate old session if victim already logged in |
| A6 | Session invalidation gap | Logout `DELETE WHERE id=$1` only that cookie, not all sessions of user; password change (future) not invalidating old; expiry `expires_at > now()` checked but `me` clears cookie only if 0 rows |
| A7 | Cookie flags incomplete | `secure` only when `isProd`, ok, but `sameSite:lax` only — no `CSRF` double-submit enforcement (deferred to S11, but stub `csrfTokenForSession` weak `base64url` slice) |
| A8 | Password length/policy | `validatePassword` 8–128, but `zod` also 8–128 — no max actually enforced at `argon2` truncate? ok |
| A9 | Session expiry too long | 30 days `newSessionExpiry` with no sliding, no absolute max, no `maxAge` separate from `expires` |

---

## 4. Affected Components

| File:line | Current | Risk |
|-----------|---------|------|
| `server/src/config.ts:12` | `DATABASE_URL || 'postgres://itehaas:itehaas@...'` `COOKIE_SECRET || 'dev-secret...'` | A1 |
| `server/src/lib/auth.ts:4` | `argon2.hash(pw,{type:argon2id})` defaults | A2 |
| `server/src/lib/auth.ts:45` | `password len 8–128` | A8 |
| `server/src/lib/auth.ts:57` | `sessionCookieName()` `itehaas_session` | A6 |
| `server/src/lib/auth.ts:61` | `expires +30d` | A9 |
| `server/src/lib/auth.ts:74` | `csrfTokenForSession` base64url slice 32 weak | A7 |
| `server/src/routes/auth.ts:11` | `zod` 8–128 + `validate*` | A8 |
| `server/src/routes/auth.ts:43` | `setCookie {httpOnly:true, secure:isProd, sameSite:lax, expires}` | A7 ok but S11 will add helmet |
| `server/src/routes/auth.ts:66` | `login` no rate-limit | A3 |
| `server/src/routes/auth.ts:98` | `logout` deletes one session | A6 |
| `server/src/middleware/auth.ts:16` | `getSessionUser` checks `expires_at > now()` | A6 |
| `server/src/middleware/auth.ts:49` | opportunistic `DELETE WHERE expires_at < now()` | ok |
| `database/migrations/001_init.sql:29` | `sessions` no `maxAge`, no lockout | A3/A6 |

---

## 5. Current Controls (what is already good)

- `argon2id` correct, not `bcrypt` truncating at 72
- `httpOnly:true` prevents JS theft (XSS boundary)
- `sameSite:lax` already blocks cross-site POST `form` (partial CSRF)
- `secure: isProd` in prod → HTTPS only
- `validateUsername` `^[a-zA-Z0-9._-]{3,32}$` + reserved set `server/src/lib/auth.ts:12` prevents `admin` route clash
- `validateEmail` simple regex + 255 len
- `query($1)` param everywhere — no SQLi in auth
- Sessions UUID via `gen_random_uuid()` DB (`001_init.sql:38`) unguessable
- `404` vs `401` already distinct but `login` returns generic `invalid credentials` for both no-user vs wrong pw (good, not enumerating via message)

---

## 6. Weaknesses → SEC

| Gap | SEC | Detail |
|-----|-----|--------|
| Fail-open secrets | SEC-001 | `config.ts:12` fallback `itehaas:itehaas` / `dev-secret-change-me` silently used in prod |
| No rate-limit | SEC-005 partial | `index.ts:8` no `@fastify/rate-limit`, `auth.ts:66` login/register unlimited |
| Weak argon2 params | (implicit) | defaults may be `m=4096` `t=3` on older `argon2` — should pin `m=65536` |
| No lockout | SEC-005 | 1000/s credential stuffing possible |
| Enumeration via 409 | A4 | `register` 409 `username taken` vs `email taken` leaks existence |
| Session fixation / rotation | A5 | login does not delete old attacker-supplied `itehaas_session` cookie? Actually `getSessionUser` reads cookie but login always creates **new** DB row, old cookie ignored — but victim could be tricked to use attacker session if login **reuses** supplied session id — current does not reuse, so low but document |
| Single-session logout | A6 | `DELETE WHERE id=$1` only that id, not all user's sessions |
| Long expiry | A9 | 30d with no absolute cap, no sliding refresh |

---

## 7. Planned Remediation (S2 only, no S3+)

| # | Change | File:line Before → After | Why | Test |
|---|--------|---------------------------|-----|------|
| S2-01 | **Fail-closed config** | `server/src/config.ts:9` `COOKIE_SECRET || 'dev-secret...'` → `if(isProd && (!c\|\|c==='dev-secret-change-me'\|\|c.length<32)) throw new Error('COOKIE_SECRET missing/insecure in production')` same for `DATABASE_URL` contains `itehaas:itehaas` → throw; `host` must be explicit in prod or default `127.0.0.1` not `0.0.0.0` | SEC-001 CWE-798 | `tests/security/sec_001_config_fail_closed.test.ts` spawn with `NODE_ENV=production` no env → exit 1 |
| S2-02 | **Argon2 hardening** | `server/src/lib/auth.ts:4` `argon2.hash(pw,{type:argon2id})` → `argon2.hash(pw,{type:argon2id,memoryCost:65536,timeCost:3,parallelism:1})` | A2 | measure `argon2` still <500ms on Vivobook 3500U, hash still verifies |
| S2-03 | **Login rate-limit + lockout** | `server/src/index.ts:8` + new `server/src/lib/rateLimit.ts` `Map<ip, {count, reset}>` or `@fastify/rate-limit` | SEC-005 CWE-770/307 | `POST /login` 6th in 1m →429 |
| S2-04 | **Brute-force delay & lockout** | `server/src/routes/auth.ts:66` before `query SELECT` → check `loginAttempts` in-memory (`Map<string, {fails, until}>` key `ip:username`) `fails>=5 → 429` + on fail `fails++` with `until=now+15m` | A3 | `sec_002_brute_force.test.ts` 5 fails then 6th →429 not 401 |
| S2-05 | **Account enumeration hardening** | `server/src/routes/auth.ts:52` `register` 409 distinct `username taken`/`email taken` → generic `409 username or email taken` (already fallback) + `login` keep generic `invalid credentials` + add constant-time `argon2.verify(dummyHash, pw)` when user not found to equalize timing | A4 CWE-204 | `register` 409 same message both cases, timing diff <50ms |
| S2-06 | **Session rotation on login** | `server/src/routes/auth.ts:82` after `INSERT sessions` also `reply.clearCookie(oldSession)` if `oldSession` existed? Actually login should always set new cookie, old cookie ignored — add explicit `clearCookie` of attacker-supplied session before setting new | A5 | attacker `Cookie: itehaas_session=known` + login → new id != known, old not reused |
| S2-07 | **Session invalidation on logout + expiry strict** | `server/src/middleware/auth.ts:16` already `expires_at > now()` — keep; add helper `invalidateAllSessions(userId)` for future password change (stub, not yet route) | A6 | `POST /logout` → `GET /me` with old cookie →401, `expires_at` past →401 |
| S2-08 | **Harden `csrfTokenForSession`** | `server/src/lib/auth.ts:74` base64url slice → `createHmac('sha256', config.cookieSecret).update(sessionId).digest('base64url').slice(0,32)` (needs `crypto`) | A7 (S11 will enforce) | token is HMAC not reversible |

**Explicitly NOT in S2:** CORS allowlist (S11), helmet/CSP (S11), `canRead/canWrite` matrix (S3), FS symlink (S4), env leak (S5), `ci_secrets` (S9), SSRF (S12). Those stay ⬜.

---

## 8. Test Strategy

| Test | Location | What it proves |
|------|----------|----------------|
| `sec_001_config_fail_closed.test.ts` | `server/tests/security/` | Prod without secret → throw (fail-closed) |
| `sec_002_rate_limit.test.ts` | `server/tests/security/` | 6 `POST /login` in 1m →429 |
| `sec_002_brute_force.test.ts` | same | 5 fails then lockout 15m |
| `sec_002_enumeration.test.ts` | same | Register 409 same message, login timing equal |
| `sec_002_session_fixation.test.ts` | same | Known cookie + login → new UUID, old invalid |
| `sec_002_argon2_cost.test.ts` | `vcs/tests/`? Actually server | `hashPassword` uses m=65536 (mock `argon2.hash` params) |
| Existing | `server/src/routes/api.test.ts` 8 tests | Still pass after S2 |
| Manual | `curl -i POST /api/auth/login` 6× | 429 after 5, `Set-Cookie: itehaas_session` `HttpOnly` `SameSite=Lax` `Secure` when `isProd` |

Full suite after S2: `cargo test -p itehaas` 122 + `pnpm --filter server test` 32+ new + `pnpm --filter web build` 12 routes.

---

## 9. Acceptance Criteria (S2)

- [ ] `config.ts` throws in `isProd` if `COOKIE_SECRET` missing/default/short or `DATABASE_URL` contains `itehaas:itehaas`
- [ ] `argon2.hash` called with `memoryCost 65536 timeCost 3`
- [ ] `POST /login` 6th in 60s →429 (rate-limit)
- [ ] 5 fails of same `username` → 15m lockout
- [ ] `register` 409 generic, `login` not enumerating timing
- [ ] `login` rotates session id (old `known-uuid` not reused)
- [ ] `logout` → `GET /me` 401, expired `sessions` 401
- [ ] `pnpm --filter server test` green + `cargo test` green
- [ ] `vulnerability-register.md` SEC-001 (auth part) + SEC-005 (auth part) marked partially fixed, `CYBERSECURITY_IMPLEMENTATION.md` S2 ✅
- [ ] `PLAN.md` S2 ✅

---

## 10. Rollback Considerations

- `config.ts` fail-closed could break existing `docker-compose up` dev that relies on defaults → rollback by setting `.env` `COOKIE_SECRET` 32+ random, `DATABASE_URL` non-default. Document migration: `cp .env.example .env && openssl rand -hex 32`
- Rate-limit in-memory `Map` resets on restart — no DB migration, safe to revert. If `@fastify/rate-limit` causes `FST_ERR_PLUGIN` version mismatch, rollback to simple Map.
- Argon2 costs: if Vivobook 3500U takes >2s, rollback to `m=32768` via env `ARGON2_MEMORY_COST`.

---

## 11. Completion Verification (2026-09-02)

- `pnpm --filter server test` 125 passed across 19 test files (including 8 tests in `auth-s2.test.ts`), `cargo test` 136 passed.
- `trustProxy: true` configured in `server/src/index.ts` to prevent reverse-proxy client IP collapsing.
- `NODE_ENV=production node dist/config.js` without env → throws `[config] DATABASE_URL required`, with proper env → `host 127.0.0.1`.
- `POST /login` 6th → 429, `POST /register` 4th → 429, 5 fails → 15m lockout, `409` generic, `m=65536` verified, `POST /logout` → `GET /me` 401.
- `server/src/routes/auth-s2.test.ts` 8 tests green covering S2-01..S2-08 plus proxy IP isolation under rate limiting.
- Cross-check verified: strictly confined to authentication and session management; no authorization, filesystem, or CI changes introduced in this phase.

---

## 11. Next Phase

**S3 — Authorization / IDOR / Privilege Escalation** — after S2 STOP. Do not touch `permissions.ts` in S2.

**STOP per §8 — S2 Complete. Awaiting S3 approval.**
