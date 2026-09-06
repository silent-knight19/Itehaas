# Itehaas — Incident Response

**For single-laptop self-hosted (Tailscale) — Fresh S18**

## 1. Roles

- **Owner:** Sachin (on-call) — `silent-knight19` GitHub
- **Contact:** via Tailscale `itehaas.tailnet` + email

## 2. Detection (current tooling)

- Logs: pino JSON (`docker compose logs server`), `warn` on every 401/403 (`auth_failure`)
  and 429 (`rate_limited`) with `userId/ip/userAgent`; 500s carry `correlationId`.
- Metrics: `GET /metrics` — `itehaas_auth_failures_total` (401/403 spike),
  `itehaas_rate_limited_total` (429 spike), `itehaas_audit_logs_total`,
  `itehaas_ci_pipelines_total`, `itehaas_http_requests_by_status`.
- Audit trail: `SELECT action, target, ip, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 100`
  Key actions: `auth.login_failure`, `auth.lockout`, `auth.password_change_*`,
  `auth.sessions_revoked_all`, `repo.delete`, `repo.visibility`, `repo.member_*`,
  `org.member_*`, `team.*`, `ci.secret_create/delete/rotate`,
  `ci.secret_decrypt_failure`, `ci.secret_strip_fork`, `ci.pipeline_trigger/complete`,
  `ssrf.blocked`, `vcs.object_rejected`.
- What is deliberately NOT in the DB (flood control): per-429 rows and per-403 rows
  live in metrics/logs only; secret VALUES never appear anywhere (S9).

## 3. Classification

| Severity | Example | Response |
|----------|---------|----------|
| SEV1 | Host RCE via CI, DB exfil | Shutdown, rotate secrets, restore from backup |
| SEV2 | Private repo leak via CORS/BOLA | Revoke sessions, patch, notify users |
| SEV3 | DoS via bomb | Block IP, rate-limit, restart |

## 4. Containment (all scenarios start here)

1. `docker compose stop server web` (keep `db` up for forensics)
2. `tailscale down` if remote exposure is suspected
3. Snapshot evidence FIRST: `pg_dump -Fc "$DATABASE_URL" -f /hdd/forensics/pg_$(date +%F_%H%M).dump`
   and `cp -a data/repos data/repos.forensic.$(date +%s)` (never `rm -rf` the original)

## 5. Scenario playbooks

### 5a. Credential compromise (password guessed/stuffed)

1. Contain (§4). Triage: `auth.login_failure` + `auth.lockout` rows by `ip`/`target`.
2. Force logout everywhere: `psql "$DATABASE_URL" -c "DELETE FROM sessions WHERE user_id='<id>'"`,
   or per-user `POST /api/auth/sessions/revoke-all` once they re-authenticate.
3. Victim changes password (`POST /api/auth/password` revokes all other sessions).
4. Look for post-login abuse in `audit_logs` (`repo.delete`, `repo.visibility`, `*.member_*`).

### 5b. Session compromise (cookie/Bearer theft)

1. Contain (§4). Identify sessions: correlate `auth.login_success` ip/userAgent anomalies.
2. `DELETE FROM sessions WHERE user_id='<id>'` (immediate global revocation).
3. Rotate `COOKIE_SECRET` (`openssl rand -base64 32` → `.env` → restart) — invalidates
   every session and CSRF token at once. Note: this also orphans `ci_secrets`
   ciphertext (S9) — follow with the secret playbook step 3.

### 5c. CI secret compromise (leaked build log / exfiltration)

1. Contain (§4) + stop CI quickly (no runner service to stop; builds finish in ≤30s).
2. Revoke at the provider first (AWS keys, tokens), then delete in-app:
   `DELETE /api/repos/:owner/:repo/ci/secrets/:KEY` (audited).
3. Re-issue the secret, then bulk-heal: `POST /api/repos/:owner/:repo/ci/secrets/rotate`.
4. Triage: `ci.secret_strip_fork` rows (was the run untrusted?), `ci.secret_decrypt_failure`
   rows, and the stored job logs (`GET .../ci/jobs/:id/logs`) for the leaked value.

### 5d. Repository compromise (wrong visibility / rogue member / deleted repo)

