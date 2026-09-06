# Itehaas — Threat Model (Fresh S0 Reconnaissance)

**Version:** 3.0.0-fresh-S0
**Date:** 2026-09-03
**Role:** Principal Security Engineer
**Method:** Direct source inspection (no trust in prior S0–S19 claims). Zero functional changes.
**Scope:** `server/` (Fastify+TS), `vcs/` (Rust `itehaas`), `web/` (Next.js 14), `database/migrations/`, `docker-compose.yml` + Dockerfiles, CI runner, env/config, logging/errors.

> Treat every boundary as hostile until proven otherwise. Users, repo content, VCS objects, CI config, HTTP clients, filesystem/DB state may all be malicious or racing.

---

## 1. Assets

| Asset | Location | Impact if compromised |
|---|---|---|
| Password hashes | PG `users.password_hash` | Offline cracking → account takeover |
| Session IDs / Bearer tokens | PG `sessions.id`, cookies `itehaas_session`, `Authorization` header | Impersonation, priv-esc |
| CSRF tokens | `csrf_token` cookie + `x-csrf-token` header (HMAC of session) | CSRF → state-changing abuse |
| Private repo code/history | FS `data/repos/{owner}/{repo}/.itehaas/objects/` | IP exfiltration |
| CI secrets | PG `ci_secrets.value` (app-layer AES-256-GCM `v1:`, legacy plaintext fallback) | Cloud takeover via fork PR / log leak |
| DB credentials, `COOKIE_SECRET`, `SECRET_ENCRYPTION_KEY` | Env / `.env` / compose | Session forgery, secret decrypt |
| Host integrity | Single laptop / Docker daemon | RCE, container escape, repo destruction |
| Availability | Fastify loop, PG pool (max 10), VCS semaphore (3), disk | DoS via bombs / storms |
| Audit logs / metrics | PG `audit_logs`, `server/src/lib/audit.ts` + `metrics.ts` | Repudiation, IR blindness |

## 2. Actors

1. **Anonymous external** — malformed HTTP, brute-force, header forgery, SSRF/DoS probing. Entry: `server/src/index.ts`, `routes/auth.ts`.
2. **Authenticated low-privilege user** — horizontal (user A → user B repo/issue/PR/secret) / vertical (read→write→admin) / cross-org escalation. Entry: all `:owner/:repo` routes + `orgs.ts`.
3. **Malicious fork contributor** — adversarial branches/commits/workflows, `copyMissingObjects` pre-copy, `fork/` refs. Entry: `pulls.ts:127`, `ci.ts:runPipeline`.
4. **Hostile repo content** — malicious filenames, trees, commits, Markdown, symlinks, case variants. Entry: `vcs/src/object/*`, `checkout.rs`, `MarkdownViewer.tsx`.
5. **Compromised CI runner** — assumed-compromised container; breakout, env scan, disk/CPU abuse. Entry: `ci.ts:executeInRunner`.
6. **Compromised session / insider** — replay, fixation, stale sessions after password change.

## 3. Trust boundaries

```
[Untrusted net / browser / Tailscale]
  B1: Web<->API (HTTP/CORS/CSRF/headers)  server/src/index.ts, middleware/csrf.ts
  B2: Browser<->DOM (XSS/sanitize/CSP)     web/components/MarkdownViewer.tsx, next.config.js
  B3: Node<->PostgreSQL                    server/src/db/index.ts, routes/*.ts
  B4: Node<->Rust (privileged spawn)       server/src/lib/vcs.ts -> itehaas binary
  B5: API/Rust<->Filesystem CAS            data/repos/, vcs/src/checkout.rs, store.rs
  B6: API<->CI runner                      server/src/routes/ci.ts
  B7: CI runner<->Host                     docker run flags, NO docker.sock
  B8: Server/Rust<->External net (SSRF)    repos.ts remotes, vcs/src/remote/http.rs
  B9: Multi-tenant org/team                orgs.ts + permissions.ts
```

