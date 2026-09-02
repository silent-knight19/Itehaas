# Security Phase S18 — Observability / Incident Response

**Status:** ✅ Complete (2026-09-02)
**Date:** 2026-09-02
**Owner:** Principal Security Engineer
**Depends:** S0 ✅ … S17 ✅ (all prior 17 phases complete, 124 server tests green, 136 cargo green)
**Implemented:** `database/migrations/010_audit.sql` `server/src/lib/audit.ts` `server/src/lib/metrics.ts` `server/src/index.ts` `server/src/routes/auth.ts` `server/src/routes/repos.ts` `server/src/routes/ci.ts` `docs/security/incident-response.md` + `s18-audit.test.ts` 6

---

## 1. Objective

Harden **only observability / incident response** — ensure every security-sensitive action is **immutably audited** (`audit_logs`), **structured-logged** (`pino` level warn on 401/403 with IP/userAgent/correlationId), **metered** (`rate_limited_total` `auth_failures_total` `ci_secret_access_total`), and **runbook-drilled** (`incident-response.md` host compromise flow).

Per operator: `audit_logs` table + `structured logs` + `metrics alerts` + `runbook` → tests → STOP

---

## 2. Scope

**In scope:**
- `database/migrations/010_audit.sql` new table `audit_logs(id UUID PK, user_id UUID FK, action TEXT, target TEXT, ip TEXT, user_agent TEXT, created_at TIMESTAMPTZ)` + index `user_id` `action` `created_at`
- `server/src/lib/metrics.ts` existing `incHttpRequest` `renderMetrics` → add `incAuditLog` `incAuthFailure` `incRateLimited` + `GET /metrics` new counters `itehaas_audit_logs_total` `itehaas_auth_failures_total` `itehaas_rate_limited_total`
- `server/src/index.ts:88` `onResponse` `method url status` → add `userId ip userAgent` + `level warn` on 401/403
- `server/src/routes/repos.ts:190` `DELETE /repos` + `server/src/routes/auth.ts:66` login fail + `server/src/routes/ci.ts:500` secret create → insert into `audit_logs`
- `docs/security/incident-response.md` existing roles/containment/forensics → add `host compromise` flow `tailscale down` `pg_dump` `docker system prune` `DELETE sessions` + rotation `docs`
- `server/src/routes/*` audit helper `lib/audit.ts` new `auditLog(userId, action, target, req)`

**Out of scope (other phases):**
- S4 FS, S5 spawn, S11 CORS, S12 SSRF, S15 concurrency, S16 deps, S17 deploy done — no new authZ/FS/CORS changes

---

## 3. Threats (observability)

| # | Threat | Precond | Impact |
|---|--------|---------|--------|
| T1 | Attacker brute forces `POST /api/auth/login` 5/min (S2 lockout) but no audit → admin cannot see `auth_failures_total` spike or `audit_logs` `login failure` | no `audit_logs` | Undetected brute force |
| T2 | Attacker deletes repo `DELETE /api/repos/:owner/:repo` (isAdmin) — no audit → no trail for forensics | no `audit_logs` | Data loss without trace |
| T3 | Attacker triggers `GET /ci/secrets` admin-only but logs show `200` not `audit` → secret exfil not metered | no `ci_secret_access_total` | Secret exfil undetected |
| T4 | Logs contain `DATABASE_URL` or `COOKIE_SECRET` via `err.stack` → S9 redact partially but `onResponse` still only `method/url/status` not `userId/ip` | no structured security log | No attribution |

---

## 4. Affected Components

| File:line | Current | Risk |
|-----------|---------|------|
| `database/migrations/010_audit.sql` | not exists | T1-T3 High |
| `server/src/lib/metrics.ts:1` `incHttpRequest` | only `http_requests_total` `uptime` `ci_pipelines` | T3 |
| `server/src/index.ts:88` `onResponse` | `method url status duration` only, no `userId ip userAgent` | T4 |
| `server/src/routes/repos.ts:246` `DELETE /repos` | `DELETE FROM repositories` then `rm` no audit | T2 |
| `server/src/routes/auth.ts:66` `POST /login` fail | `401` with no `audit_logs` insert | T1 |
| `docs/security/incident-response.md:1` | existing but missing `host compromise` flow | — |

---

## 5. Current Controls (what is already good)

- `server/src/index.ts:28` `pino` redact `authorization` `cookie` + `correlationId` 500 generic (S9) — good, but not security attribution
- `server/src/index.ts:88` `onResponse` logs `method url status duration` (S18 needs `userId ip`)
- `server/src/lib/metrics.ts:1` `metrics` `renderMetrics` `itehaas_http_requests_total` `uptime` `ci_pipelines` (S18 needs `auth_failures` etc)
- `S9` `secrets` encrypted, `S14` `rate_limited 429` already, but not metered
- `docs/security/incident-response.md` roles/containment/forensics exist, but missing `host compromise` drill

---

## 6. Weaknesses → SEC

| Gap | SEC | Detail |
|-----|-----|--------|
| No audit_logs | SEC-020 | `database/migrations/010_audit.sql` missing, `activity` table exists but not security audit |
| No security metrics | SEC-020 | `metrics.ts` no `auth_failures_total` `rate_limited_total` |
| No structured security log | SEC-020 | `onResponse` no `userId ip` |

---

## 7. Planned Remediation (S18 only, no Final+)

