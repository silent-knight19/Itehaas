# Itehaas — Hardened Deployment Profile (Fresh S17)

**Version:** 3.17.0-fresh-S17 · **Date:** 2026-09-03
Target: single-host self-hosting (laptop/server) via Docker Compose or bare metal.
Threat model (§6): the host, its network position, and the operator's backup discipline are in scope.

---

## 1. Container profile (all services)

| Control | db | server | web |
|---|---|---|---|
| Loopback-only ports | `127.0.0.1:5432` | `127.0.0.1:3001` | `127.0.0.1:3000` |
| Non-root | entrypoint drops to `postgres` | `65534:65534` | `65534:65534` |
| Read-only root | yes (+tmpfs `/tmp`, `/run/postgresql`) | yes (+tmpfs `/tmp`) | yes (+tmpfs `/tmp`) |
| `no-new-privileges` | yes | yes | yes |
| `cap_drop: ALL` | yes (+ minimal `cap_add` for first-boot init, see §2) | yes | yes |
| Memory bound | 1g | 1g | 512m |
| Log rotation (`10m` × 3) | yes | yes | yes |
| `restart: unless-stopped` | yes | yes | yes |
| Secrets via env, never baked | `:?` mandatory | `:?` mandatory | n/a (public URL only) |

## 2. Database notes

- `db` keeps the image default user on purpose: the postgres entrypoint needs
  root-initiated setup (chown/initdb) on first boot, then drops privileges itself.
  The minimal `cap_add` (CHOWN, DAC_OVERRIDE, SETGID, SETUID) exists only for that.
- Never expose `5432` beyond loopback. Remote admin goes through SSH + `psql`.
- Enable the S8 least-privilege role for the runtime when ready
  (`database/migrations/011_db_roles.sql` runbook, `DATABASE_APP_URL`).
- **First-boot drill (required after any compose change):** on a scratch host,
  `rm -rf pgdata data/repos && docker compose up --build -d` must reach healthy
  `db` + `200 /health` with NO `.env` defaults (expect `:?` errors without `.env`).

## 3. Host hardening checklist (bare metal + container host)

- [ ] Dedicated `itehaas` Linux user; service files/binaries not world-writable
      (`server/src/config.ts` refuses world-writable `REPOS_ROOT`/`ITEHAAS_BIN`).
- [ ] `umask 027` for the service user; `data/repos` owner-dirs are `0700` by the app.
- [ ] SSH key-only (`PasswordAuthentication no`), fail2ban or equivalent.
- [ ] Firewall: deny inbound except Tailscale interface + loopback.
- [ ] Tailscale: expose via `tailscale serve` (SAME origin for web+API so
      `SameSite=Lax` cookies work — see S12 residual); otherwise API cookies break
      across tailnet-name→localhost fetches. Set `ALLOWED_ORIGIN` + `TRUSTED_PROXIES`.
- [ ] No `docker.sock` mount anywhere (`NEVER MOUNT` — enforced by tests).
- [ ] Backups: nightly `pg_dump -Fc` + `tar` of `data/repos` to encrypted,
      access-controlled storage (`0600`, separate operator). Test restores quarterly.
      Suggested (adapt paths):
      `umask 077 && pg_dump -Fc "$DATABASE_URL" -f backup-$(date +%F).dump && tar -czf repos-$(date +%F).tgz data/repos`
- [ ] Logs: json-file rotation is composed in; ship or prune before disk fills.
- [ ] `/tmp`/`/var/tmp` world-writablesticky as usual — never place repos or secrets there.
- [ ] OS + image updates monthly (`pnpm audit`, `cargo audit`, rebuild images).

## 4. Secrets handling

- `.env` (real values) is git-ignored and never committed; `.env.example` holds
  prod-failing placeholders only. Compose refuses to boot without secrets (`:?`).
- `COOKIE_SECRET` ≠ `SECRET_ENCRYPTION_KEY`, 32+ random each; rotate quarterly
  (re-run per-repo `POST /ci/secrets/rotate`, S9 runbook).
- `POSTGRES_PASSWORD` 24+ random; rotate via `ALTER ROLE` + `.env` + restart.

## 5. Known gaps / residuals

- `db` hardening (read-only root, caps) could not be boot-verified here (no Docker
  on this machine) — the §2 drill is REQUIRED on the target host before sign-off.
- Images float minor tags (`postgres:16-alpine`) for auto-patching; digest pinning deferred (S16).
- No systemd unit shipped — run Compose with `restart:` policy, or adapt the
  commands above to a unit with `User=itehaas`, `UMask=0027`, `NoNewPrivileges=yes`.
