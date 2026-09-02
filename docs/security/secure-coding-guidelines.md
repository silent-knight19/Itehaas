# Itehaas — Secure Coding Guidelines

**For contributors: Rust + Node + Next.js + Postgres + Docker**

## 1. Fail-Closed Configuration

- In `server/src/config.ts`, if `NODE_ENV=production` and any of `DATABASE_URL`, `COOKIE_SECRET`, `REPOS_ROOT`, `ITEHAAS_BIN` is default/insecure, `throw` on import — refuse to start. Never silently use dev defaults in prod.

## 2. Input Validation (allowlist, not blocklist)

- **owner/repo:** `^[a-zA-Z0-9._-]{1,100}$` everywhere (already `repoPathFor`). Never build paths via string concat without `validateRepoPath`.
- **hash:** `^(?:[0-9a-f]{40}|[0-9a-f]{64})$` (already `validateHash`). Reject short/upper before generic.
- **branch:** use `refs::validate_branch_name` rules: no `..`, `//`, leading `.`, `~^:?*[\`, `.lock`, `@{`, len 1..100.
- **Body:** `zod` `safeParse` on every `POST/PATCH`, `max` limits (title 200, body 5000, description 500).

## 3. Path & Filesystem

- After `path.join(root, userPath)`, do `fs.realpathSync(parent)` then `startsWith(root+sep)` — use `lstat` not `stat` to detect symlink parents.
- `checkout`/`collectArtifacts` must `lstat` before `create_dir_all`/`readdir`; refuse if symlink.
- Use `tempfile::NamedTempFile::new_in(dir)` + `persist` (already) — never `write` directly to final path.
- For CI workspace, never `docker -v repo:/workspace`; use `tar` copy with `--no-dereference`.

## 4. Process Execution

- Only `spawn(bin, args, {shell:false})` — never `exec`, `execFile` with shell, `sh -c` with user data.
- `env` must be allowlist: `{PATH, LANG, HOME, GIT_*}` only — never `process.env` wholesale. Add secrets explicitly and minimally.
- `cwd` must be from `repoPathFor` only — never from query.
- `timeout` + `MAX_OUTPUT 1M` + `SIGTERM→SIGKILL` already — add semaphore `maxConcurrent 3`.
- `ITEHAAS_BIN` must be pinned and `fs.stat` + `mode` check not writable by other.

## 5. Authorization

- Centralize: wrap routes with `preHandler: requirePerm(level)` that does `getSessionUser` + `canRead/canWrite/isAdmin` + 404-mask private. No manual `if (!canRead) 404` scattered.
- Maintain matrix in `docs/security/vulnerability-register.md` and test `Alice/Bob/Charlie × public/private`.
- `canRead` for **read-only**; `canWrite` for **create** (issues/PRs/comments); `isAdmin` for **members/visibility/delete/secrets**.

## 6. Authentication & Sessions

- Rate limit `login 5/min` `register 3/min` per IP. Add `failed_attempts` table + lockout 15 min after 5 fails.
- `argon2` costs: `memoryCost 64MiB`, `timeCost 3`, `parallelism 1` (tune on Vivobook).
- Rotate session on login, invalidate on logout, clear on password change.

## 7. XSS & Frontend

- Never `dangerouslySetInnerHTML`, never `rehype-raw`. Use `react-markdown` + `rehype-sanitize`.
- CSP `default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'` + `helmet.hsts` + `X-Content-Type-Options nosniff`.
- Validate `avatar_url` to `https://` allowlist; reject `javascript:`, `data:`.
- Escape all `commit.message` etc via React text (already) — never `innerHTML`.

## 8. SSRF

- For any outbound `fetch` (remote http, avatar fetch if added, webhook if added), `validate_http_base` allowlist `host` + path `/api/repos/...`, block `127/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`, `::1`, `fc00::/7`. Resolve DNS then check IP. Limit redirects 0 or 1 with re-validation.

## 9. Secrets

- Never log `Authorization`, `Cookie`, `DATABASE_URL`, `ci_secrets.value`. `pino` `redact: ["req.headers.authorization", "req.headers.cookie", "databaseUrl"]`.
- DB `ci_secrets.value` must be ciphertext (`age` or `libsodium crypto_secretbox`). Never return value via API; `GET /secrets` returns `key + created_at` only.
- Runner logs must scrub `value` → `***` before `INSERT logs`.

## 10. Resource Limits

- Decompression: `take(64M+1)` before `read_to_end`, reject if >64M.
- Graph walk: `MAX_DEPTH 2048`, `MAX_OBJECTS 100k`, `MAX_COMMITS 10000`, `MAX_BRANCHES 100`.
- Search: `q` max 100 chars, `limit` 1..50, `offset` 0..10000, trigram `GIN` already but add `statement_timeout 5s`.
- PG pool `max 10` already — add `query timeout 10s`.

## 11. Error Handling

- User-facing `500` generic `error: "internal", correlationId: uuid`. Log full error with `req.id` but redacted.
- Never `reply.status(500).send({error: e.message})` where e.message contains path/stack.

## 12. Dependencies

- Run `pnpm audit --prod` in CI gate; fail on `critical`. Pin `next` to patched, `tar` overrides.
- `cargo audit` if available (install via `cargo install cargo-audit`).
- Enable Dependabot for `npm` + `cargo`.

## 13. Testing

- Every SEC-xxx gets `tests/security/sec_xxx_*` permanent regression (never delete).
- Fuzz parsers: `cargo fuzz` for `object::parse`.
- Malicious corpus: `tests/security/repositories/` with symlink/bomb/malformed cases.
- Playwright E2E for XSS/CSRF/authz.

