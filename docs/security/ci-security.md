# Itehaas — CI Security (Fresh S10)

**Version:** 3.10.0-fresh-S10 · **Date:** 2026-09-03
**Rule:** the runner is a separate trust domain and is assumed compromised. Repository CI configuration (`itehaas.yml`, inline `workflow:`) is untrusted input.

---

## 1. Isolation profile (`executeInRunner`, `server/src/routes/ci.ts`)

Every job runs as `docker run --rm` with:

| Control | Flag | Purpose |
|---|---|---|
| No network | `--network none` | Blocks exfiltration, mining pools, SSRF from builds |
| Memory | `--memory 512m --memory-swap 512m` | OOM containment |
| CPU | `--cpus 1` | Noisy-neighbor / miner containment |
| PIDs | `--pids-limit 128` | Fork-bomb containment |
| File descriptors | `--ulimit nofile=1024:1024` | fd-exhaustion guard |
| Non-root | `--user 65534:65534` | No root inside container |
| Read-only root | `--read-only` + `--tmpfs /tmp:rw,noexec,nosuid,size=64m` | No persistence, no exec in tmp |
| Capabilities | `--cap-drop ALL` | No privileged ops |
| Escalation | `--security-opt no-new-privileges:true` | No setuid/sudo escape |
| Workspace | `-v <repo>:/workspace:ro` | Builds cannot tamper with repo objects |
| Image | `alpine:3.19` pinned | No `latest` drift |
| Time | 30s timeout + SIGKILL | Infinite-build guard |
| Output | 2M log cap + kill + truncation marker (S7) | Log-flooding guard |
| Script | 256K cap + YAML 64K/10-job/20-step/5K-run + inline API caps (S10) | Queue/DB/memory flood guard |

**Never present:** `--privileged`, capability adds, host PID/network namespaces,
`/var/run/docker.sock` (see §4), host env passthrough (`combinedEnv` = secrets only),
host-exec fallback (docker unavailable → `runner: 'unavailable'`, job fails closed).

## 2. Fork isolation (stricter tier)

- Untrusted = fork branch (`fork/*`), fork-linked PR (`source_repo_id` / `fork/%`), non-collaborator author, missing commit object, **or any detection error** (fail-closed latch, S10).
- Untrusted runs get **empty `secretsEnv`** + `ci.secret_strip_fork` audit. DB fork markers are authoritative; the object-existence check is advisory-only (fork objects are pre-copied at PR creation).
- Trusted runs inject decrypted secrets as container env only; logs are masked (S9).

## 3. Workflow budgets

- File-discovered workflows: 64K file, ≤10 jobs, ≤20 steps/job, `run` ≤5000 chars (S13).
- API-supplied inline workflows: identical budgets enforced with 400 fail-closed (S10, FSEC-013).
- Queue: 5/min trigger RL + ≤20 queued/running per repo (S7/S14). Job rows per pipeline detail capped at 100 (S7).
- Artifacts: 20 files/dir, 10M each, symlink/traversal refusal; secret values never collected as artifacts (env-only).

## 4. Docker-socket boundary

`docker.sock` is never mounted: the commented runner stanza in `docker-compose.yml`
carries the `NEVER MOUNT` warning, `src/routes/ci.ts` contains no socket reference,
and `s10-ci`/`s13-ci` fail the build if an active (non-comment) socket mount appears.
The runner talks to the Docker **CLI on PATH** (spawns `docker run` with fixed argv);
compromise of a build container yields an unprivileged, networkless box with no
daemon access — breakout requires a kernel/container-engine 0-day, not a misconfig.

## 5. Residual risks

- Shared host kernel (no gVisor/Firecracker/Kata). Malicious builds are contained by
  the profile above, not by hardware virtualization — see incident-response for
  runner-compromise drills.
- Build containers see a read-only snapshot path of the repo; a malicious workflow
  reads (not writes) checked-in code — private-repo reads by fork builds are
  governed by the same `canRead` gates as API access (PR creation requires it).
- Docker image pulls (`alpine:3.19`) need outbound daemon access at pull time;
  pin digest for air-gap parity (future).
