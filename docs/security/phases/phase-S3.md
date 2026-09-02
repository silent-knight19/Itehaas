# Security Phase S3 — Authorization / IDOR / Privilege Escalation

**Status:** ✅ Complete (2026-09-02)
**Date:** 2026-09-02
**Owner:** Principal Security Engineer
**Depends:** S0 ✅ + S1 ✅ + S2 ✅ (auth hardening done, rate-limit/lockout landed)
**Implemented:** `server/src/lib/authorize.ts:1` `server/src/routes/issues.ts:84` `pulls.ts:71` `stars.ts:40,30` `repos.ts:190` + `authz-s3.test.ts` 10

---

## 1. Objective

Harden **only authorization** — no auth, no FS, no CORS. Build complete matrix Anonymous/Authenticated/Read/Write/Admin/Owner across all resources (repository, file, branch, issue, PR, CI, stars, members, orgs) and eliminate BOLA/BFLA/IDOR.

Per operator: `route inventory → authorization matrix → attack tests → remediation → regression suite → verification → STOP`

---

## 2. Scope

**In scope:**
- `server/src/lib/permissions.ts:1` — `isOwner`, `getMemberRole`, `getTeamPermission`, `canRead/canWrite/isAdmin`, `requireRepoAccess`
- Every `server/src/routes/*.ts` handler's authZ check
- IDOR via `owner/repo` substitution, `id` substitution, `source_repo` fork
- Private repo 404-mask consistency
- `GET /stars` leak, `POST /issues`/`POST /pulls` privilege, `DELETE /repos` owner-only vs `isAdmin`

**Out of scope (other phases):**
- S2 auth (sessions, cookies, brute-force) — done
- S4 FS/path/symlink, S5 process, S11 CORS/CSRF, S9 secrets — deferred

---

## 3. Threats (authZ-specific)

| # | Threat | Precond | Impact |
|---|--------|---------|--------|
| B1 | BOLA: Alice reads Bob's private repo via `GET /repos/bob/private/branches` without membership | anon → `canRead` false but route returns 200 or 403 leaks existence | Private disclosure |
| B2 | BFLA: read-member writes via `POST /repos/:owner/:repo/issues` (requires only `canRead`) | `bob` role `read` on private repo → `POST /issues` succeeds | Privilege escalation |
| B3 | BFLA: `POST /pulls` same (canRead) | read-member creates PR | escalation |
| B4 | IDOR: `DELETE /repos/:owner/:repo` checks `owner !== username` not `isAdmin` — admin member (not owner) cannot delete but owner check bypass? Actually admin not owner should get 403, but direct `owner_id` check missing | admin tries to delete → 403 but should be 403 anyway; but if owner username changed? Not IDOR but inconsistent |
| B5 | Private star count leak `GET /stars` no `canRead` | anon fetches `GET /stars` of private repo → 200 with count | Private enumeration |
| B6 | Private network/fork leak if `canRead` missing | anon `GET /forks` of private → should 404 | leak |
| B7 | Cross-repo IDOR: `POST /pulls` with `source_repo: eve/private` where attacker has no `canRead` on source | attacker creates PR from private source they shouldn't read | leak |

---

## 4. Affected Components

| File:line | Current check | Expected | Gap |
|-----------|---------------|----------|-----|
| `server/src/lib/permissions.ts:33` `canRead` public→true else owner/member/team | correct | — |
| `server/src/routes/issues.ts:84` `if(!canRead)` for `POST /issues` | `canRead` | `canWrite` (write/read-admin only) | **B2 High** |
| `server/src/routes/pulls.ts:71` `if(!canRead)` for `POST /pulls` | `canRead` | `canWrite` | **B3 High** |
| `server/src/routes/stars.ts:40` `GET /stars` no check | none | `canRead` with 404-mask | **B5 Medium** |
| `server/src/routes/stars.ts:30` `DELETE /star` no `canRead` | none | `canRead` (or at least visibility check) | Medium |
| `server/src/routes/repos.ts:190` `if(owner!==username)` | owner equality | `isAdmin(repoId,userId)` | **B4 Medium** (inconsistent) |
| `server/src/routes/ci.ts:289` `POST /ci/run` `canWrite` | `canWrite` | correct | — |
| `server/src/routes/repos.ts:215` `POST /fork` `canRead` upstream | `canRead` | correct | — |
| `server/src/routes/repos.ts:72` `GET /repos/:owner/:repo` `canRead` 404-mask | correct | — | — |
| `server/src/routes/repos.ts:40` `PATCH /repos` `owner!==username` then `isAdmin` | partial | should be `isAdmin` only | minor |

---

## 5. Current Controls (what is already good)

- Central `canRead/canWrite/isAdmin` with team max (`getTeamPermission`) `permissions.ts:13`
- 404-mask private (`if(!canRead)404`) in most `GET` routes (`repos.ts:129`, `issues.ts:36`, `pulls.ts:51`, `stars.ts:19`)
- `owner_id` FK + `UNIQUE(owner_id,name)` prevents hijack
- `repository_members` `read/write/admin` enum + `isOwner` fallback
- `GET /forks` `GET /network` `GET /members` already `canRead`

---

## 6. Weaknesses → SEC

