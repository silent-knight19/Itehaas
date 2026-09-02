# Security Phase S3 — Authorization, IDOR, & BOLA Defense

**Status:** ✅ Complete  
**Date:** 2026-09-02  
**Owner:** Principal Security Engineer  
**Scope:** Elimination of universal organization team repository takeover ([SEC-006](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-006--universal-repository-takeover-via-organization-team-attachment)), remote URL protocol restriction against cross-tenant filesystem exfiltration ([SEC-007](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-007--cross-tenant-private-repository-exfiltration-via-filesystem-remotes)), BOLA scoping on issue modification ([SEC-011](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-011--bola--cross-repository-unauthorized-issue-modification)), PR reviewer deletion authorization ([SEC-012](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-012--missing-authorization-on-pull-request-reviewer-deletion)), owner-only repository deletion ([SEC-022](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-022--over-privileged-repository-collaborator-admin-deletion)), public issue reporting enablement ([SEC-023](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-023--over-restrictive-issue-creation-permission-breaks-public-collaboration)), and email harvesting prevention in user and organization APIs ([SEC-005](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-005--unauthenticated-pii--email-address-harvesting-across-userorg-apis)).

---

## 1. Objective

Harden all multi-tenant and multi-user authorization boundaries across repositories, organizations, teams, pull requests, issues, and users. Eliminate Broken Object Level Authorization (BOLA / IDOR) and privilege escalation vectors where attackers could access, modify, exfiltrate, or delete objects outside their tenant boundary.

---

## 2. Threat Analysis & Defensive Matrix

| Threat | Attack Path | Previous State | Implemented Control (S3) |
|---|---|---|---|
| **Universal Repo Takeover via Team Attachment** (SEC-006) | Org owner attaches any private repository (owned by another user or org) to their team with `'admin'` role; `getTeamPermission` grants caller full admin rights over victim repo. | `POST /api/orgs/:org/teams/:team/repos` attached repo without verifying caller's permissions on the target repository. | Enforced `await isAdmin(repoId, user.id)` on the target repository before allowing team attachment. Rejects unauthorized attachment with HTTP 403. |
| **Filesystem Remote Private Repo Exfiltration** (SEC-007) | Attacker adds `file:///var/data/repos/victim/private.git` as a remote on their own repository; calls fetch/push to copy private objects into their public repo. | `POST /api/repos/:owner/:repo/remotes` accepted arbitrary URL strings. | Enforced strict protocol validation: only `http://` and `https://` URLs are permitted. Rejects `file://`, local paths, directory traversal (`..`), and embedded credentials. |
| **BOLA Cross-Repository Issue Modification** (SEC-011) | Attacker with write access to repository A submits `PATCH /api/repos/:attacker/repoA/issues/:victimIssueId` to modify title, body, status, or labels of private issue in repo B. | `PATCH /issues/:id` checked `canWrite` on repo in URL, but fetched issue via `WHERE id=$1` without scoping to `repo_id`. | Scoped query strictly to `WHERE id=$1 AND repo_id=$2`. Returns HTTP 404 if the issue does not belong to the URL repository. |
| **Unauthorized PR Reviewer Deletion** (SEC-012) | Any authenticated user calls `DELETE /pulls/:id/reviewers/:username` to delete review requests on any pull request across the system. | Route had no permission check, did not verify caller was PR author or collaborator, and did not scope PR to repo. | Verified repository read access, scoped PR lookup to `WHERE id=$1 AND repo_id=$2`, and required caller to be either PR author or have repository write permissions. |
| **Collaborator Repository Deletion** (SEC-022) | Invited collaborator with `admin` role deletes repository and removes filesystem working tree from disk. | `DELETE /api/repos/:owner/:repo` allowed any user matching `isAdmin(repoId, user.id)`. | Restricted repository deletion strictly to the repository owner via `isOwner(repoId, user.id)`. |
| **Over-Restrictive Public Issue Reporting** (SEC-023) | External community contributors cannot report bugs or open issues on public repositories without repository write access. | `POST /issues` required `canWrite(repoMeta.id, user.id)` for all repositories. | Adjusted permission model: public repositories permit any authenticated read-permitted user to open issues, while private repositories strictly enforce `canWrite`. |
| **Email Harvesting Across Profile & Org APIs** (SEC-005) | Anonymous users scrape `GET /api/users/:username`, `GET /api/orgs/:org/members`, `GET /api/repos/:owner/:repo/members` to harvest private user emails. | All member listings and user profiles leaked `u.email` unconditionally. | Sanitized member listings to omit `email`, and scoped profile `email` visibility strictly to the authenticated user viewing their own account. |

