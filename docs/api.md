# Itehaas — API Specification (Phase 6)

> Fastify + PostgreSQL + Rust `itehaas` spawn. Base URL `http://localhost:3001`.

## Conventions

- Content-Type `application/json`, cookies `itehaas_session` httpOnly.
- Auth: `POST /api/auth/{register,login}` sets `Set-Cookie: itehaas_session=<uuid>; HttpOnly; SameSite=Lax; Path=/` (secure in prod). Subsequent requests send `Cookie: itehaas_session=...`.
- Errors: `{ error: string }` with 400/401/403/404/409/500.
- Hash regex: `^[0-9a-f]{64}$` (SHA-256) validated in `server/src/lib/vcs.ts:11`.
- Owner/repo regex: `^[a-zA-Z0-9._-]{1,100}$` validated in `server/src/lib/vcs.ts:24` and `server/src/routes/repos.ts:4`.

## Health

```
GET /health → { ok: true, version: "0.1.0" }    # server/src/index.ts:19
```

## Auth (`server/src/routes/auth.ts:7`)

### POST /api/auth/register

```json
{ "username": "alice", "email": "alice@example.com", "password": "longenough123" }
```

- Validates `username 3-32 ^[a-zA-Z0-9._-]{3,32}$` (`server/src/lib/auth.ts:12`), `email`, `password 8-128` (`server/src/lib/auth.ts:19`).
- `argon2id` hash (`server/src/lib/auth.ts:4`), `INSERT INTO users` (`server/src/routes/auth.ts:31`), unique `23505` → 409 `username/email taken`.
- Creates session `INSERT INTO sessions` (`server/src/routes/auth.ts:39`) expiry `+30d` (`server/src/lib/auth.ts:35`), sets cookie.
- `201 { user: { id, username, email } }`, `400`, `409`.

```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","email":"alice@example.com","password":"longenough123"}' -i
```

### POST /api/auth/login

```json
{ "username": "alice", "password": "longenough123" }
# username may be username OR email (server/src/routes/auth.ts:74 WHERE username=$1 OR email=$1)
```

- `argon2.verify` (`server/src/lib/auth.ts:8`), creates new session.
- `200 { user }`, `401 invalid credentials`, `400`.

### POST /api/auth/logout

- Deletes `sessions WHERE id=$1` (`server/src/routes/auth.ts:99`), clears cookie.
- `200 { ok: true }`

### GET /api/auth/me

- Requires `Cookie: itehaas_session`. Joins `sessions s JOIN users u WHERE s.id=$1 AND expires_at > now()` (`server/src/routes/auth.ts:110`).
- `200 { user }`, `401`.

---

## Repositories (`server/src/routes/repos.ts:11`)

All VCS delegation via `server/src/lib/vcs.ts:33` `execItehaas(['init'|'branch'|'log'|'cat-file'|'fetch'|'push'|'pull'], { cwd: repoPath })` with `repoPathFor(owner,repo)` (`server/src/lib/vcs.ts:24`) validated `startsWith(resolve(reposRoot)+sep)` (`server/src/lib/vcs.ts:17`), timeout 30s, output cap 1MiB.

### POST /api/repos — Create

Requires auth (`server/src/middleware/auth.ts:15` `requireAuth`).

```json
{ "name": "myrepo", "description": "demo", "visibility": "private" } // visibility enum public|private
```

- Checks `SELECT id FROM repositories WHERE owner_id=$1 AND name=$2` → 409 if exists (`server/src/routes/repos.ts:30`).
- Transaction `BEGIN` → `INSERT INTO repositories` + `INSERT INTO repository_members admin` → `COMMIT` (`server/src/routes/repos.ts:35`). Rollback on failure.
- FS: `mkdir -p $(REPOS_ROOT)/<owner>` then `execItehaas(['init', repoPath])` (`server/src/routes/repos.ts:60`). On failure, `DELETE FROM repositories WHERE id=$1` rollback.
- `201 { repo: { id, name, description, visibility, default_branch, created_at, owner } }`

```bash
curl -X POST http://localhost:3001/api/repos \
  -H 'Content-Type: application/json' -H 'Cookie: itehaas_session=...' \
  -d '{"name":"myrepo","description":"demo","visibility":"private"}'
# creates data/repos/alice/myrepo/.itehaas
```

### GET /api/repos — List

Optional auth. Pagination `?limit=1..100&offset=0` (clamped `server/src/routes/repos.ts:70`). Returns public + owned + member repos ordered `updated_at DESC`.

- Anonymous: `WHERE visibility='public'`
- Authenticated: `WHERE visibility='public' OR owner_id=$1 OR EXISTS (SELECT 1 FROM repository_members ...)` (`server/src/routes/repos.ts:80`).

`200 { repos: [...] }`

### GET /api/repos/:owner/:repo — Get

