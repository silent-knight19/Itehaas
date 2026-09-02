# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| main (S0 audit 2026-09-02) | ✓ — audit complete, P0 fixes pending |
| < 0.1.0 | ✗ |

Itehaas is self-hosted on a single laptop (Vivobook, Tailscale). No managed SaaS yet.

## Current Posture (2026-09-02)

S0 audit found **5 Critical + 9 High** findings. See `docs/security/initial-security-assessment.md` and `vulnerability-register.md`. **Do not trust private repos until Security Phase 1 complete.**

- Critical: fail-open defaults (SEC-001), exposed PG (SEC-002), CI secrets plaintext + host RCE fallback (SEC-007/008), next.js critical (SEC-019)
- High: CORS any-origin (SEC-003), no CSRF (SEC-004), no rate limit (SEC-005), env leak (SEC-006), authZ gaps (SEC-011), path/symlink (SEC-012/013), DoS/bomb (SEC-014/015)

## Reporting a Vulnerability

- GitHub private: `Security → Report a vulnerability` on https://github.com/silent-knight19/Itehaas
- Email: (add maintainer email)
- Include: `SEC-xxx` if known, reproduction `curl` or repo `tests/security/repositories/` corpus, affected file:line, logs redacted

We will acknowledge within 48h, fix P0 within 7d, disclose after patch + regression test.

## Hardening Status

See `PLAN.md` Security Program Phases 0-7 and `docs/security/security-scorecard.md` (Weak→Basic current).

- Phase 0 recon: **complete**
- Phase 1 critical fixes: **next** (fail-closed, CORS allowlist, helmet+CSP+CSRF, env allowlist, CI sandbox, dep updates)

## Running Securely Until Phase 1

- Set `.env` random `DATABASE_URL` and `COOKIE_SECRET` (32+ chars), never default.
- `docker-compose.yml` → `ports: ["127.0.0.1:5432:5432"]` or remove, `HOST=127.0.0.1` not `0.0.0.0`
- `NODE_ENV=development` until fail-closed lands
- Never enable `runner` Docker socket mount
- Run `pnpm audit --prod` and `cargo clippy` locally before push

## References

- `docs/security/threat-model.md`, `attack-surface.md`, `security-architecture.md`, `vulnerability-register.md`, `ci-threat-model.md`, `secure-coding-guidelines.md`, `security-testing.md`, `incident-response.md`
