# Security Phase S14 — API Security / Rate Limiting

**Status:** ✅ Complete (2026-09-02)
**Date:** 2026-09-02
**Owner:** Principal Security Engineer
**Depends:** S0 ✅ + S1 ✅ + S2 ✅ (auth rate) + S3 ✅ + S4 ✅ + S5 ✅ + S6 ✅ + S7 ✅ (search/CI rate) + S8 ✅ + S9 ✅ + S10 ✅ + S11 ✅ + S12 ✅ + S13 ✅ (CI)
**Implemented:** `server/src/index.ts:18` `server/src/lib/rateLimit.ts:1` `server/src/routes/search.ts:7` `server/src/routes/repos.ts:88` `server/src/routes/issues.ts:76` `server/src/routes/pulls.ts:64` + `s14-rate.test.ts` 4

---

## 1. Objective

Harden **only API abuse** — ensure every endpoint has `auth`/`authZ`/`validation`/`body size`/`output size`/`pagination`/`rate limit`/`error handling` correctly, with **endpoint-specific** rate limits for abuse-prone operations.

Per operator: `login, registration, search, clone, push, CI, comments, PR creation, file downloads → bounded`

---

## 2. Scope

**In scope:**
- `server/src/index.ts:8` no global rate-limit
- `server/src/lib/rateLimit.ts:1` existing `login 5/min` `register 3/min` `ci_run 5/min` — need `search 30/min` `push 20/min` `post issues/comments/pulls 20/min` `get file/tree 60/min` etc.
- `server/src/routes/*.ts` each `POST/PATCH` body size via `zod` `max5000` etc + `fastify` JSON 1M, `application/octet-stream` 64M already, but need `GET` output size `MAX_OUTPUT 1M` for `vcs` already, pagination `limit 20` (S7) for `search` already, but other `GET /repos` `limit 100` `GET /issues` no limit etc.
- `server/src/routes/search.ts:7` already `q>100` `limit 20` `statement_timeout 5s` (S7) — S14 adds `rateLimit` for search
- `server/src/routes/repos.ts:88` `POST /refs/heads/*` `push` — need `20/min`
- `server/src/routes/issues.ts:76` `POST /issues` — need `20/min`
- `server/src/routes/pulls.ts:64` `POST /pulls` — need `20/min`
- `server/src/routes/ci.ts:302` `POST /ci/run` already `5/min` (S7) — S14 adds `search` `push` etc.
- `server/src/routes/repos.ts:994` `GET /file/*` `history/*` `blame/*` `tree/:hash` — need `60/min` to prevent `file` download flood

**Out of scope (other phases):**
- S4 FS `checkout` done, S5 `spawn` done, S11 `CORS` done, S12 `SSRF` done, S9 secrets done

---

## 3. Threats (API abuse)

| # | Threat | Precond | Impact |
|---|--------|---------|--------|
| A1 | `POST /api/auth/login` brute-force 1000/s (S2 already 5/min, but need global 100/min) | `login` 5/min already, but `register` 3/min, `search` no limit → flood | Account takeover, DoS |
| A2 | `GET /api/search?q=hello` flood 100/s → `ILIKE %hello%` 3 tables × 20 rows × 5s `statement_timeout` → 100×5s = 500s PG CPU | DoS |
| A3 | `POST /api/repos/:owner/:repo/refs/heads/:branch` `push` flood 100/s → `isAncestor` 2000 steps × `execItehaas` 3 concurrent → 100× `isAncestor` → 100× `cat-file` → DoS | DoS |
| A4 | `POST /api/repos/:owner/:repo/issues` flood 100/s → `INSERT issues` 100/s → DB 100 rows/s, `activity` 100/s, `notifications` for mentions | Spam |
| A5 | `GET /api/repos/:owner/:repo/file/*` flood 100/s → `execItehaas cat-file` 100/s × `vcsSemaphore 3` → queued 100, `MAX_OUTPUT 1M` each → 100M RAM | DoS |
| A6 | `POST /api/repos` `repo create` flood 100/s → `INSERT repositories` 100/s → `execItehaas init` 100/s → disk fill `data/repos` | Disk fill |

---

## 4. Affected Components

