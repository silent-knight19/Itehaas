# Itehaas — CI/CD (Phase 9)

> Job queue (in-memory, Redis/BullMQ deferred) + simulated Docker runner.

## Schema (`database/migrations/003_ci.sql:1`)

- `ci_pipelines(id, repo_id, ref, commit_hash 64, status queued|running|success|failed, created_by, created_at)` + `ci_jobs(id, pipeline_id, name, status, logs, started_at, finished_at)` + `ci_secrets(repo_id, key, value)`.

## API (`server/src/routes/ci.ts:1`)

- `POST /api/repos/:owner/:repo/ci/run {ref, commit?}` — `canWrite`, resolves HEAD via `execItehaas log` if commit missing, `INSERT INTO ci_pipelines` + 3 jobs `install|test|build`, `setImmediate(simulateRun)` — returns `201 {pipeline}`.
- `GET /api/repos/:owner/:repo/ci/pipelines` — `canRead`, lists 20 latest.
- `GET /api/repos/:owner/:repo/ci/pipelines/:id` — pipeline + jobs with logs.
- `GET /api/repos/:owner/:repo/ci/jobs/:jobId/logs`.
- `GET/POST /api/repos/:owner/:repo/ci/secrets` — admin only.

## Runner (`server/src/routes/ci.ts:30` `simulateRun`)

```
jobs = SELECT FROM ci_jobs WHERE pipeline_id
for job in jobs:
  UPDATE status=running
  execItehaas(['log','--oneline'], {cwd: repoPath}) // dummy workload
  logs = "+ itehaas log ...\n" + stdout + "\nCI simulated: ok"
  UPDATE status=success logs
pipeline status = success|failed
```

Isolation: production would be `docker run --network none --memory 512m --pids-limit 128` (see `README.md:171`, `docs/security.md:41`), never host exec. Single laptop bounded concurrency (4 workers), no K8s.

## Web

- `web/app/[owner]/[repo]/ci/page.tsx:1` lists pipelines, Run button, polls every 5s, view logs per job.

## Verification

```
POST /ci/run → {id, status: queued}
GET /ci/pipelines/:id → eventually status success, jobs logs contain "itehaas log"
GET /ci/jobs/:jobId/logs → logs
```

Secrets not logged, `ci_secrets` not exposed via logs.

## Deferred

- Redis/BullMQ (Phase 9 design) — only when job queue needs persistence/scale.
- `pipeline.yaml` (install→test→build) — currently static 3 jobs; future: read `.itehaas-ci.yml`.
- Tailscale + NVMe tiering already at `docs/storage.md:62`.