- Validates `owner/repo` regex, looks up `SELECT r.id... FROM repositories r JOIN users u WHERE u.username=$1 AND r.name=$2` (`server/src/routes/repos.ts:100`).
- `canRead(repoId, userId, visibility)` (`server/src/lib/permissions.ts:4`): public → true; private → owner or member.
- `404` if not found or no read, `200 { repo }`.

### PATCH /api/repos/:owner/:repo — Update (admin)

Requires auth, `isAdmin(repoId,userId)` (`server/src/lib/permissions.ts:19` owner or `role=admin`). Body `{ description?, visibility?, default_branch? }` (`server/src/routes/repos.ts:140`).

`200 { repo }`, `403`.

### DELETE /api/repos/:owner/:repo — Delete (owner only)

Requires auth, `owner === user.username` (`server/src/routes/repos.ts:190`). `DELETE FROM repositories WHERE id=$1` cascades `repository_members`; FS `rm -rf repoPath`.

`200 { ok: true }`

### GET /api/repos/:owner/:repo/branches

Requires `canRead`. Runs `execItehaas(['branch'], {cwd})` (`server/src/routes/repos.ts:312`), parses `* branch` lines.

`200 { branches: ["main","feature"] }`

### GET /api/repos/:owner/:repo/log?max_count=100

Requires `canRead`. Runs `execItehaas(['log','--oneline','--max-count',String(maxCount)], {cwd})` (`server/src/routes/repos.ts:339`), clamps `1..200`. Empty repo → `commits: []` if `stderr includes 'no commits yet'`.

`200 { commits: [{hash,message}] }`

### GET /api/repos/:owner/:repo/tree/:hash

Requires `canRead`. Validates `hash ^[0-9a-f]{64}$`, runs `execItehaas(['cat-file','-p',hash],{cwd})` (`server/src/routes/repos.ts:368`).

`200 { content: string }`, `400 invalid hash`, `404 not found`.

---

## Members (`server/src/routes/repos.ts:220`)

### GET /api/repos/:owner/:repo/members

Requires `canRead`. `SELECT u.username, u.email, m.role FROM repository_members ...` (`server/src/routes/repos.ts:230`).

### POST /api/repos/:owner/:repo/members

Requires auth + `isAdmin`. Body `{ username, role: "read"|"write"|"admin" }` (`server/src/routes/repos.ts:250`). Looks up `users WHERE username`, `INSERT INTO repository_members` 409 if exists.

`201 { ok, username, role }`

### DELETE /api/repos/:owner/:repo/members/:username

Requires admin. Deletes `repository_members WHERE repo_id=$1 AND user_id=$2`, 400 if removing owner, 404 if not member.

### PATCH /api/repos/:owner/:repo/members/:username

Requires admin. Body `{ role }`, `UPDATE repository_members SET role=$1` (`server/src/routes/repos.ts:310`).

---

## Remotes & Sync (`server/src/routes/repos.ts:400`)

Delegates to `itehaas` filesystem transport (`vcs/src/remote.rs:10`). HTTP remotes not supported (`http→Other`).

### GET /api/repos/:owner/:repo/remotes — List

Requires `canRead`. `execItehaas(['remote','-v'],{cwd})` parse `name url (fetch)`.

### POST /api/repos/:owner/:repo/remotes — Add (admin)

Body `{ name, url }`, `execItehaas(['remote','add',name,url],{cwd})` 409 if exists.

### DELETE /api/repos/:owner/:repo/remotes/:name — Remove (admin)

`execItehaas(['remote','remove',name],{cwd})`.

### POST /api/repos/:owner/:repo/fetch — Fetch (requires read)

Body `{ remote?: string default origin }` (`server/src/routes/repos.ts:430`). `execItehaas(['fetch',remote],{cwd})` → `200 { ok, remote, output }`, 500 on error.

### POST /api/repos/:owner/:repo/push — Push (requires write)

Body `{ remote?: string, branch?: string, force?: boolean }` (`server/src/routes/repos.ts:455`). Requires `canWrite(repoId,userId)` (`server/src/lib/permissions.ts:11` owner or `write|admin`). `execItehaas(['push',remote,branch,'--force'?],{cwd})` → 409 on `non-fast-forward`, `200 { ok, output }`.

### POST /api/repos/:owner/:repo/pull — Pull (requires write)

Body `{ remote?, branch? }` (`server/src/routes/repos.ts:480`). `execItehaas(['pull',remote,branch],{cwd})`.

---

## Error Codes

- `400` validation (zod, regex, hash)
- `401` not authenticated / session expired
- `403` forbidden (write/admin required)
- `404` not found (masked for private repos)
- `409` conflict (duplicate repo/member, non-ff push)
- `500` internal / vcs init failed

See `docs/security.md` for validation details, `docs/database.md` for schema.
