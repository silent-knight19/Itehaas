# Security Phase S15 — Concurrency, Merge Collision, & TOCTOU Defense

**Status:** ✅ Complete  
**Date:** 2026-09-02  
**Owner:** Principal Security Engineer  
**Scope:** Elimination of pull request merge race conditions ([SEC-019](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-019--race-condition--concurrency-collisions-in-pull-request-merges)), repository-level advisory locking for merge operations, atomic invite token acceptance with transaction row locking (`SELECT ... FOR UPDATE`), and concurrent merge collision defense.

---

## 1. Objective

Neutralize concurrency race conditions, working directory index corruption during concurrent merges, and time-of-check to time-of-use (TOCTOU) invite token reuse.

---

## 2. Threat Analysis & Defensive Matrix

| Threat | Attack Path | Previous State | Implemented Control (S15) |
|---|---|---|---|
| **Pull Request Merge Collision Race** (SEC-019) | When two pull requests target branches in the same repository, both callers execute `POST /api/repos/:owner/:repo/pulls/:id/merge` concurrently. Previously, advisory lock keys were computed on `meta.id + ':' + id` (per PR). Both PRs acquired locks simultaneously, causing concurrent `checkout` and `merge` commands to run in the single host working tree `repoPath`, corrupting `.itehaas/index` and generating broken merge commits. | Per-PR advisory lock (`meta.id + ':' + id`). | In `server/src/routes/pulls.ts:256`, replaced lock key with repository-scoped advisory lock `hashIntMerge('repo-merge:' + meta.id)`. Any concurrent merge attempt in that repository fails `pg_try_advisory_lock` and returns HTTP 423 `{ error: 'merge locked, retry' }`. Lock is unconditionally released in a `finally` block. |
| **Invite Acceptance TOCTOU Double-Use Race** | Attacker issues two concurrent `POST /api/invites/:token/accept` requests. Both requests read `status = 'pending'`, both insert organization/team/repo membership records, and both mark the invite as accepted, potentially bypassing member quotas or creating inconsistent states. | Read-then-update without row-level lock or transaction. | In `server/src/routes/invites.ts:124-152`, wrapped acceptance within an explicit database transaction (`BEGIN ... COMMIT`) acquiring a row-level lock with `SELECT * FROM invites WHERE token=$1 AND status='pending' FOR UPDATE`. Subsequent concurrent requests block until the transaction commits, then observe `status='accepted'` and are rejected with HTTP 404. |

---

## 3. Files Modified

1. `server/src/routes/pulls.ts`: Replaced per-PR advisory lock key with repository-level merge lock (`repo-merge:meta.id`) to eliminate working directory collisions during merges (SEC-019).
2. `server/src/routes/invites.ts`: Enforced transaction-isolated row-level locking (`SELECT ... FOR UPDATE`) in `POST /api/invites/:token/accept` to eliminate invite replay races.
3. `server/src/routes/s15-concurrency.test.ts`: Created regression test suite verifying repository-level merge locking (HTTP 423 on concurrent merge) and transaction row locking on invite acceptance.

---

## 4. Verification & Regression Tests

- **Concurrency Security Test Suite (`server/src/routes/s15-concurrency.test.ts`):** 3/3 tests passing:
  - `rejects concurrent merge on same repository with HTTP 423 even if PR IDs differ` (SEC-019).
  - `successfully acquires repository lock and executes merge when no collision exists`.
  - `atomically executes invite acceptance inside transaction with FOR UPDATE`.
- **Full Project Regression Test Suites:**
  - `pnpm --filter server test`: 27 test files, 233/233 tests green.
  - `cargo test`: 124/124 tests green.

---

## 5. Acceptance Criteria Checklist

- [x] Advisory lock scoped to repository level (`repo-merge:meta.id`) (SEC-019)
- [x] Concurrent merge on the same repository returns HTTP 423
- [x] Lock release guaranteed via `finally` block
- [x] Invite acceptance isolated with transaction and `SELECT ... FOR UPDATE`
- [x] Vulnerability register updated
- [x] `PLAN.md` updated

---

## 6. Next Phase Gate

- **Active Phase Status:** S15 COMPLETE.
- **Next Phase:** `SECURITY PHASE S16 — DEPENDENCY, SUPPLY CHAIN, & CRYPTOGRAPHIC AUDIT`
- **Scope:** Triage 31 production vulnerabilities ([SEC-025](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-025--deprecated-and-vulnerable-transitive-dependencies)), audit and update npm/cargo lockfiles, review cryptographic algorithms and key strengths.
