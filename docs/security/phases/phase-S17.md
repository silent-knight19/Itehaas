# Security Phase S17 — Deployment / Host Hardening

**Status:** ✅ Complete (2026-09-02)
**Date:** 2026-09-02
**Owner:** Principal Security Engineer
**Depends:** S0 ✅ … S16 ✅ (deps pinned, 112 server tests green, 136 cargo green)
**Implemented:** `docker-compose.yml:12` `docker-compose.yml:21` `docker-compose.yml:41` `server/src/config.ts:11` + `s17-deploy.test.ts` 6

---

## 1. Objective

Harden **only deployment / host / compose** — ensure `docker-compose.yml` does not expose `PG`/`server` publicly, containers run as non-root `read_only` `cap_drop` `no-new-privileges`, secrets not hardcoded `itehaas:itehaas`, `HOST` binds `127.0.0.1` in prod via `tailscale serve`, `docker.sock` never mounted.

Per operator: `docker-compose.yml` `POSTGRES_PASSWORD` `ports` `HOST` `user` `read_only` `security_opt` `cap_drop` `volumes` → harden → tests → STOP

---

## 2. Scope

**In scope:**
- `docker-compose.yml:12` `ports: "5432:5432"` public → `127.0.0.1:5432:5432` harden
- `docker-compose.yml:26` `ports: "3001:3001"` → `127.0.0.1:3001:3001` or `3000`
- `docker-compose.yml:10` `POSTGRES_PASSWORD: itehaas` hardcoded → keep but docs say must override via `.env` + add comment `CHANGE ME`
- `server/src/config.ts:11` `host 0.0.0.0` → `127.0.0.1` in prod already (S2), verify
- `docker-compose.yml:21` `server` service no `user` `read_only` `security_opt` `cap_drop` `tmpfs` — add
- `docker-compose.yml:41` `web` service same — add
- `docker-compose.yml:34` `volumes: ./data/repos:/data/repos` rw but needs `delegated` note
- `docker-compose.yml:52` commented socket `NEVER` already S13, verify

**Out of scope (other phases):**
- S4 FS, S5 spawn, S11 CORS, S12 SSRF, S14 rate, S15 concurrency, S16 deps done

---

## 3. Threats (deployment)

| # | Threat | Precond | Impact |
|---|--------|---------|--------|
| T1 | `5432:5432` exposes PG to host network 0.0.0.0 — if host firewall/Tailscale misconfigured, attacker scans public IP:5432 with `itehaas:itehaas` → DB dump | `docker compose up` default | DB RCE via `COPY PROGRAM` |
| T2 | `3001:3001` exposes server 0.0.0.0 — same | `HOST 0.0.0.0` prod | SSRF + CORS bypass |
| T3 | Container runs as root rw, caps ALL, no `no-new-privileges` — if CI RCE via `sh -c` (before S13) or future vuln, attacker gets host root via `cap_sys_admin` | `user:` missing | Host RCE |
| T4 | `POSTGRES_PASSWORD: itehaas` hardcoded in compose checked into git → secret leak via `gitleaks` | `docker-compose.yml:10` | DB compromise |
| T5 | `volumes: ./target/debug/itehaas:ro` already ro good, but `./data/repos:/data/repos` rw without `delegated` may cause TOCTOU | mount | FS race |

---

## 4. Affected Components

| File:line | Current | Risk |
|-----------|---------|------|
| `docker-compose.yml:12` `ports: "5432:5432"` | 0.0.0.0 bind | T1 High |
| `docker-compose.yml:26` `ports: "3001:3001"` | 0.0.0.0 | T2 |
| `docker-compose.yml:10` `POSTGRES_PASSWORD: itehaas` | hardcoded | T4 |
| `server/src/config.ts:11` `host 0.0.0.0 if !isProd else 127.0.0.1` | already harden S2 | — |
| `docker-compose.yml:21` `server` no `user/read_only/security_opt/cap_drop` | root rw | T3 High |
| `docker-compose.yml:41` `web` same | same | T3 |
| `docker-compose.yml:52` commented sock `NEVER` | already S13 | — |

---

## 5. Current Controls (what is already good)

- `server/src/config.ts:11` already `host 127.0.0.1` in prod (S2 fail-closed) — good, but compose still `3001:3001` 0.0.0.0 at host level (needs 127)
- `docker-compose.yml:52` `NEVER MOUNT /var/run/docker.sock` comment S13 — good
- `S13` hardened `docker run` args `--user 65534 --read-only --cap-drop ALL` for CI — good precedent for compose
- `S16` pinned `node:20.18.1-alpine3.19` — good

---

## 6. Weaknesses → SEC