1. Contain (§4). Triage: `repo.visibility`, `repo.member_*`, `team.repo_*`, `repo.delete` rows.
2. Revert: visibility back to `private` (`PATCH /api/repos/:o/:r`), remove rogue
   members/teams, restore deleted repos from `data/repos.forensic.*` + `pg_dump`.
3. If objects were pushed maliciously: `POST .../refs/heads/:branch` with `--force`
   to a known-good hash (audited `push`), then `itehaas fsck`.

### 5e. Host Compromise — Immediate Response

**Trigger:** SEV1 RCE via CI runner, Tailscale exposure beyond loopback, or DB
probing (watch `auth_failures_total` + `pg` logs).

1. `tailscale down` (or `tailscale serve reset`) — cut remote access.
2. `docker compose stop server web db` + `docker system prune -f` — remove a possibly tainted `alpine:3.19` layer set.
3. Forensics snapshot (§4): `pg_dump` + `cp -a data/repos`.
4. `psql "$DATABASE_URL" -c "DELETE FROM sessions"` — force re-login everywhere.
5. Rotate everything: `COOKIE_SECRET` (`openssl rand -base64 32`), DB password
   (`openssl rand -base64 24`), `SECRET_ENCRYPTION_KEY` (then per-repo
   `POST /ci/secrets/rotate`), `DATABASE_URL` in `.env`.
6. `audit_logs` triage: `SELECT * FROM audit_logs WHERE action IN
   ('repo.delete','auth.login_failure','auth.lockout','ci.secret_create','ssrf.blocked','vcs.object_rejected')
   ORDER BY created_at DESC LIMIT 100`, plus `itehaas_auth_failures_total` /
   `rate_limited_total` spikes in metrics.
7. `docker compose build --no-cache && docker compose up -d` from pinned images.
8. Drill quarterly: `tailscale down` + `pg_dump` + prune rehearsal; confirm a
   `repo.delete` (or drill-marker) row lands in `audit_logs` afterwards.

### 5f. CI runner compromise (malicious workflow executed)

1. The runner is assumed compromised by design (S10): untrusted builds get no
   secrets, no network, read-only workspace. Verify: `ci.secret_strip_fork` row for
   the pipeline; job logs for exfiltration attempts (they run ≤30s).
2. If a trusted-context build is suspect, treat as 5c (secret) + 5e (host) combined.
3. Purge: `docker system prune -f`; review the workflow file that ran.

### 5g. Database compromise (dump exfiltrated)

1. Password hashes are argon2id (expensive to crack) and CI secrets are AES-GCM —
   but rotate anyway: DB password, `COOKIE_SECRET`, `SECRET_ENCRYPTION_KEY` (+ bulk
   `POST /ci/secrets/rotate` per repo), user passwords (notify + revoke sessions).
2. Move to the S8 least-privilege role (`011_db_roles.sql` runbook, `DATABASE_APP_URL`)
   so the next dump is DML-only.
3. Restore from the last pre-incident `pg_dump` after rotation; verify `_migrations`.

## 6. Recovery

- `fsck` all repos: `find data/repos -name .itehaas -execdir itehaas fsck \;`
- Migration check: `pnpm --filter server migrate` (applies `_migrations` in order)
- Verify `GET /health` + `pnpm test` + `cargo test`
- Restore PG from last good dump if needed (rehearse against a scratch DB first)

## 7. Lessons Learned

- File new `FSEC-xxx` rows in `docs/security/vulnerability-register.md`
- Add adversarial regression tests (per-phase `*-fresh` suites)
- Update `PLAN.md` Security Program checkboxes
- Rotate Tailscale auth key after SEV1

## 8. Contact & Escalation

- GitHub Issues: `https://github.com/silent-knight19/Itehaas/issues` (label `security`)
- Email: (add `SECURITY.md` contact)
- If SEV1, notify all repo owners via `activity` + `notifications` broadcast

## 9. Forensics (preservation)

- Do not `rm -rf data/repos` — copy to `data/repos.forensic.$(date +%s)`
- `tar czf /hdd/forensics/logs_$(date +%s).tgz` of `docker compose logs`
- `git log --patch` for recent commits, `docker history`
- `audit_logs` is append-mostly: never UPDATE/DELETE rows except the 90-day
  retention prune (`pruneAuditLogs`, `AUDIT_RETENTION_DAYS`); export before pruning
  if an investigation is open
