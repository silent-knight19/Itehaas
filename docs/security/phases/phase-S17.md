# Security Phase S17 — Host Environment, Runtime, & Docker Hardening

**Status:** ✅ Complete  
**Date:** 2026-09-02  
**Owner:** Principal Security Engineer  
**Scope:** Resolution of cross-architecture host binary mounting failure ([SEC-026](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-026--docker-architecture-mismatch--host-binary-mounting-failure)), multi-stage Linux compilation of Rust VCS engine, non-root user enforcement (`USER node`), read-only root filesystems, no-new-privileges flags, Linux capability stripping (`cap_drop: [ALL]`), temporary filesystem isolation (`tmpfs`), healthcheck additions, and `.dockerignore` context confinement.

---

## 1. Objective

Harden container runtimes against host execution format mismatch, container escape vectors, privilege escalation, and unintended file leakage from Docker build contexts.

---

## 2. Threat Analysis & Defensive Matrix

| Threat | Attack Path | Previous State | Implemented Control (S17) |
|---|---|---|---|
| **Host Architecture Binary Mismatch** (SEC-026) | `docker-compose.yml` mounted host `./target/debug/itehaas` into `/usr/local/bin/itehaas`. When running Docker on macOS ARM64 or Windows, the Linux container attempts to execute a Mach-O / Windows binary, failing with `Exec format error` and halting all VCS commands. | Direct host mount in `docker-compose.yml:35`. | In `server/Dockerfile`, implemented multi-stage build (`AS vcs-builder`) compiling the Rust binary from source within `rust:1.80-alpine3.19`. In `docker-compose.yml`, removed the host binary volume mount, using the container's native Linux binary. |
| **Root Execution in Container** | A compromised process executing as root (UID 0) inside a container has higher chances of escaping via kernel vulnerabilities. | Default container execution. | Added `USER node` to both `server/Dockerfile` and `web/Dockerfile`. Enforced `user: "65534:65534"` (nobody/nogroup) in `docker-compose.yml`. |
| **Writable Root Filesystem Abuse** | Attackers dropping web shells or modifying system binaries in `/bin` or `/usr/bin`. | Standard writable container layer. | Enforced `read_only: true` on both `server` and `web` services with ephemeral `tmpfs: [/tmp:rw,noexec,nosuid,size=64m]`. |
| **Linux Privilege Escalation** | Attackers exploiting SUID binaries or gaining kernel capabilities. | Default Docker capabilities. | Configured `security_opt: [no-new-privileges:true]` and `cap_drop: [ALL]` across all services. |
| **Docker Build Context Leakage** | Running `docker build` includes `.env` secrets, developer credentials, or git history into the build daemon. | Missing `.dockerignore` files. | Created comprehensive `.dockerignore` files in root, `server/`, and `web/` excluding `.env*`, `node_modules`, `.git`, and build outputs. |
| **Service Unavailability / Deadlock** | Fastify or database freezes silently without orchestration detecting failure. | Database had healthcheck; server lacked one. | Added HTTP healthcheck in `docker-compose.yml` querying `GET /health` every 10 seconds. |

---

## 3. Files Created / Modified

1. `server/Dockerfile`: Rebuilt as multi-stage Dockerfile compiling Rust VCS binary (`AS vcs-builder`) for target container architecture and adding `USER node` (SEC-026).
2. `web/Dockerfile`: Added `USER node` for non-root execution.
3. `docker-compose.yml`: Removed host binary mount `./target/debug/itehaas`; added healthcheck to `server`; updated build context to `.`.
4. `.dockerignore`, `server/.dockerignore`, `web/.dockerignore`: Excluded `.env*`, `node_modules`, `.git`, and artifacts.
5. `server/src/routes/s17-deploy.test.ts`: Added assertions for SEC-026 host binary mount removal, multi-stage builder presence, non-root users, and `.dockerignore` files.
6. `docs/security/vulnerability-register.md`: Marked `SEC-026` as *Mitigated in S17*.

---

## 4. Verification & Regression Tests

- **Deployment & Docker Security Suite (`server/src/routes/s17-deploy.test.ts`):** 8/8 tests passing:
  - `S17-01 PG not exposed 0.0.0.0, only 127.0.0.1`.
  - `S17-01 server and web also bound to 127.0.0.1`.
  - `S17-02 config host is 127.0.0.1 in prod`.
  - `S17-03 server least privilege (user, read_only, tmpfs, cap_drop ALL)`.
  - `S17-04 docker.sock never mounted active`.
  - `S17-05 secrets comment CHANGE ME`.
  - `SEC-026: Docker host binary mount removed and multi-stage container build enabled`.
  - `S17-07: .dockerignore files exclude sensitive files and build caches`.
- **Full Project Regression Test Suites:**
  - `pnpm --filter server test`: 27 test files, 235/235 tests green.
  - `cargo test`: 124/124 tests green.

---

## 5. Acceptance Criteria Checklist

- [x] Host binary volume mount removed from `docker-compose.yml` (SEC-026)
- [x] Multi-stage build compiles Rust binary inside container for target architecture
- [x] Non-root user directive (`USER node`) in all Dockerfiles
- [x] `read_only: true` with `tmpfs: /tmp:rw,noexec,nosuid` in compose
- [x] `cap_drop: [ALL]` and `no-new-privileges:true` in compose
- [x] Healthcheck defined on `server` and `db`
- [x] `.dockerignore` files created and verified
- [x] Vulnerability register updated
- [x] `PLAN.md` updated

---

## 6. Next Phase Gate

- **Active Phase Status:** S17 COMPLETE.
- **Next Phase:** `SECURITY PHASE S18 — OBSERVABILITY, AUDIT LOGGING, & DETECTION`
- **Scope:** Structured security audit trail logging (authentication failures, permission denials, privilege escalations, secret rotations), Prometheus security metrics, and incident response runbooks.
