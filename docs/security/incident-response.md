# Itehaas — Incident Response

**For single-laptop self-hosted (Vivobook, Tailscale)**

## 1. Roles

- **Owner:** Sachin (on-call) — `silent-knight19` GitHub
- **Contact:** via Tailscale `itehaas.tailnet` + email

## 2. Detection

- Logs: `server` pino `level: info` → `docker logs server` or `journalctl`
- Metrics: `GET /metrics` counters `http_request`, `ci_pipelines`
- PG: `SELECT * FROM activity ORDER BY created_at DESC LIMIT 50` (suspicious `repo.delete`, `visibility` changes)
- Alerts: (future) rate-limit 429 spike, 401 spike, CI secret access

## 3. Classification

| Severity | Example | Response |
|----------|---------|----------|
| SEV1 | Host RCE via CI, DB exfil | Shutdown, rotate secrets, restore from backup |
| SEV2 | Private repo leak via CORS/BOLA | Revoke sessions, patch, notify users |
| SEV3 | DoS via bomb | Block IP, rate-limit, restart |

## 4. Containment

1. `docker compose stop server runner` (or `systemctl stop itehaas`)
2. `tailscale down` if public exposure suspected
3. `iptables -A INPUT -p tcp --dport 5432 -j DROP` (PG)
4. Snapshot `data/repos` + `pg_dump itehaas > /hdd/backups/itehaas_$(date +%F).sql`

## 5. Eradication

- `git checkout` fix commit, `pnpm audit fix`, `cargo update`
- Rotate: `COOKIE_SECRET`, `DATABASE_URL` password, `ci_secrets` re-encrypt, `ITEHAAS_TOKEN`
- `DELETE FROM sessions` (force re-login), `docker system prune`
- Rebuild: `docker compose build --no-cache && docker compose up -d`

## 6. Recovery

- `fsck` all repos: `find data/repos -name .itehaas -exec itehaas fsck {} \;`
- `pnpm --filter server migrate` check `_migrations`
- Verify `GET /health` + `pnpm test` + `cargo test`
- Restore PG from last good `pg_dump` if needed (test via `psql itehaas_test`)

## 6a. Host Compromise — Immediate Response (S18)

**Trigger:** SEV1 Host RCE via CI runner (`docker --network none` bypass), or `tailscale` exposure `0.0.0.0` leak, or PG `5432` public scan with `itehaas:itehaas`.

**Steps (sequentially, no skip):**

1. `tailscale down` (or `tailscale serve reset`) — cut remote access, keep `ssh` via LAN if possible.
2. `docker compose stop server web db` + `docker system prune -f` — stop runner + remove compromised `alpine:3.19` if tainted.
3. `pg_dump -U itehaas -h 127.0.0.1 itehaas > /hdd/forensics/pg_$(date +%F_%H%M).sql` — preserve evidence before wipe.
4. `psql -U itehaas -c "DELETE FROM sessions"` — force re-login, invalidate `itehaas_session` `csrf_token`.
5. Rotate: `COOKIE_SECRET` `openssl rand -base64 32` → `.env` → `DELETE FROM sessions` again, `DATABASE_URL` password `openssl rand -base64 24`, `ci_secrets` re-encrypt `UPDATE ci_secrets SET value=encryptSecret(decryptOld)` via script, `ITEHAAS_TOKEN`.
6. `rm -rf data/repos.forensic.$(date +%s) && cp -a data/repos data/repos.forensic.$(date +%s)` — preserve FS for forensics, do not delete.
7. `git log --patch -20` + `docker history` + `audit_logs` `SELECT * FROM audit_logs WHERE action IN ('repo.delete','auth.login_failure','ci.secret_create') ORDER BY created_at DESC LIMIT 100` — triage.
8. `docker compose build --no-cache && docker compose up -d` — rebuild from pinned `node:20.18.1-alpine3.19` + `postgres:16-alpine` digest.
9. Drill: quarterly `tailscale down` + `pg_dump` + `docker system prune` rehearsal, verify `audit_logs` has `repo.delete` row after drill.

**Evidence:** `audit_logs` immutable, `metrics` `itehaas_auth_failures_total` spike, `rate_limited_total` spike.

## 7. Lessons Learned

- Update `docs/security/vulnerability-register.md` new SEC-xxx
- Add regression test `tests/security/sec_xxx`
- Update `PLAN.md` Security Program checkboxes
- Rotate Tailscale auth key

## 8. Contact & Escalation

- GitHub Issues: `https://github.com/silent-knight19/Itehaas/issues` (label `security`)
- Email: (add `SECURITY.md` contact)
- If SEV1, notify all repo owners via `activity` + `notifications` broadcast

## 9. Forensics (preservation)

- Do not `rm -rf data/repos` — copy to `data/repos.forensic.$(date +%s)`
- `tar czf /hdd/forensics/logs_$(date +%s).tgz server/logs pg.log`
- `git log --patch` for recent commits, `docker history`

