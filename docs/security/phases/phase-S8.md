# Security Phase S8 — Database / SQL Security

**Status:** ✅ Complete (2026-09-02)
**Date:** 2026-09-02
**Owner:** Principal Security Engineer
**Depends:** S0 ✅ + S1 ✅ + S2 ✅ + S3 ✅ + S4 ✅ + S5 ✅ + S6 ✅ + S7 ✅ (DoS done)
**Implemented:** `server/src/routes/repos.ts:158` `server/src/db/index.ts:4` + `s8-db.test.ts` 5

---

## 1. Objective

Harden **only PostgreSQL** — ensure every query is parameterized, authorized, transactionally correct, and not prone to injection, with proper timeouts and least privilege.

Per operator: `SQL parameterization → dynamic SQL → transactions → authorization → migrations → credentials → exposure`

---

## 2. Scope

**In scope:**
- `server/src/db/index.ts:4` `Pool` `max:10` `idleTimeout` `query(text, params)` + `getClient` + `ping` + `statement_timeout`
- Every `query(` `getClient().query(` in `server/src/routes/*.ts` (12 files) — check for inline `LIMIT ${qLimit}` and dynamic `ORDER BY`
- `database/migrations/*.sql` 001..009 — constraints, indexes, triggers, `pgcrypto`, `pg_trgm` not yet, `statement_timeout`
- Transactions: `POST /api/repos` `BEGIN/COMMIT/ROLLBACK` `server/src/routes/repos.ts:32`, `POST /fork` same, `migrate.ts` `BEGIN/COMMIT` per file
- Authorization around queries: every `SELECT` that reads private repo must have `canRead`/`canWrite`/`isAdmin` before `query`
- `LIMIT`/`OFFSET` parameterization, `ILIKE` with `pg_trgm` and `statement_timeout`
- Pool `max` and `idleTimeout` and `statement_timeout` 5s
- `search.ts` already has `statement_timeout 5000` (S7), but S8 ensures all heavy queries have it

**Out of scope (other phases):**
- S4 FS `validateRepoPath` done, S5 `spawn` done, S7 DoS `isAncestor` done, S9 secrets at-rest (S9), S11 CORS done, S17 `docker-compose.yml` `5432:5432` exposure (S17)

---

## 3. Threats (DB-specific)

| # | Threat | Precond | Impact |
|---|--------|---------|--------|
| D1 | SQL injection via inline `LIMIT ${qLimit}` | `GET /api/repos?limit=1; DROP TABLE repositories --` — `qLimit` is `parseInt` clamped, so `DROP` would be `NaN` → 100, not injection, but still inline is bad practice | Low but should be param |
| D2 | Dynamic `ORDER BY` injection via `sort` param in `GET /api/users/:username/repos?sort=updated; DROP` | `sort` is validated via `if (sort === 'updated')` else etc, and `orderBy` is set via fixed strings, not user string directly — safe, but should be allowlist | Low |
| D3 | Missing `canRead` on private `SELECT` | `GET /search` already has visibility filter, but `GET /activity/:owner/:repo` in `stars.ts:70` checks `canRead` — need to verify all `SELECT` that touch `repositories` private have `canRead` | Private disclosure if missed |
| D4 | Transaction orphan: `POST /api/repos` `BEGIN` `INSERT repositories` `INSERT members` `COMMIT`, then `execItehaas init` fails → `DELETE FROM repositories` orphan cleanup, but if `execItehaas` hangs, transaction already committed, repo row remains without FS | Orphan DB row |
| D5 | Long `ILIKE %q%` scan DoS | `GET /search?q=aaa...` 100 chars, but `ILIKE` without `pg_trgm` index may scan 1M rows, no `statement_timeout` on other `ILIKE` queries (`repos.ts` search, `users.ts` search) | DoS |
| D6 | Connection pool exhaustion | `pool max 10`, but `getClient` without `release` on error could leak, and `isAncestor` via `execItehaas` not DB, but `search` with 10 concurrent `ILIKE` may hold 10 connections 5s each → pool 10 exhausted | DoS |
| D7 | Superuser `itehaas` with `POSTGRES_PASSWORD: itehaas` in `docker-compose.yml` | App connects as superuser, can `COPY PROGRAM`, `pg_read_file` | Privilege escalation if SQLi found |

---

## 4. Affected Components

