# Itehaas — API Security & Abuse Controls (Fresh S14)

**Version:** 3.14.0-fresh-S14 · **Date:** 2026-09-03
**Rule:** no single global limit is sufficient — every endpoint carries a cost-based
bucket. Auth = who may call; AuthZ = permission gate (private repos 404-mask);
Size = input ceiling; RL = per-client bucket/min; Errors = fail-closed mapping.

Global backstops: 100/min global (2000 dev) + 429/`Retry-After` + 401/403/429
metrics; 1M JSON body cap (S7); 5s statement timeout; pool 10 (S8).

## 1. Buckets (cost classes)

| Bucket | /min | Members |
|---|---|---|
| `global` | 100 (prod/test) | everything (backstop) |
| `login` + 5-fail/15m lockout | 5 | `POST /auth/login` |
| `register` | 3 | `POST /auth/register` |
| `password_change`, `sessions` | 5 / 10 | password change, revoke-all |
| `repo_create` | 10 | `POST /api/repos` |
| `repo_modify` | 20 | repo PATCH/DELETE |
| `fork` | 5 | fork (disk-heavy clone) |
| `object_upload` | 20 | object push (64M + inflate + quota) |
| `push` (ref CAS) | 20 | ref update |
| `fetch` (network ops) | 10 | fetch/push/pull remotes |
| `remotes` | 20 | remote add/remove |
| `repo_members`, `org_members` | 20 | membership mutations |
| `org_create` | 10 | org create (squatting) |
| `team_repos` | 10 | team↔repo grants |
| `invites` | 10 | invite creation ×3 |
| `invites_claim` | 20 | accept/reject (token backstop) |
| `issues`, `pulls` | 20 | issue/PR creation |
| `comments` | 30 | issue/PR/review comments |
| `reviews` | 20 | reviewer requests, reviews |
| `merge` | 10 | PR merge (lock + subprocesses) |
| `search` | 30 | global search |
| `users` | 60 | profile lists |
| `users:contributions` | 20 | heatmap (subprocess fan-out) |
| `branches`, `vcs_read` | 60 | branches/tree/commits/refs |
| `vcs_log` | 30 | log/history/blame |
| `vcs_diff` | 20 | diff/compare |
| `file` | 60 | file/history/blame reads |
| `stars` | 30 | star/watch toggles |
| `ci_run` | 5 + queue ≤20 | pipeline trigger |
| `ci_secrets` | 10 | secret list/create/rotate/delete |
| `ci_checks` | 20 | status-check mutations |
| `ci_reads` | 60 | pipelines/logs/artifacts polling |

Bulk-transfer endpoints (`GET objects/:hash`, `GET refs`) intentionally carry no
per-request bucket: clones issue hundreds of ranged reads. They are `canRead`-gated,
streamed (no buffering), and size-capped instead; bulk-read accounting is future work.

## 2. Endpoint catalog (abridged — full matrix in code)

Auth: `anon` | `opt` (optional session) | `auth`. Private invisible → 404.

| Endpoint | Auth | AuthZ | Size | RL | Errors |
|---|---|---|---|---|---|
| `POST /auth/register` | anon | — | 32/255/8–128 + allowlists | `register` | 400/409-generic/429 |
| `POST /auth/login` | anon | — | 1–255 / 1–128 | `login`+lockout | 401-generic/429 |
| `POST /auth/logout` | cookie | CSRF | — | global | always 200 |
| `POST /auth/password` | auth | self + current-pw | ≤128 | `password_change` | 400/401/429 |
| `POST /auth/sessions/revoke-all` | auth | self | — | `sessions` | 200 |
| `POST /api/repos` | auth | any user | 100/500/enum | `repo_create` | 400/409/429 |
| `PATCH/DELETE /:owner/:repo` | auth | admin / owner-only | 500/enum/ref | `repo_modify` | 403/404/423 |
| `POST /:owner/:repo/fork` | auth | read upstream | — | `fork` + quota | 404-mask/409/413/429 |
| `POST /objects/:hash` | auth | write | 64M + hash + quota | `object_upload` | 400/403/413 |
| `POST /refs/heads/*` | auth | write | branch+hash+FF | `push` + adv.lock | 400/403/409/423 |
| `GET /objects/:hash`, `/refs` | opt | read (404-mask) | hash | bulk (none) | 404/413 |
| reads (branches/log/…/blame) | opt | read (404-mask) | ref/path/hash | `branches/vcs_*`/`file` | 400/404 |
| `POST /fetch\|/push\|/pull` | auth | read / write / write | remote+branch+stored-URL gate | `fetch` | 400/403/404/409 |
| `POST/DELETE /remotes` | auth | admin | name+URL policy | `remotes` | 400/403/409 + `ssrf.blocked` audit |
| members/watch/stars | auth/opt | admin / read | enum/username | `repo_members`/`stars` | 403/404/409 |
| issues/PRs/comments/reviews | auth/opt | read/write/author matrix (S3) | 200/5000 + txn | `issues`/`pulls`/`comments`/`reviews`/`merge` | 400/403/404/409 |
| labels/milestones | opt/auth | read / write | 50/100 | global (low-cost, write-gated) | 400/403/404/409 |
| orgs/teams/members/invites | auth/opt | owner/admin matrix | names/roles | `org_create`/`org_members`/`team_repos`/`invites*` | 400/403/404/409/410 |
| CI run/pipelines/logs/secrets | auth/opt | write / read / admin | ref/commit/workflow caps | `ci_run`/`ci_reads`/`ci_secrets`/`ci_checks` | 400/403/404/409/413/429 |
| `GET /search` | opt | visibility-filtered | 2–100, cap 20 | `search` | 400/429 |
| `GET /users/*` lists | opt | visibility-filtered | cap 100/50k | `users`/`contributions` | 400/404 |
| `GET /health`, `/metrics` | anon | — | — | `global` | 200 |

Error behavior: 401 unauthenticated, 403 forbidden (authenticated), 404 masks
private/missing uniformly, 409 conflicts, 410 expired invites, 413 over budget,
423 locked (retry), 429 + `Retry-After`, 500 generic + `correlationId` (never paths).

## 3. Client identity (FSEC-002)

Buckets key on `getClientIp()`: socket peer unless it belongs to `TRUSTED_PROXIES`
(default loopback), in which case the leftmost `X-Forwarded-For` is used. Direct
attackers cannot rotate buckets via header spoofing; operators must set
`TRUSTED_PROXIES` to their proxy IPs and have the proxy overwrite (not append)
`X-Forwarded-For`. Login lockout keys `ip:username` with the same identity.

## 4. Residuals → S18

Member/org/team mutation audit events (repo.delete/auth.*/ci.secret_* exist);
per-bucket `rateLimitedTotal` counters; clone bandwidth accounting.
