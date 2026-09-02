# Security Phase S2 — Authentication Hardening

**Status:** ✅ Complete  
**Date:** 2026-09-02  
**Owner:** Principal Security Engineer  
**Scope:** Password policy enforcement, common password blacklist, timing attack equalization, brute-force account lockout, session invalidation, password change with re-authentication, session revocation on credential updates, safe CSRF token derivation, and mitigation of email invite interception (SEC-024).

---

## 1. Objective

Harden the authentication subsystem against credential stuffing, brute-force attacks, timing enumeration, session fixation, unrevoked session persistence following password changes, and account takeover of pending email invitations.

---

## 2. Threat Analysis & Defensive Matrix

| Threat | Attack Path | Previous State | Implemented Control (S2) |
|---|---|---|---|
| **Pending Email Invite Interception** (SEC-024) | Attacker registers with victim's email address (`victim@company.com`) and calls `GET /api/invites` to harvest pending invite tokens for private repos/orgs. | `GET /api/invites` searched `WHERE (invited_user_id = $1 OR email = $2)` and exposed secret tokens. | Scoped `GET /api/invites` strictly to `WHERE invited_user_id = $1`. Secret tokens for email invites are delivered out-of-band and cannot be intercepted by unverified registrations. |
| **Persistent Compromised Sessions After Password Change** | Attacker steals a session cookie or token; victim notices and changes their password, but attacker's session remains active. | No password change route existed; sessions were never revoked on credential updates. | Implemented `POST /api/auth/password` which requires re-authentication (`currentPassword`), updates hash, and executes `DELETE FROM sessions WHERE user_id = $1 AND id != $currentSessionId`. |
| **Lack of Emergency Session Revocation** | User suspects compromised credentials or lost device; cannot terminate active sessions remotely. | Only single-session logout existed (`DELETE FROM sessions WHERE id = $1`). | Implemented `POST /api/auth/sessions/revoke-all` to immediately invalidate all sessions for the user across all devices. |
| **Common / Trivial Passwords** | Users register with weak, guessable passwords like `password123` or `12345678`. | Only length check (min 8 chars) existed. | Added `COMMON_PASSWORDS` blacklist in `validatePassword` blocking trivial passwords. |
| **Session ID Leakage in CSRF Fallback** | `csrfTokenForSession` catch block fell back to base64url encoding the session ID. | Catch block returned `Buffer.from(sessionId).toString('base64url').slice(0, 32)`. | Replaced fallback with cryptographically secure random bytes (`crypto.randomBytes(24)`), preventing session ID leakage. |
| **Timing Attack on Login** | Attacker measures response time to distinguish valid usernames from non-existent users. | Pre-computed Argon2id dummy hash used for non-existent users. | Verified timing equalization takes ~90ms for both valid and non-existent users; generic 401 error message returned. |
| **Account Brute-Force & Credential Stuffing** | Attacker floods login attempts for a targeted username. | Lockout threshold at 5 failed attempts locks `ip:username` for 15 minutes. | Verified with automated tests; rate limiting and lockout return HTTP 429 with `Retry-After`. |

---

## 3. Files Modified

1. `server/src/lib/auth.ts`: Added `COMMON_PASSWORDS` blacklist to `validatePassword` and secured `csrfTokenForSession` against session ID leakage.
2. `server/src/routes/auth.ts`: Added `POST /api/auth/password` (re-authentication, validation, hash update, session revocation) and `POST /api/auth/sessions/revoke-all`.
3. `server/src/routes/invites.ts`: Scoped `GET /api/invites` strictly to `invited_user_id = $1`, resolving SEC-024.
4. `server/src/routes/auth-s2.test.ts`: Added 8 new regression tests covering password change, session revocation, common password rejection, and SEC-024 invite scoping.

---

## 4. Verification & Regression Tests

- **Unit & Integration Tests:** 16/16 tests passing in `server/src/routes/auth-s2.test.ts`:
  - `SEC-005`: Login rate limit 5/min per IP -> 6th returns 429
  - `SEC-005`: Register rate limit 3/min per IP -> 4th returns 429
  - `SEC-005`: Brute-force lockout: 5 failed attempts locks user+IP for 15 minutes (returns 429 + Retry-After)
  - `SEC-005`: Successful login resets failed attempts counter
  - `SEC-005`: Register returns generic 409 (`username or email taken`) on collision
  - `SEC-005`: Dummy hash verification takes ~90ms for timing equalization
  - `SEC-005`: Argon2id parameters verify memory cost 65536, time cost 3, parallelism 1
  - `SEC-005`: Cookies set with `httpOnly: true`, `sameSite: 'lax'`, 30-day expiry
  - `SEC-005`: TrustProxy ensures separate client IPs do not collide on rate limits
  - `S2`: `validatePassword` rejects common weak passwords (`password123`, `qwertyuiop`, `12345678`)
  - `S2`: `csrfTokenForSession` never leaks raw `sessionId` bytes
  - `S2`: `POST /api/auth/password` requires authentication (401 without cookie)
  - `S2`: `POST /api/auth/password` fails with incorrect current password (401)
  - `S2`: `POST /api/auth/password` rejects weak new password or same password (400)
  - `S2`: `POST /api/auth/password` updates password hash and revokes all other sessions
  - `S2`: `POST /api/auth/sessions/revoke-all` terminates all sessions and clears cookies
  - `SEC-024`: `GET /api/invites` strictly scopes to `invited_user_id = $1` (no email harvesting)
- **Project Test Suite:**
  - `pnpm --filter server test`: 21 test files, 170/170 passed.
  - `cargo test`: 122/122 passed.

---

## 5. Acceptance Criteria Checklist

- [x] Password hashing parameters verified (Argon2id, 64M, t=3, p=1)
- [x] Timing equalization active on non-existent users
- [x] Account lockout active after 5 failed login attempts
- [x] Password change endpoint with mandatory re-authentication implemented
- [x] Password change automatically revokes all other active sessions
- [x] Revoke-all sessions endpoint implemented
- [x] SEC-024 email invite interception mitigated
- [x] Vulnerability register updated (SEC-024 mitigated)
- [x] `PLAN.md` updated

---

## 6. Next Phase Gate

- **Active Phase Status:** S2 COMPLETE.
- **Next Phase:** `SECURITY PHASE S3 — AUTHORIZATION, IDOR, & BOLA DEFENSE`
- **Scope:** Universal team repository takeover ([SEC-006](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-006--universal-repository-takeover-via-organization-team-attachment)), cross-tenant filesystem remote exfiltration ([SEC-007](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-007--cross-tenant-private-repository-exfiltration-via-filesystem-remotes)), cross-repository issue modification ([SEC-011](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-011--bola--cross-repository-unauthorized-issue-modification)), pull request reviewer deletion ([SEC-012](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-012--missing-authorization-on-pull-request-reviewer-deletion)), collaborator deletion restrictions ([SEC-022](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-022--over-privileged-repository-collaborator-admin-deletion)), and public issue reporting ([SEC-023](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-023--over-restrictive-issue-creation-permission-breaks-public-collaboration)).