| File:line | Current | Risk |
|-----------|---------|------|
| `server/src/routes/repos.ts:158` `LIMIT ${qLimit} OFFSET ${qOffset}` | inline, `qLimit` from `parseInt` clamped 1..100, not param | D1 Low |
| `server/src/db/index.ts:4` `Pool {max:10, idleTimeout:30000}` | no `statement_timeout`, no `connectionTimeoutMillis` | D5/D6 |
| `server/src/db/migrate.ts:22` `BEGIN/COMMIT` per file | correct, but no `statement_timeout` | — |
| `server/src/routes/repos.ts:32` `BEGIN` `INSERT repositories` `INSERT members` `COMMIT` then `execItehaas init` then `DELETE` on fail | transaction committed before FS, orphan if FS fails | D4 Low |
| `server/src/routes/users.ts:212` `GET /api/users/:username/repos` `ORDER BY ${orderBy}` where `orderBy` is allowlisted via `if sort === 'name'` etc | safe allowlist, but not param (can't param ORDER BY) | D2 Low |
| `docker-compose.yml:7` `POSTGRES_USER: itehaas` superuser | D7 | High for deployment but S17 will handle least-privilege role |

---

## 5. Current Controls (what is already good)

- **All `query(text, params)` use `$1` params** except one `LIMIT ${qLimit}` inline (clamped) — `server/src/routes/search.ts:88` `LIMIT $2 OFFSET $3` param, `server/src/routes/issues.ts:49` `LIMIT $1` param, etc. — **99% param**
- **Dynamic `ORDER BY` allowlisted** via `if (sort === 'name') orderBy = 'r.name ASC'` etc, not user string — safe
- **`ILIKE` with `pg_trgm` not yet but `search.ts` has `statement_timeout 5000` (S7)** and `limit 20` (S7)
- **Transactions** `BEGIN/COMMIT/ROLLBACK` correctly in `repos.ts:32`, `fork`, `migrate.ts`
- **`canRead`/`canWrite`/`isAdmin` before every private `SELECT`** — verified in S3 for `issues`, `pulls`, `stars`, `repos`, `ci`, `search` (S3 matrix 10 tests)
- **`Pool max 10` + `idleTimeout 30000`** — bounded, `pool.on('error')` logged
- **`migrate.ts` `BEGIN/COMMIT` per migration + `_migrations` tracking** — safe, idempotent
- **`pgcrypto` extension** `CREATE EXTENSION IF NOT EXISTS "pgcrypto"` in `001_init.sql:4` — ready for `pgp_sym_encrypt` if needed for `ci_secrets` (S9)

---

## 6. Weaknesses → SEC

| Gap | SEC | Detail |
|-----|-----|--------|
| Inline `LIMIT ${qLimit}` | SEC-?? D1 | `repos.ts:158` not param, though clamped |
| No `statement_timeout` on pool | SEC-014 D5 | `search` has 5s via `SET` (S7) but other `ILIKE` (`repos.ts` search) not |
| Superuser `itehaas` | SEC-002/007 | App as superuser, S17 will create `itehaas_app` `NOSUPERUSER` |
| Orphan repo row on `execItehaas` fail | D4 | `POST /api/repos` `COMMIT` before `execItehaas`, then `DELETE` on fail — not atomic, but `DELETE` handles orphan |

---

## 7. Planned Remediation (S8 only, no S9+)

| # | Change | File:line Before → After | Why | Test |
|---|--------|---------------------------|-----|------|
| S8-01 | **Param `LIMIT/OFFSET`** | `server/src/routes/repos.ts:158` `LIMIT ${qLimit} OFFSET ${qOffset}` → `LIMIT $${idx} OFFSET $${idx+1}` + `params.push(qLimit, qOffset)` | D1 CWE-89 | `sqlmap` no injection, `GET /api/repos?limit=1; DROP` → 400 not injection |
| S8-02 | **Pool `statement_timeout` + `connectionTimeout`** | `server/src/db/index.ts:4` `Pool {max:10, idleTimeout:30000}` → `Pool {max:10, idleTimeout:30000, connectionTimeoutMillis: 5000, statement_timeout: 5000}` via `options: '-c statement_timeout=5000'` or `pool.on('connect', c => c.query('SET statement_timeout=5000'))` | D5/D6 CWE-770 | `GET /search?q=aaa` long `ILIKE` → 5s timeout not hang, `pool` 10 still bounded |
| S8-03 | **`ORDER BY` allowlist documented** | `server/src/routes/users.ts:212` already allowlisted, add comment `// allowlist: updated/name/stars only` | D2 | `GET /users/:username/repos?sort=DROP` → 400 |
| S8-04 | **Transaction comment** | `server/src/routes/repos.ts:32` already correct, add `// S8: transaction before FS, orphan DELETE on execItehaas fail` comment | D4 | `POST /repos` `execItehaas` fail → `DELETE` orphan, no leak |
| S8-05 | **Search `ILIKE` param already** | `server/src/routes/search.ts:88` already `LIMIT $2 OFFSET $3` param — no change, just verify | D1 | `search` remains param |

**Explicitly NOT in S8:** `docker-compose.yml` superuser → S17, `ci_secrets` encryption → S9, `isAncestor` → S7, `checkout` symlink → S4.

---

## 8. Test Strategy

| Test | Location | What it proves |
|------|----------|----------------|
| `sql injection LIMIT` | `server/src/routes/s8-db.test.ts` | `GET /api/repos?limit=1; DROP TABLE` → `limit` clamped to 1, param, not injection, table still exists |
| `ORDER BY injection` | same | `GET /api/users/alice/repos?sort=DROP` →400 |
| `statement_timeout` | same | `GET /search?q=aaa` with `statement_timeout 5000` set, `query` wrapper sets timeout |
| `transaction orphan` | same | `POST /api/repos` with mocked `execItehaas` fail → `DELETE FROM repositories` called, no orphan |
| Existing | `cargo test --tests` 132 + `pnpm test` 72 | Still pass after S8 |
| Manual | `psql` | `\d repositories` shows `pgcrypto`, `indexes` on `owner_id`, `visibility`, etc. |

Full suite after S8: `pnpm test` + `cargo test`.

---

## 9. Acceptance Criteria (S8) — ✅ Met 2026-09-02

- [x] `repos.ts:158` `LIMIT $1 OFFSET $2` param not inline — 2026-09-02
- [x] `Pool` `connectionTimeoutMillis 5000` + `statement_timeout 5000` via `options` + `on('connect')` `server/src/db/index.ts:4` — 2026-09-02
- [x] `ORDER BY` allowlist documented, `sort` invalid →400 (`users.ts:212` allowlist `updated/name/stars` only) — 2026-09-02
- [x] `POST /repos` transaction still `BEGIN/COMMIT/ROLLBACK` + `DELETE` on `execItehaas` fail — 2026-09-02
- [x] `pnpm test` 77/77 green + `cargo test` 132 green — 2026-09-02
- [x] `vulnerability-register.md` SEC-014 DB part done, `CYBERSECURITY_IMPLEMENTATION.md` S8 ✅, `PLAN.md` S8 ✅ — 2026-09-02

---

## 10. Rollback Considerations

- `LIMIT $1` param is safe, but `ORDER BY` cannot be param, so allowlist must stay. Rollback to inline `LIMIT ${qLimit}` if `pg` driver doesn't support `LIMIT $1` with `int`? But `pg` does support param for `LIMIT`/`OFFSET` as `int`.
- `statement_timeout 5000` may break long `search` with 1M rows that legitimately needs >5s — increase to 10000 if legitimate. Rollback to 10000 or remove if `search` legitimately slow.
- `connectionTimeoutMillis 5000` may break slow DB on Vivobook HDD — increase to 10000 if needed.

---

## 11. Completion Verification (2026-09-02)

- `pnpm --filter server test` 77/77 (32+7+10+10+6+7+5) green, `cargo test` 132 green, `pnpm build` ok
- `GET /api/repos?limit=1; DROP` → limit 1, param, not injection, `GET /api/users/alice/repos?sort=DROP` →400, `statement_timeout` set via `pool.on('connect')` + `options`, `POST /repos` `BEGIN/COMMIT` + `DELETE` on fail verified
- `server/src/routes/s8-db.test.ts` 5 tests green
- No FS/CORS edits — S8 scope respected

---

## 11. Next Phase

**S9 — Secret Management** — after S8 STOP. Do not touch `ci_secrets` encryption in S8.

**STOP per §8 — S8 Complete. Awaiting S9 approval.**
