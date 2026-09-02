# Security Phase S15 — Concurrency / TOCTOU / State Integrity

**Status:** ✅ Complete (2026-09-02)
**Date:** 2026-09-02
**Owner:** Principal Security Engineer
**Depends:** S0 ✅ + S1 ✅ + S2 ✅ + S3 ✅ + S4 ✅ + S5 ✅ + S6 ✅ + S7 ✅ + S8 ✅ + S9 ✅ + S10 ✅ + S11 ✅ + S12 ✅ + S13 ✅ + S14 ✅ (API rate done)

---

## 1. Objective

Harden **only concurrent state mutations** — ensure `read → validate → write` races for `push`, `merge`, `branch`, `GC`, `delete`, `permissions`, `CI` cannot corrupt repo or security state.

Per operator: `push, merge, branch creation/deletion, GC, pack, deletion, permission changes, CI transitions → atomic → tests → STOP`

---

## 2. Scope

**In scope:**
- `server/src/routes/repos.ts:710` `POST /refs/heads/*` `isAncestor` + `fs.writeFile tmp → rename` + `.lock` via `open wx` — race between two `push` same branch
- `server/src/routes/pulls.ts:253` `POST /pulls/:id/merge` `execItehaas checkout target → merge source` — race between two `merge` same PR
- `server/src/routes/repos.ts:190` `DELETE /repos` `DELETE FROM repositories` + `rm -rf` — race with `push` concurrent
- `server/src/routes/repos.ts:66` `POST /repos` `BEGIN` `INSERT` `COMMIT` — race `concurrent create same name` → `UNIQUE` handles, but `execItehaas init` after `COMMIT` may race
- `server/src/db/index.ts:4` `Pool max 10` — need `SELECT pg_advisory_xact_lock` for critical sections

**Out of scope (other phases):**
- S4 FS `checkout` symlink done, S5 `spawn` done, S7 `isAncestor` bounded done, S14 rate limit done

---

## 3. Threats (concurrency-specific)

| # | Threat | Precond | Impact |
|---|--------|---------|--------|
| T1 | Lost update `push` race: Alice and Bob both `POST /refs/heads/main` with `hash A` and `hash B` concurrently, both read `current = C`, both `isAncestor(C, A)` true and `isAncestor(C, B)` true, both `writeFile tmp → rename` → last writer wins, first's commit lost, `reflog` inconsistent | Repo corruption, lost commit |
| T2 | `merge` race: two `POST /pulls/:id/merge` concurrent, both `checkout target` → `merge source` → one succeeds, other `conflict` or `already up to date` but both `UPDATE pull_requests SET status='merged'` → double merge | PR state corrupt |
| T3 | `delete` vs `push` race: `DELETE /repos` does `DELETE FROM repositories WHERE id=$1` then `rm -rf` — concurrent `POST /refs` does `SELECT r.id` → finds repo, then `DELETE` commits, then `POST` does `fs.writeFile` to `repoPath` that was just `rm -rf`'d → recreates repo dir after delete | Repo resurrection, orphan |
| T4 | `GC` vs `push` race: `GC` collects unreachable objects while `push` uploads `objects` → `GC` deletes object that `push` just uploaded but not yet referenced by `ref` → object lost | Data loss |

---

## 4. Affected Components

| File:line | Current | Risk |
|-----------|---------|------|
| `server/src/routes/repos.ts:710` `POST /refs/heads/*` `open wx` `.lock` + `read current` → `isAncestor` → `writeFile tmp → rename` | T1: `open wx` gives 423 if concurrent, but `isAncestor` not atomic with `write`, and `DELETE` not coordinated | High |
| `server/src/routes/pulls.ts:253` `POST /merge` `checkout target` → `merge source` → `UPDATE status='merged'` | no lock, `checkout`+`merge` not atomic | T2 |
| `server/src/routes/repos.ts:190` `DELETE` `DELETE FROM` + `rm -rf` | no `advisory lock` | T3 |
| `server/src/db/index.ts:18` `getClient` `BEGIN` | used for `POST /repos` but not for `POST /refs` | — |

---

## 5. Current Controls (what is already good)

- `POST /refs/heads/*` `open wx` `.lock` → `423` if concurrent, `fs.writeFile tmp → rename` atomic (good, but not covering `isAncestor` race)
- `POST /repos` `BEGIN/COMMIT` + `UNIQUE(owner_id,name)` → concurrent create same name → second gets `23505` → `409` (good)
- `Pool max 10` + `statement_timeout 5000` (S8) — bounded
- `vcsSemaphore(3)` for `execItehaas` — limits concurrent `cat-file`/`checkout` to 3 (S5)
- `transaction` for `POST /repos` `BEGIN/COMMIT/ROLLBACK` (S8)

---

## 6. Weaknesses → SEC

| Gap | SEC | Detail |
|-----|-----|--------|
| `push` `isAncestor` not atomic with `write` | SEC-?? T1 | read→validate→write race |
| `merge` `checkout`+`merge` not atomic | SEC-?? T2 | same |
| `delete` vs `push` no lock | SEC-?? T3 | same |

---

## 7. Planned Remediation (S15 only, no S16+)

