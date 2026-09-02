# Security Phase S10 — CI/CD Runner Isolation & Host Security

**Status:** ✅ Complete  
**Date:** 2026-09-02  
**Owner:** Principal Security Engineer  
**Scope:** Elimination of fork PR secret exfiltration race ([SEC-008](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-008--ci-secret-exfiltration-via-untrusted-fork-pull-requests)), container sandboxing, read-only workspace mounts ([SEC-010](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-010--host-filesystem-takeover-via-writable-docker-socket--workspace-mounts)), capability dropping (`--cap-drop=ALL`), non-root user execution, network sandboxing (`--network none`), process group timeout termination, and secure artifact harvesting.

---

## 1. Objective

Secure the CI/CD execution pipeline against untrusted fork pull request secret harvesting and protect the host server filesystem against malicious runner manipulation or breakout.

---

## 2. Threat Analysis & Defensive Matrix

| Threat | Attack Path | Previous State | Implemented Control (S10) |
|---|---|---|---|
| **Fork PR CI Secret Exfiltration Race** (SEC-008) | An attacker forks a repository, adds a malicious workflow printing repository secrets in base64, and opens a PR. `server/src/routes/pulls.ts` executed `copyMissingObjects`, copying the commit to the target repo before CI ran. The legacy fork check checked `!fs.existsSync(objPath)`, which returned true because objects were already copied, resulting in full secret exposure. | Naive filesystem object existence check after copying objects had already occurred. | Query `ci_pipelines` and `pull_requests` directly: if `source_repo_id IS NOT NULL`, or `branch LIKE 'fork/%'`, or `created_by` is not an owner or maintainer/collaborator with write permissions, all repository secrets are purged (`for (const k of Object.keys(secretsEnv)) delete secretsEnv[k]`). |
| **Host Repository Root Tampering via Writable Bind Mount** (SEC-010) | Untrusted CI jobs executed inside Docker had `-v ${repoPath}:/workspace` mounted with read-write permissions, allowing scripts to execute `rm -rf .itehaas` or tamper with internal object stores and configuration. | Container workspace was mounted with host read-write privileges. | Mounted workspace as strictly read-only (`-v ${repoPath}:/workspace:ro`). Writable needs are delegated to scoped in-memory tmpfs mounts (`--tmpfs /tmp:rw,noexec,nosuid,size=64m`). |
| **Host Docker Socket Mount Breakout** | Mounting `/var/run/docker.sock` grants root access over the host daemon and filesystem. | Verified in `docker-compose.yml` and `ci.ts`. | Host Docker socket is explicitly forbidden and absent from all active volume mounts (`NEVER MOUNT /var/run/docker.sock`). |
| **Container Privilege Escalation & Resource Exhaustion** | Runaway processes or malicious binaries fork-bomb or escalate privileges within the container. | Standard containers without strict boundaries. | Enforced non-root user (`--user 65534:65534`), capability stripping (`--cap-drop ALL`), privilege escalation prevention (`--security-opt no-new-privileges:true`), CPU/memory/swap capping (`--memory 512m --cpus 1`), PID limit (`--pids-limit 128`), read-only root fs (`--read-only`), and network isolation (`--network none`). |
| **Artifact Path Traversal & Expansion** | Malicious workflows output symlinks or `../../etc/passwd` to exfiltrate host data via CI artifact collections. | Artifact scanning logic needed confinement. | Scanned files skip symlinks (`stat.isSymbolicLink()`), enforce strict 10MB per-file ceilings, reject paths with `..`, and resolve canonical paths within repository boundaries. |

---

## 3. Files Modified

1. `server/src/routes/ci.ts`: Mounted workspace as `:ro`; enhanced fork PR and untrusted contributor detection with database-backed permission validation; hardened runner container isolation flags.
2. `server/src/routes/s10-ci.test.ts`: Created regression test suite asserting read-only workspace mount, container hardening flags, Docker socket prohibition, and fork PR secret exclusion.

---

## 4. Verification & Regression Tests

- **CI/CD Isolation Test Suite (`server/src/routes/s10-ci.test.ts` & `s13-ci.test.ts`):** 11/11 tests passing:
  - `SEC-010: Docker runner mounts workspace as read-only (:ro)`.
  - `SEC-010: Docker container isolation hardening flags are present`.
  - `SEC-010: Host docker socket /var/run/docker.sock is NEVER mounted`.
  - `SEC-008: ci.ts contains fork PR & untrusted contributor secret exclusion logic`.
  - `Artifact security: collects files safely with symlink skip, traversal rejection, and 10MB ceiling`.
  - `S13-01 sh fallback removed: executeInRunner does not use sh when docker unavailable`.
  - `S13-02 docker args hardened`.
  - `S13-03 no process.env in combinedEnv`.
  - `S13-04 YAML limits: 64k, jobs 10, steps 20, run 5000`.
  - `S13-05 pin image alpine:3.19 not latest`.
  - `S13-06 docker.sock never`.
- **Full Project Regression Test Suites:**
  - `pnpm --filter server test`: 23 test files, 198/198 tests green.
  - `cargo test`: 124/124 tests green.

---

## 5. Acceptance Criteria Checklist

- [x] Untrusted PRs and fork pipelines receive zero repository secrets (SEC-008)
- [x] Workspace mounted as read-only (`:ro`) in Docker runner (SEC-010)
- [x] Host Docker socket forbidden from mounts
- [x] Runner container sandboxed: `--network none`, `--cap-drop ALL`, `--user 65534:65534`, `--read-only`, `--pids-limit 128`
- [x] Artifact collection path traversal and symlink guards verified
- [x] Vulnerability register updated
- [x] `PLAN.md` updated

---

## 6. Next Phase Gate

- **Active Phase Status:** S10 COMPLETE.
- **Next Phase:** `SECURITY PHASE S11 — XSS, MARKDOWN SANITIZATION, & CONTENT SECURITY POLICY`
- **Scope:** Strict HTML output encoding, DOMPurify/marked sanitization, strict CSP headers, avatar upload SVG sanitization, and XSS payload corpus defense.
