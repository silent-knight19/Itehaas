# Itehaas — Security (Phase 6)

## Threat Model (single laptop, modular monolith)

- Attackers: anonymous internet via Tailscale-exposed port, malicious repo content, CI isolation (Phase 9).
- Assets: password hashes, session tokens, private repo objects on FS.
- Non-goals Phase 6: OAuth, 2FA, WebSocket.

## Authentication

- **Hashing**: `argon2id` via `argon2` (`server/src/lib/auth.ts:4` `argon2.hash(type: argon2id)`), verify `argon2.verify` (`server/src/lib/auth.ts:8`). Cost defaults (argon2 recommended). Passwords `8-128` chars (`server/src/lib/auth.ts:19`).
- **Validation**: `username ^[a-zA-Z0-9._-]{3,32}$` (`server/src/lib/auth.ts:12`), `email` simple regex length 255 (`server/src/lib/auth.ts:25`), `password` length. Zod also `z.string().min(3).max(32)` (`server/src/routes/auth.ts:11`).
- **Sessions**: UUID `gen_random_uuid()` PK (`database/migrations/001_init.sql:37`), `expires_at +30d` (`server/src/lib/auth.ts:35`), stored `sessions` table, checked `expires_at > now()` (`server/src/middleware/auth.ts:12`). Cookie `itehaas_session` `httpOnly true, sameSite lax, secure isProd` (`server/src/routes/auth.ts:42`), `path /`. Logout `DELETE` + `clearCookie` (`server/src/routes/auth.ts:99`). Opportunistic cleanup `DELETE WHERE expires_at < now()` (`server/src/middleware/auth.ts:24`).
- **Storage**: `password_hash TEXT` never returned (`SELECT id, username...` omits hash except login verification).

## Authorization

- **Visibility**: `repositories.visibility` `public|private` (`database/migrations/001_init.sql:20`). `canRead` (`server/src/lib/permissions.ts:4`) public → true, private → `isOwner` or `member` (any role). Private repos return `404` not `403` to avoid enumeration (`server/src/routes/repos.ts:108`).
- **Roles**: `repository_members.role` `read|write|admin` (`001_init.sql:32`). `canWrite` owner or `write|admin` (`server/src/lib/permissions.ts:11`), `isAdmin` owner or `admin` (`server/src/lib/permissions.ts:19`). Used: `POST /repos` any auth, `PATCH/DELETE repo` owner, `POST /members` admin, `POST /push|pull` write, `GET /branches|log|tree` read.
- **Ownership**: `repositories.owner_id FK users` + `UNIQUE(owner_id,name)` prevents hijack.

## Input Validation

- **Hash**: `^[0-9a-f]{64}$` (`server/src/lib/vcs.ts:6` `HASH_REGEX`, `vcs/src/hash.rs:40` same). Used in `catFile` (`server/src/lib/vcs.ts:72`), `tree/:hash` (`server/src/routes/repos.ts:367`), `vcs/src/object/store.rs:90` mismatch → `CorruptObject`.
- **Owner/repo**: `^[a-zA-Z0-9._-]{1,100}$` (`server/src/lib/vcs.ts:24` `repoPathFor` regex, `server/src/routes/repos.ts:4` `validateOwnerRepo`). Prevents `../` and `//`.
- **Repo path traversal**: `repoPathFor` resolves `path.resolve(reposRoot)` and checks `resolved.startsWith(resolvedRoot+sep)` (`server/src/lib/vcs.ts:17` `validateRepoPath`), throws `path traversal not allowed`. Also `repoPath.includes('\0')`. All `execItehaas` calls use `repoPathFor` result as `cwd` only, never interpolated.
- **VCS args**: `execItehaas` validates `arg.includes('\0')` (`server/src/lib/vcs.ts:41`), no shell (`spawn(bin, args)` not `exec`), timeout 30s (`server/src/lib/vcs.ts:35`), output cap 1MiB (`server/src/lib/vcs.ts:5`), kill `SIGTERM→SIGKILL`.
- **Zod**: All `POST/PATCH` bodies use `z.object` safeParse (`server/src/routes/auth.ts:15`, `repos.ts:25`). Repo `name` regex, `description max500`, `visibility enum`.
- **SQL injection**: All `query(text, params)` use `$1` placeholders (`server/src/routes/repos.ts` etc.), no string concat. `LIMIT/OFFSET` clamped integers inline (`server/src/routes/repos.ts:70`) but derived from `parseInt` not user string.

## CSRF / XSS

- **Cookies**: `httpOnly true` prevents JS read, `SameSite=Lax` blocks cross-site POST from third-party (`server/src/routes/auth.ts:42`). `secure` in prod.
- **CSRF token**: Phase 6 baseline is `SameSite`. Helper `csrfTokenForSession` (`server/src/lib/auth.ts:42`) provided for future double-submit; not required for API-inject tests. Web (Phase 7) will add `X-CSRF-Token` header check.
- **CORS**: `fastifyCors { origin: true, credentials: true }` (`server/src/index.ts:14`) — allows any origin with credentials in dev; restrict to explicit allowlist in prod (TODO).
- **XSS**: API returns JSON only, no HTML injection. Future `Next.js` will escape README rendering.

## Rate Limiting & Abuse

- Not yet enforced (deferred). Recommended: `@fastify/rate-limit` on `/api/auth/*` (e.g., 5/min per IP) before production. `cleanupExpiredSessions` limits session bloat.

## Secrets

- `COOKIE_SECRET` `server/src/config.ts:15` default `dev-secret-change-me` — must override via `env COOKIE_SECRET` in prod. `DATABASE_URL` default `postgres://itehaas:itehaas@localhost:5432/itehaas` (`server/src/config.ts:8`) — change password in `docker-compose.yml:9` and `server/.env.example:1`.
- `.env` gitignored (`.gitignore:58`), `.env.example` committed.

## Filesystem / VCS

- **Atomic**: `flate2` store `tempfile→rename` (`vcs/src/object/store.rs:50`), index `tempfile→rename` (`vcs/src/index.rs:76`), refs `tempfile→rename` (`vcs/src/refs.rs:70`).
- **Size limit**: `64 MiB` object cap (`vcs/src/object/store.rs:20` `ObjectTooLarge`) mitigates zlib bomb.
- **Path traversal in VCS**: `index::should_ignore` skips `.itehaas|.git` (`vcs/src/index.rs:136`), `add` via `strip_prefix(repo)` (`vcs/src/main.rs:475`), `checkout` deletes only within `repo`.

## Network

- Single-machine `Tailscale` (replaceable Headscale) (`docs/architecture.md:28`). No public port-forward.
- `docker-compose.yml:5` `postgres:16-alpine` `pgdata` volume, healthcheck `pg_isready`.

## Future (Phase 9+)

- CI runner `docker run --network none --memory 512m --pids-limit 128` never host exec (`README.md:171`).
- `argon2` tuning, `BTreeMap` index signing, `packfiles` verification.