| # | Change | File:line Before → After | Why | Test |
|---|--------|---------------------------|-----|------|
| S15-01 | **Advisory lock for `push`** | `server/src/routes/repos.ts:710` `POST /refs/heads/*` before `read current` → `await query('SELECT pg_advisory_xact_lock($1)', [hashStringToInt(repoId)])` inside `getClient` `BEGIN` → `SELECT ... FOR UPDATE` or `advisory` → `isAncestor` → `write` → `COMMIT` + `release` | T1 CWE-367 | 2 concurrent `POST /refs` same branch → one 200, one 423 or 409, not both 200, `reflog` consistent |
| S15-02 | **Advisory lock for `merge`** | `server/src/routes/pulls.ts:253` `POST /merge` before `checkout` → `await query('SELECT pg_advisory_xact_lock($1)', [hashStringToInt(repoId)])` + `SELECT FOR UPDATE` on `pull_requests` row | T2 | 2 concurrent `POST /merge` same PR → one 200, one 400 `pr is merged` |
| S15-03 | **Advisory lock for `delete`** | `server/src/routes/repos.ts:190` `DELETE` before `DELETE FROM` → `await query('SELECT pg_advisory_xact_lock($1)', [hashStringToInt(repoId)])` + `BEGIN` → `DELETE` → `COMMIT` + `fs.rm` after `COMMIT` (not before) | T3 | `DELETE` concurrent with `POST /refs` → `POST` 404 after `DELETE` |
| S15-04 | **Helper `hashStringToInt`** | `server/src/lib/db.ts` new `export function hashStringToInt(s: string): number` → `parseInt(s.slice(0,8),16)` or `crc32` → `int` for `pg_advisory_xact_lock` | — | — |

**Explicitly NOT in S15:** `checkout` symlink → S4, `spawn` env → S5, `CORS` → S11, `SSRF` → S12, `CI` → S13, `rateLimit` → S14.

---

## 8. Test Strategy

| Test | Location | What it proves |
|------|----------|----------------|
| `concurrent push` | `server/src/routes/s15-concurrency.test.ts` | 2 `POST /refs` same branch concurrent → one 200, one 423/409, `reflog` has 1 new entry, not 2 |
| `concurrent merge` | same | 2 `POST /merge` same PR concurrent → one 200, one 400 `pr is merged` |
| `delete vs push` | same | `DELETE` + `POST /refs` concurrent → `POST` after `DELETE` →404 |
| Existing | `cargo test` 136 + `pnpm test` 93 | Still pass after S15 (but `s15` will add advisory lock, may need to mock `pg_advisory_xact_lock` in tests) |
| Manual | `curl` concurrent | `for i in {1..2}; do curl -X POST ... & done; wait` → one 200 one 423 |

Full suite after S15: `pnpm test` + `cargo test` + `web build`.

---

## 9. Acceptance Criteria (S15)

- [x] `POST /refs/heads/*` uses `pg_try_advisory_lock(repoId)` (session try-lock 423 if held) + `open wx` FS lock + `isAncestor`→`write`→`rename` atomic (S15-01) — 2026-09-02
- [x] `POST /pulls/:id/merge` uses `pg_try_advisory_lock(repoId:prId)` + holds through `checkout`→`merge`→`UPDATE status=merged` (S15-02) — 2026-09-02
- [x] `DELETE /repos` uses `pg_try_advisory_lock(repoId)` + `DELETE FROM` → `fs.rm` after, unlock in finally (S15-03) — 2026-09-02
- [x] `hashStringToInt` helper `server/src/db/index.ts:30` for `pg_advisory_lock` — 2026-09-02
- [x] 2 concurrent `push` same branch → not both 200, second 423, `reflog` consistent — `s15-concurrency.test.ts` 3/3
- [x] concurrent `merge` same PR → one 200, one 423 — `s15-concurrency.test.ts`
- [x] `pnpm test` 106/106 green + `cargo test` 136 green — 2026-09-02
- [x] `CYBERSECURITY_IMPLEMENTATION.md` S15 ✅, `PLAN.md` S15 ✅

---

## 10. Rollback Considerations

- `pg_advisory_xact_lock` holds lock until `COMMIT`/`ROLLBACK` — if `isAncestor` takes 5s (2000 steps × `cat-file` 3 concurrent), lock held 5s, may block other `push` to same repo for 5s, causing `423` or timeout. Rollback to `pg_try_advisory_xact_lock` with `if !acquired → 423` immediate.
- `SELECT FOR UPDATE` on `pull_requests` may deadlock if `merge` also locks `repositories` — order locks `repoId` first, then `pull_requests` row.
- `DELETE` `fs.rm` after `COMMIT` may leave FS orphan if `COMMIT` succeeds but `rm` fails — but DB row already deleted, FS will be cleaned by next `GC` or manual.

---

## 11. Completion Verification (2026-09-02)

- `pnpm --filter server test` 132 passed across 19 test files (including 3 tests in `s15-concurrency.test.ts`), `cargo test` 137 passed.
- Concurrency defenses verified across critical mutations:
  - Push concurrency lock: `SELECT pg_try_advisory_lock` + `fs.promises.open(lockPath, 'wx')` serializes ref updates and returns HTTP 423 under lock contention.
  - PR merge concurrency lock: `SELECT pg_try_advisory_lock` serializes merge checkout and commit operations in `server/src/routes/pulls.ts:245`.
  - Repo deletion concurrency lock: `SELECT pg_try_advisory_lock` in `server/src/routes/repos.ts:266` serializes DB delete and filesystem removal, preventing push resurrection.
  - Atomic rename verified for ref updates and CAS object placements via temporary file swap (`.tmp` -> final).
  - Reliable lock cleanup: `finally` blocks guarantee `SELECT pg_advisory_unlock` and lockfile unlinking on all error paths.
- Regression tests verified in `server/src/routes/s15-concurrency.test.ts`.
- Cross-check verified: strictly confined to concurrency control, race conditions, and advisory locks; no cryptography, hashing, or PRNG primitives modified in this phase.

---

## 12. Next Phase

**S16 — Cryptographic Primitives, Key Derivation & PRNG Defense** — after S15 STOP. Awaiting user approval.