## 4. Data flows (abridged)

- `POST /api/auth/register|login` → zod → argon2id → `sessions` → `httpOnly SameSite=lax` + `csrf_token` cookies.
- `cookie/Bearer UUID` → `getSessionUser` (`expires_at>now()`) → `canRead/canWrite/isAdmin` (+team) → 404-mask private.
- `POST /objects/:hash` → `canWrite` → Content-Length + 64M cap → `inflateAsync` → hash verify → atomic rename.
- `POST /refs/heads/*` → `canWrite` → push RL 20/min → advisory lock + `.lock` → `isAncestor` FF → `cat-file -t==commit` → atomic ref write + reflog.
- `POST /pulls` (fork) → `copyMissingObjects(src→dst)` → `fork/{owner}/{branch}` ref → `INSERT pull_requests`.
- `POST /ci/run` → `canWrite` → 5/min + queue≤20 → `parseWorkflow` (or inline `z.any`) → `setImmediate(runPipeline)` → `decryptSecretSafe` → fork/untrusted strip → `docker run --network none ... :ro` → `maskSecretInLog` → `UPDATE ci_jobs.logs`.
- `clone/fetch/pull/push` (legacy FS + HTTP) → `repos.ts remotes` (now `https?` only) → Rust `remote.rs` (`file://` still supported in binary) / `remote/http.rs` (`SafeResolver`, `redirects(0)`).
- `GET /file/*|/history/*|/blame/*|/log?ref=` → `canRead` + `isValidFilePath/isValidBranchRef` → `execItehaas` (note: `/log?ref=` rewrites `.itehaas/HEAD` per-request).
- Markdown `blob README` → `MarkdownViewer` (`react-markdown` + `rehype-sanitize defaultSchema`, `javascript:/data:/vbscript:` → `<span>`) under prod CSP `script-src 'self'`.

## 5. Attack surfaces (per-input sinks)

**HTTP:** `register/login/password` (RL 3/5/min, lockout 5→15m, dummy argon2, generic 409); `logout` deletes supplied session ID; `password` has no RL; `:owner/:repo` regex `^[a-zA-Z0-9._-]{1,100}$` (accepts `.`/`..` as strings — contained only by `validateRepoPath`); `:hash` 40|64 hex; `file/*` double-decode + `isValidFilePath`; `ref` `isValidBranchRef` (strong) vs `pulls.ts` `source_branch` regex `^[A-Za-z0-9._/-]+$` (weak — allows `..`, `//`, `@{`); `objects/:hash` 64M + async inflate; `refs/heads/*` CAS + 423; `issues/pulls` 20/min; `search` 30/min `q 2-100 limit 20`; `global` 100/min prod/test, 2000/min dev; `contributions` 20/min + cache.

**VCS parsers:** `store.rs take(64M+1)`, header `\0` + `len==body.len` + re-hash; `parse_tree` 10k entries, mode whitelist, sorted+dup check; `parse_commit` 100 parents, 1M message, strict order; `parse_tag` same; `tree_builder` depth 100, per-dir 10k, flatten 100k + ancestor-cycle set; `pack` count 10k, entry 64M, cumulative 512M, `take(64M+1)`; `index.rs` unbounded `fs::read` + `serde_json` (no cap); `remote.rs collect_reachable_*` recursion with visited-set but no depth/count cap; `revwalk` 10k `break` (silent truncation).

**FS:** `validateRepoPath` (`startsWith(root+sep)` + `lstat` parent symlink refuse + `realpath` canonical); `checkout.rs ensure_no_symlink_and_inside_repo` (`is_forbidden_component` case-insensitive `.itehaas/.git`, 8.3 `~`, Windows reserved, trailing dot/space) + pre/post-mkdir `symlink_metadata` re-check; delete path in checkout removes without pre-check; `repoPathFor` `.`/`..` strings rely on `validateRepoPath`.