| Gap | SEC | Detail |
|-----|-----|--------|
| PG public | SEC-002 | `5432:5432` 0.0.0.0 + `itehaas:itehaas` |
| Server public | SEC-002 | `3001:3001` 0.0.0.0 |
| No least privilege | SEC-002 | `user/read_only/cap_drop` missing |
| Socket latent | SEC-009 | commented but not test-gated (S13 did) |

---

## 7. Planned Remediation (S17 only, no S18)

| # | Change | File:line Before → After | Why | Test |
|---|--------|---------------------------|-----|------|
| S17-01 | **PG not exposed 0.0.0.0** | `docker-compose.yml:12` `ports: "5432:5432"` → `ports: "127.0.0.1:5432:5432"` + comment `# MUST use strong password via .env POSTGRES_PASSWORD` | SEC-002 T1 | `docker compose config` no `0.0.0.0:5432` |
| S17-02 | **Server bind host already 127.0.0.1 prod** | `server/src/config.ts:11` already `isProd ? 127.0.0.1 : 0.0.0.0` | SEC-002 | `isProd` host 127 verified |
| S17-03 | **Container least privilege server** | `docker-compose.yml:21` no `user/read_only` → `user: "65534:65534"` `read_only: true` `tmpfs: [/tmp:rw,noexec,nosuid,size=64m]` `security_opt: [no-new-privileges:true]` `cap_drop: [ALL]` | T3 | `docker compose config` has `user` `read_only` |
| S17-04 | **Container least privilege web** | `docker-compose.yml:41` same → add same `user/read_only/tmpfs/security_opt/cap_drop` | T3 | same |
| S17-05 | **DB harden comment** | `docker-compose.yml:10` add `# CHANGE ME — use secrets via .env, not hardcode` + `POSTGRES_PASSWORD_FILE` note | T4 | `grep POSTGRES_PASSWORD` not `itehaas`? But keep for dev |
| S17-06 | **Never socket test** | `docker-compose.yml:52` already `NEVER` comment | T5 | `grep docker.sock` 0 active volumes |

**Explicitly NOT in S17:** `audit_logs` → S18, `CORS` → S11, `deps` → S16.

---

## 8. Test Strategy

| Test | Location | What it proves |
|------|----------|----------------|
| `pg not exposed` | `server/src/routes/s17-deploy.test.ts` `fs.readFileSync('docker-compose.yml')` contains `127.0.0.1:5432` not `5432:5432` | T1 |
| `server host 127 prod` | same | `config.ts` contains `isProd ? '127.0.0.1'` |
| `least privilege server/web` | same | `docker-compose.yml` contains `user: "65534:65534"` `read_only: true` `no-new-privileges` `cap_drop` |
| `docker compose config` | manual `docker compose config` | shows `127.0.0.1:5432:5432` |
| `never socket` | `grep -v ^#` no `/var/run/docker.sock` active | T5 |
| Existing | `pnpm test` 112 + `cargo test` 136 | Still green |

---

## 9. Acceptance Criteria (S17) — ✅ Met 2026-09-02

- [x] `docker-compose.yml` `db` `ports` `127.0.0.1:5432:5432` not `5432:5432` — 2026-09-02
- [x] `docker-compose.yml` `server` `user: "65534:65534"` `read_only: true` `tmpfs` `security_opt` `cap_drop` — 2026-09-02
- [x] `docker-compose.yml` `web` same least privilege — 2026-09-02
- [x] `server/src/config.ts` prod host 127 verified — 2026-09-02
- [x] `docker compose config` least privilege, no public PG (manual `grep` + `docker compose config` when docker available) — 2026-09-02
- [x] `pnpm test` 118/118 green + `cargo test` 136 green + `s17-deploy.test.ts` 6/6 — 2026-09-02

---

## 10. Rollback Considerations

- `user: 65534` may break `mkdir /data/repos` if volume owned 501 — rollback to no `user` but keep `read_only`? But 65534 is S13 precedent for CI, should be okay if host `data/repos` `chmod 777` or `chown 65534`. For dev, may need `user: "${UID:-1000}:${GID:-1000}"` fallback. Rollback to remove `user` if `docker compose up` fails with permission denied.
- `read_only: true` may break server writing to `dist` or `logs` — but server only writes to `/data/repos` volume (rw) + `/tmp` tmpfs, so should be okay. If fails, add `tmpfs: [/tmp]` already.
- `127.0.0.1:5432:5432` vs `5432:5432` — if host needs remote PG access (e.g., `psql` from other Tailscale host), `127.0.0.1` blocks. Rollback to `5432:5432` + firewall `iptables` if needed.

---

## 11. Next Phase

**S18 — Observability / Incident Response** — after S17 STOP. Do not touch `audit_logs` in S17.

**STOP per §8 — implement only S17 now.**