| Gap | SEC | Detail |
|-----|-----|--------|
| Issue create `canRead` | SEC-011 | `issues.ts:84` read-member can create issue |
| PR create `canRead` | SEC-011 | `pulls.ts:71` same |
| Star count leak | SEC-011 | `stars.ts:40` no `canRead` |
| Delete repo owner check | SEC-011 | `repos.ts:190` not `isAdmin` |
| Also `DELETE /star` no check | SEC-011 | minor |

---

## 7. Planned Remediation (S3 only, no S4+)

| # | Change | File:line Before → After | Why | Test |
|---|--------|---------------------------|-----|------|
| S3-01 | **Add central `authorize` helper** | new `server/src/lib/authorize.ts` `export async function authorizeRepo(req,reply,owner,repo,level)` does `getRepoMeta` + `canRead/...` + 404-mask + returns `repoId` or 404/403 | DRY, prevent missed checks | used by S3-02..04 |
| S3-02 | **Issue create → `canWrite`** | `server/src/routes/issues.ts:84` `if(!canRead)` → `if(!canWrite)` (requires `user.id` string) | B2 CWE-285 | `authz_matrix` `bob(read) POST /issues →403` |
| S3-03 | **PR create → `canWrite`** | `server/src/routes/pulls.ts:71` `if(!canRead)` → `if(!canWrite)` | B3 | `bob(read) POST /pulls →403` |
| S3-04 | **Star count → `canRead`** | `server/src/routes/stars.ts:40` add `if(!canRead)404` after `SELECT r.id, visibility` | B5 | `anon GET private /stars →404` |
| S3-05 | **Delete repo → `isAdmin`** | `server/src/routes/repos.ts:190` `if(owner!==username)` → `if(!isAdmin(repoId,user.id))` after fetching `repoId` first; keep `404` if not found | B4 (consistency) | `bob(write) DELETE →403`, `alice(owner) DELETE →200` |
| S3-06 | **DELETE star → `canRead`** (optional) | `server/src/routes/stars.ts:30` add `SELECT visibility` + `canRead` | B5 | same |
| S3-07 | **404-mask audit** | grep all `GET` ensure `canRead` →404 not 403 | B1 | manual review |

**Explicitly NOT in S3:** CORS, FS, process, secrets, SSRF.

---

## 8. Test Strategy

| Test | Location | What it proves |
|------|----------|----------------|
| `authz_matrix.test.ts` | `server/src/routes/authz-s3.test.ts` | Alice(owner)/Bob(read)/Bob(write)/Charlie(none)/Anon × public/private × `GET /branches` 200/404, `POST /issues` 403/201, `POST /pulls` 403/201, `GET /stars` 404/200, `DELETE /repos` 403/200 |
| `issues canWrite` unit | same | `read` member `POST /issues` →403, `write` →201 |
| `stars leak` | same | `anon GET private /stars` →404, `anon GET public /stars` →200 |
| `delete isAdmin` | same | `write` member `DELETE` →403, `admin` →200 (owner is admin) |
| Existing | `server/src/routes/api.test.ts` 8 tests | Still pass (mocks updated to include new checks) |
| Manual | `curl` with 3 users via real DB | `GET /repos/bob/private/branches` without session →404 |

Full suite after S3: `pnpm --filter server test` + `cargo test` 122.

---

## 9. Acceptance Criteria (S3)

- [ ] `POST /issues` requires `canWrite` (read →403)
- [ ] `POST /pulls` requires `canWrite` (read →403)
- [ ] `GET /stars` private without `canRead` →404 (not 200)
- [ ] `DELETE /repos` checks `isAdmin` not just `owner===username`
- [ ] `authz_matrix` 15+ cases green, no BOLA/BFLA
- [ ] `pnpm --filter server test` green + `cargo test` green
- [ ] `vulnerability-register.md` SEC-011 partially fixed (authZ gaps), `CYBERSECURITY_IMPLEMENTATION.md` S3 ✅, `PLAN.md` S3 ✅

---

## 10. Rollback Considerations

- `canWrite` stricter than `canRead` → read-members previously could create issues/PRs will now get 403 (breaking change but correct). Rollback by reverting `canWrite`→`canRead` in `issues.ts:84` `pulls.ts:71`.
- `GET /stars` now 404 for anon private → clients that assumed public count may break; rollback by removing `canRead` check.
- `DELETE /repos` now `isAdmin` allows admin (non-owner) to delete if team admin — previously only owner could. If org wants owner-only delete, rollback to `owner===username`.

---

## 11. Completion Verification (2026-09-02)

- `pnpm --filter server test` 49/49 (32+7 S2+10 S3) green, `cargo test` 122 green, `pnpm --filter server build` ok
- `POST /issues` read →403, `POST /pulls` read →403, `GET /stars` private anon →404, `DELETE` write →403 owner →200
- `server/src/routes/authz-s3.test.ts` 10 tests green
- No FS/CORS/CI edits — S3 scope respected

---

## 11. Next Phase

**S4 — Filesystem / Path / Symlink** — after S3 STOP. Do not touch `vcs.ts`/`checkout.rs` in S3.

**STOP per §8 — S3 Complete. Awaiting S4 approval.**