---

## 3. Files Modified

1. `server/src/routes/orgs.ts`: Added `isAdmin` verification in `POST /api/orgs/:org/teams/:team/repos` (SEC-006); removed email disclosure in member listings (SEC-005).
2. `server/src/routes/repos.ts`: Restricted `DELETE /api/repos` to repository owner (SEC-022); enforced HTTP/HTTPS protocol validation on remote URLs (SEC-007); removed email disclosure in repo member listings (SEC-005).
3. `server/src/routes/issues.ts`: Scoped `PATCH /issues/:id` lookup strictly to `repo_id` (SEC-011); permitted read-authorized users to open issues on public repositories (SEC-023).
4. `server/src/routes/pulls.ts`: Added repo scoping and author/write authorization check to `DELETE /pulls/:id/reviewers/:username` (SEC-012).
5. `server/src/routes/users.ts`: Scoped `email` disclosure in `GET /api/users/:username` strictly to self-view (SEC-005).
6. `server/src/routes/authz-s3.test.ts`: Added negative regression test suite covering all S3 security controls.

---

## 4. Verification & Regression Tests

- **S3 Authorization Test Suite:** 18/18 tests passing in `server/src/routes/authz-s3.test.ts`:
  - Anonymous user GET private branches $\rightarrow$ 404
  - Anonymous user GET public branches $\rightarrow$ 200
  - Read-only member GET private branches $\rightarrow$ 200
  - Read-only member POST issue on private repo $\rightarrow$ 403 (write required)
  - Write-member POST issue on private repo $\rightarrow$ 201
  - Read-only member POST pull request $\rightarrow$ 403 (write required)
  - Cross-fork POST pull request requires write access on source repo $\rightarrow$ 403
  - Anonymous user GET stars on private repo $\rightarrow$ 404 (does not leak existence)
  - Read-only member GET stars on private repo $\rightarrow$ 200
  - Write-member DELETE repo $\rightarrow$ 403; Owner DELETE repo $\rightarrow$ 200
  - Non-member GET private issues $\rightarrow$ 404
  - `SEC-006`: Non-admin user attaching repo to team $\rightarrow$ 403 Forbidden
  - `SEC-007`: Setting remote with `file://`, relative paths, or URL credentials $\rightarrow$ 400 Bad Request
  - `SEC-011`: BOLA cross-repository issue patch $\rightarrow$ 404 Not Found
  - `SEC-012`: Reviewer deletion by unauthorized user $\rightarrow$ 403 Forbidden
  - `SEC-022`: Non-owner collaborator deleting repo $\rightarrow$ 403 Forbidden
  - `SEC-023`: Public repo allows read-permitted authenticated user to open issue $\rightarrow$ 201 Created
  - `SEC-005`: Anonymous user GET profile $\rightarrow$ 200 without email exposure
- **Project Test Suite:**
  - `pnpm --filter server test`: 21 test files, 177/177 passed.
  - `cargo test`: 122/122 passed.

---

## 5. Acceptance Criteria Checklist

- [x] Universal repo takeover via team attachment blocked (SEC-006)
- [x] Filesystem remotes blocked (SEC-007)
- [x] Cross-repository issue BOLA tampering blocked (SEC-011)
- [x] Pull request reviewer deletion authorization enforced (SEC-012)
- [x] Repository deletion restricted to owners only (SEC-022)
- [x] Public issue collaboration enabled (SEC-023)
- [x] PII and email harvesting prevented (SEC-005)
- [x] Zero functional regressions in existing tests
- [x] Vulnerability register updated
- [x] `PLAN.md` updated

---

## 6. Next Phase Gate

- **Active Phase Status:** S3 COMPLETE.
- **Next Phase:** `SECURITY PHASE S4 — FILESYSTEM & PATH TRAVERSAL SECURITY`
- **Scope:** Case-insensitivity collisions overwriting `.itehaas` control structures on macOS/Windows ([SEC-013](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-013--case-insensitive-filesystem-control-structure-overwrite-via-content)), symlink traversal escapes, and working tree confinement in VCS operations.