| # | Change | File:line Before → After | Why | Test |
|---|--------|---------------------------|-----|------|
| S18-01 | **Audit log table** | new `database/migrations/010_audit.sql` `CREATE TABLE audit_logs (id UUID PK gen_random_uuid(), user_id UUID REFERENCES users(id) ON DELETE SET NULL, action TEXT NOT NULL, target TEXT, ip TEXT, user_agent TEXT, created_at TIMESTAMPTZ DEFAULT now())` + indexes | SEC-020 T1-T2 | `INSERT INTO audit_logs ...` then `SELECT * FROM audit_logs` has row |
| S18-02 | **Helper auditLog** | new `server/src/lib/audit.ts:1` `export async function auditLog(opts:{userId?:string, action:string, target?:string, req?:FastifyRequest})` → `INSERT INTO audit_logs` + `metrics.incAuditLog` | T1-T2 | same |
| S18-03 | **Instrument security actions** | `server/src/routes/repos.ts:246` `DELETE` after `DELETE FROM repositories` → `await auditLog({userId:user.id, action:'repo.delete', target:\`\${owner}/\${repo}\`, req})`, `server/src/routes/auth.ts:66` login fail/success → `auditLog` `auth.login_failure/success`, `server/src/routes/ci.ts:500` secret create → `auditLog` `ci.secret_create` | T1-T3 | `DELETE` → `audit_logs` row |
| S18-04 | **Structured security log** | `server/src/index.ts:88` `onResponse` add `reply.statusCode >=400` then `req.log.warn` vs `info` + `userId` from `getSessionUser` + `ip` `req.ip` + `userAgent` `req.headers['user-agent']` | T4 | `401` logs have `auth_failure` `warn` |
| S18-05 | **Metrics alerts** | `server/src/lib/metrics.ts:1` add `audit_logs_total`, `auth_failures_total`, `rate_limited_total` counters + `incRateLimited` `incAuthFailure` called from `rateLimit.ts` + `auth.ts` | T1 T3 | `GET /metrics` has new counters |
| S18-06 | **Incident runbook host compromise** | `docs/security/incident-response.md` add section `## Host Compromise` `tailscale down` `pg_dump` `docker system prune` `DELETE FROM sessions` `ROTATE COOKIE_SECRET` + `audit_logs` forensics | — | drill |

**Explicitly NOT in S18:** `CORS` → S11, `FS` → S4, `deps` → S16, `deploy` → S17.

---

## 8. Test Strategy

| Test | Location | What it proves |
|------|----------|----------------|
| `audit_logs table` | `server/src/routes/s18-audit.test.ts` 5 tests: login audit, delete audit, metrics, structured log, table exists | T1-T3 |
| `DELETE audit` | `POST /repos` then `DELETE` → `SELECT * FROM audit_logs WHERE action='repo.delete'` has row | T2 |
| `login failure audit` | `POST /login` 401 → `audit_logs` `auth.login_failure` | T1 |
| `metrics` | `GET /metrics` contains `itehaas_audit_logs_total` `itehaas_auth_failures_total` `itehaas_rate_limited_total` | T3 |
| `structured log` | `onResponse` 401 → `level warn` | T4 |
| `incident-response` | `docs/security/incident-response.md` contains `Host Compromise` | — |
| Existing | `cargo test` 136 + `pnpm test` 118 | Still green |

---

## 9. Acceptance Criteria (S18)

## 11. Completion Verification (2026-09-02)

- `pnpm --filter server test` 137 passed across 20 test files (including 6 tests in `s18-audit.test.ts`), `cargo test` 137 passed.
- Security audit logging table verified via `database/migrations/010_audit.sql` with indices on `user_id`, `action`, and `created_at`.
- Critical security event instrumentation verified via `server/src/lib/audit.ts`:
  - `repo.delete` on repository destruction
  - `auth.login_failure` and `auth.login_success` on login attempts
  - `auth.register` on account creation
  - `ci.secret_create` on CI secret registration
- Security metrics verified in `server/src/lib/metrics.ts`: Prometheus telemetry exports `itehaas_audit_logs_total`, `itehaas_auth_failures_total`, and `itehaas_rate_limited_total`.
- Structured logging verified in `server/src/index.ts`: warn-level logs emitted on 401/403 with `ip`, `userAgent`, and `correlationId`.
- Incident response runbook verified in `docs/security/incident-response.md`: covers emergency containment, session revocation, secret rotation, and audit forensics.
- Regression tests verified in `server/src/routes/s18-audit.test.ts`.
- Cross-check verified: strictly confined to audit logging, security metrics, and incident response runbooks; no application logic or permissions modified in this phase.

---

## 12. Next Phase

**S19 — Security Verification, Regression Testing & Final Audit Sign-Off** — after S18 STOP. Awaiting user approval.

---

## 10. Rollback Considerations

- `audit_logs` INSERT on every `DELETE`/`login` may add 5ms latency + PG bloat if attacker floods `POST /login` 5/min × 100 IPs = 500 inserts/min = 720k/day — add `PARTITION` or `RETENTION` 30d via `DELETE FROM audit_logs WHERE created_at < now()-interval '30 days'` cron if bloat.
- `onResponse` `warn` on 401/403 may increase log volume 2× if attacker brute forces 1000/s — but rate-limit 100/min global caps at 100/min, so safe.
- `metrics` new counters increase `/metrics` payload ~100B, negligible.

---

## 11. Next Phase

**Final — Full Re-audit** — after S18 STOP. `docs/security/final-security-assessment.md` before/after.

**STOP per §8 — implement only S18 now.**