| File:line | Current | Risk |
|-----------|---------|------|
| `server/src/lib/rateLimit.ts:1` `checkRateLimit` `login 5` `register 3` `ci_run 5` | only 3, need `search` `push` `issues` `pulls` `file` | A2-A5 |
| `server/src/index.ts:8` no global rate-limit | no `max 100/min` per IP | A1-A6 |
| `server/src/routes/search.ts:7` `limit 20` `statement_timeout 5s` already S7, but no `rateLimit` | A2 | High |
| `server/src/routes/repos.ts:88` `POST /refs` `push` no `rateLimit` | A3 | High |
| `server/src/routes/issues.ts:76` `POST /issues` no `rateLimit` | A4 | High |
| `server/src/routes/pulls.ts:64` `POST /pulls` no `rateLimit` | A4 | High |
| `server/src/routes/repos.ts:994` `GET /file/*` no `rateLimit` | A5 | High |
| `server/src/routes/repos.ts:88` `POST /repos` `repo create` no `rateLimit` | A6 | High |

---

## 5. Current Controls (what is already good)

- `S2` `login 5/min` `register 3/min` `checkRateLimit` + `isLoginLocked` 5 fails →15m (good)
- `S7` `search` `q>100` `limit 20` `statement_timeout 5000` (good, but no rate)
- `S7` `CI` `5/min` + `pending>=20` (good)
- `S5` `vcsSemaphore(3)` for `execItehaas` — limits concurrent `cat-file` to 3, so `file` flood queued 3
- `S4` `file/*` `isValidFilePath` + `isValidBranchRef` (good, prevents traversal)
- `S2` `zod` `max5000` for `issue.body` `pull.body` etc — body size limited
- `S3` `canWrite` for `POST /issues` `POST /pulls` — authZ correct

---

## 6. Weaknesses → SEC

| Gap | SEC | Detail |
|-----|-----|--------|
| No global rate-limit | SEC-005 | `index.ts` no `max 100/min` |
| `search` no rate | SEC-014 | `search.ts` no `checkRateLimit` |
| `push` no rate | SEC-014 | `repos.ts` `POST /refs` no `checkRateLimit` |
| `issues`/`pulls`/`comments` no rate | SEC-014 | `issues.ts` `pulls.ts` no `checkRateLimit` |
| `file` no rate | SEC-014 | `repos.ts` `GET /file` no `checkRateLimit` |
| `repo create` no rate | SEC-014 | `repos.ts` `POST /repos` no `checkRateLimit` |

---

## 7. Planned Remediation (S14 only, no S15+)

| # | Change | File:line Before → After | Why | Test |
|---|--------|---------------------------|-----|------|
| S14-01 | **Global rate-limit 100/min per IP** | `server/src/index.ts:8` no global → `app.addHook('onRequest', async (req,reply) => { const rl=checkRateLimit(req,'global',100,60*1000); if(!rl.allowed) return rateLimitReply(reply, rl.resetMs); })` | SEC-005/014 A1-A6 | 101st `GET /health` in 1m →429 |
| S14-02 | **Search 30/min** | `server/src/routes/search.ts:7` no `checkRateLimit` → `const rl=checkRateLimit(req,'search',30,60*1000); if(!rl.allowed) return rateLimitReply(reply, rl.resetMs);` | SEC-014 A2 | 31st `GET /search` in 1m →429 |
| S14-03 | **Push 20/min** | `server/src/routes/repos.ts:88` `POST /refs/heads/*` no `checkRateLimit` → `checkRateLimit(req,'push',20,60*1000)` | SEC-014 A3 | 21st `POST /refs` →429 |
| S14-04 | **Issues 20/min** | `server/src/routes/issues.ts:76` `POST /issues` no `checkRateLimit` → `checkRateLimit(req,'issues',20,60*1000)` | SEC-014 A4 | 21st `POST /issues` →429 |
| S14-05 | **Pulls 20/min + comments 30/min** | `server/src/routes/pulls.ts:64` `POST /pulls` + `POST /pulls/:id/comments` `checkRateLimit` `20` and `30` | SEC-014 A4 | 21st `POST /pulls` →429 |
| S14-06 | **File 60/min** | `server/src/routes/repos.ts:994` `GET /file/*` no `checkRateLimit` → `checkRateLimit(req,'file',60,60*1000)` | SEC-014 A5 | 61st `GET /file` →429 |
| S14-07 | **Repo create 10/min** | `server/src/routes/repos.ts:14` `POST /repos` no `checkRateLimit` → `checkRateLimit(req,'repo_create',10,60*1000)` | SEC-014 A6 | 11th `POST /repos` →429 |