**Process:** `spawn(bin,args)` no shell; `ALLOWED_ENV {PATH,LANG,HOME,USER,TMPDIR,SHELL}` (no `DATABASE_URL`/`COOKIE_SECRET`); `isAllowedFlag` + hash allow; null/newline reject; `getValidatedBin` exists + non-world-writable + prefix hint (soft — `/tmp/` bypass, dev any-absolute warning-only); `vcsSemaphore(3)`; 30s + SIGTERM→SIGKILL; 1M output cap.

**SSRF:** `POST /remotes` requires `http(s)`, no creds, private-host block unless `ALLOW_PRIVATE_REMOTES`; `remote/http.rs SafeResolver` validates all `SocketAddr` pre-connect, `redirects(0)`, 30s/10s timeouts; hostname block `localhost/metadata.google.internal/*.internal/*.local`; env gate inconsistency (`SafeResolver` accepts `true|1`, `validate_http_base` strict `==true`); `ToSocketAddrs` best-effort (DNS failure → fail-open in `is_private_host`).

**CI:** `parseWorkflow` 64K/10 jobs/20 steps/5K run; **inline `workflow: z.any()` bypasses all YAML limits** (`ci.ts:424-434`); `executeInRunner` hardened `alpine:3.19 --network none --memory 512m --cpus 1 --pids-limit 128 --user 65534 --read-only --tmpfs --cap-drop ALL --no-new-privileges -v repo:/workspace:ro`; no host-exec fallback (`runner:unavailable`); fork strip via `is_fork_pr||fork/||!isCollaborator||missing-obj` (`maintainer` role string is dead — team-write not counted → fail-closed availability); `copyMissingObjects` runs at PR create, before CI fork check (object-existence signal polluted).

**Secrets:** `SECRET_ENCRYPTION_KEY` defaults to `COOKIE_SECRET` (`config.ts:187`) — coupled rotation; `encryptSecret v1 AES-GCM iv12+tag16`, `decryptSecretSafe` plaintext fallback (legacy rows remain decryptable = plaintext still valid); list endpoint keys-only; `maskSecretInLog` raw+url+b64+json len≥4; `pino redact authorization/cookie`; error handler generic `internal+correlationId`.

**Web:** No `dangerouslySetInnerHTML`; `FileViewer/DiffViewer` React-text escaped; avatar `https://` (+localhost dev); dev CSP `unsafe-eval/unsafe-inline + localhost:*`, prod strict.

**Config/deploy:** `validateStartupConfig` fail-closed prod (32+ secret, no defaults, no `DEBUG/TRACE`, `0.0.0.0` needs flag, DB/REPOS_ROOT/BIN checks); non-prod fallbacks `dev-secret-change-me` + `itehaas:itehaas` by design; compose loopback ports + `server/web user 65534 ro tmpfs no-new-priv cap-drop ALL` + pinned `node:20.18.1-alpine3.19` + in-image Rust build; `db` service has none of the hardening + `POSTGRES_PASSWORD:itehaas` default; `trustProxy:true` + `rateLimit keyFor x-forwarded-for` spoofable; `db` single `itehaas` superuser role, no RLS/least-privilege roles; `statement_timeout 5s`, pool max 10; advisory-lock hash 31-bit polynomial (collision); audit coverage partial (`auth.*`, `repo.delete`, `ci.secret_*` only).

## 6. Security assumptions

Single-host monolith, loopback PG or Docker net, trusted reverse proxy must strip `X-Forwarded-For` (currently trusted blindly), Tailscale-exposed, non-world-writable `REPOS_ROOT`/`ITEHAAS_BIN`, operators set strong `.env` in prod, CI container shares host kernel (no gVisor/Firecracker), no email verification / 2FA / OAuth.

## 7. What S0 did NOT do

No code/config/test edits. All findings below are **Open / needs adversarial verification**. Next phase S1 must not start until this map is accepted.