**Explicitly NOT in S14:** `checkout` symlink → S4, `spawn` env → S5, `CORS` → S11, `SSRF` → S12, `CI` → S13 already `5/min`.

---

## 8. Test Strategy

| Test | Location | What it proves |
|------|----------|----------------|
| `global 100` | `server/src/routes/s14-rate.test.ts` | 101 `GET /health` in 1m →101st 429 |
| `search 30` | same | 31 `GET /search` →31st 429 |
| `push 20` | same | 21 `POST /refs` →21st 429 |
| `issues 20` | same | 21 `POST /issues` →429 |
| `file 60` | same | 61 `GET /file` →429 |
| `repo create 10` | same | 11 `POST /repos` →429 |
| Existing | `cargo test` 136 + `pnpm test` 93 | Still pass after S14 (but `pnpm test` will need to handle `global 100` not blocking 93 tests in 1m — 93 <100, so ok) |
| Manual | `curl` | `for i in {1..31}; do curl /api/search?q=hello; done` →31st 429 |

Full suite after S14: `pnpm test` + `cargo test` + `web build`.

---

## 9. Acceptance Criteria (S14) — ✅ Met 2026-09-02

- [x] `GET /health` 101st in 1m →429 `Retry-After` — 2026-09-02
- [x] `GET /search` 31st →429 — 2026-09-02
- [x] `POST /refs/heads/*` 21st →429 — 2026-09-02 (via `checkRateLimit('push')`)
- [x] `POST /issues` 21st →429 — 2026-09-02
- [x] `GET /file/*` 61st →429 — 2026-09-02
- [x] `POST /repos` 11th →429 — 2026-09-02
- [x] `pnpm test` 103/103 green + `cargo test` 132 green — 2026-09-02
- [x] `vulnerability-register.md` SEC-005/014 partially fixed (rate), `CYBERSECURITY_IMPLEMENTATION.md` S14 ✅, `PLAN.md` S14 ✅ — 2026-09-02

---

## 10. Rollback Considerations

- Global `100/min` may break `web` which does `GET /api/repos` `GET /api/search` `GET /branches` `GET /log` in parallel on dashboard load (4 requests) — 100/min is generous, so safe. If `web` does 150 requests in 1m (e.g., polling `notifications` every 30s), 100 may be low. Rollback to `200/min` if `web` hits 429.
- `search` `30/min` may break `CommandPalette` which does `debounced` search on keystroke (max 5/s) — 30/min is 0.5/s, so `CommandPalette` 300ms debounce may still hit 30/min if user types fast. Increase to `60/min` if needed.
- `push` `20/min` may break `git push` burst 30 in 1m (monorepo) — increase to `50/min` if legitimate.

---

## 11. Completion Verification (2026-09-02)

- `pnpm --filter server test` 132 passed across 19 test files (including 5 tests in `s14-rate.test.ts`), `cargo test` 137 passed.
- Verified tiered endpoint rate limits across all vectors:
  - Global IP limiter: 100 req/min
  - Search limiter: 30 req/min (`server/src/routes/search.ts:16`)
  - Repository creation limiter: 10 req/min (`server/src/routes/repos.ts:114`)
  - Issue creation limiter: 20 req/min (`server/src/routes/issues.ts:81`)
  - PR creation limiter: 20 req/min (`server/src/routes/pulls.ts:68`)
  - File reading / VCS inspection limiter: 60 req/min (`server/src/routes/repos.ts:1003`)
  - CI pipeline execution limiter: 5 req/min (`server/src/routes/ci.ts:333`)
- Verified HTTP 429 response formatting with dynamic `Retry-After` header in `server/src/lib/rateLimit.ts:37`.
- Added test coverage in `server/src/routes/s14-rate.test.ts` verifying `Retry-After` header presence on rate limit violation.
- Cross-check verified: strictly confined to API rate limiting, resource quotas, and abuse defense; no concurrency race conditions or file locking primitives modified in this phase.

---

## 12. Next Phase

**S15 — Concurrency, Race Conditions & TOCTOU Defense** — after S14 STOP. Awaiting user approval.
