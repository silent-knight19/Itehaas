# Itehaas — Secrets Security (Fresh S9)

**Version:** 3.9.0-fresh-S9 · **Date:** 2026-09-03
**Rule:** secrets are never stored, transmitted, or logged in plaintext where avoidable; every access is authorized, audited, and revocable.

---

## 1. Secret inventory

| Secret | At-rest location | In-transit | Notes |
|---|---|---|---|
| CI secrets (`DEPLOY_TOKEN`, …) | PG `ci_secrets.value`, AES-256-GCM `v1:` (§2) | Decrypted server-side only; injected as container env | Never in API responses/logs |
| `COOKIE_SECRET` (session signing) | Env only, never in DB/logs | HMAC key for CSRF tokens | 32+ chars, prod fail-closed (S1) |
| `SECRET_ENCRYPTION_KEY` (CI envelope) | Env only | HKDF-SHA256 → AES key | Explicit + distinct from `COOKIE_SECRET` in prod (S1) |
| `DATABASE_URL` / `DATABASE_APP_URL` | Env only | Pool connection string | Redacted in logs; S8 least-privilege opt-in |
| Session IDs (= Bearer tokens) | PG `sessions.id` (opaque UUID) | `httpOnly` cookie or `Authorization` header | 30d expiry, revocation (S2); redact in logs |
| Login passwords | `users.password_hash` (argon2id) only | TLS (proxy) + JSON body | Never logged/returned (S2) |
| SSH keys / OAuth / webhooks | N/A — not implemented | — | Add rows here before introducing them |

## 2. At-rest storage model (`ci_secrets.value TEXT`)

- **Format:** `v1:base64(iv12 ‖ tag16 ‖ ciphertext)`, AES-256-GCM, random IV per secret (`server/src/lib/secrets.ts`).
- **Key:** `HKDF-SHA256(SECRET_ENCRYPTION_KEY, salt, 'itehaas-ci-secrets-v1')` — domain-separated from session signing.
- **Legacy rows:** pre-encryption plaintext and `sha256(cookieSecret)`-era ciphertext are accepted **once** and healed: `resolvePipelineSecrets` re-encrypts on read; `POST /ci/secrets/rotate` heals in bulk. Undecryptable rows are **skipped, never injected**, and audited (`ci.secret_decrypt_failure`).
- **Never returned:** list/get endpoints project `(key, created_at)` only; rotation returns counts only.

## 3. Isolation rules (enforced in `server/src/routes/ci.ts`)

1. **Fork PRs get zero secrets.** A run is untrusted if the branch is `fork/*`, the pipeline links to a fork PR (`source_repo_id` / `fork/%`), the author is not owner/collaborator, or the commit object is missing. Untrusted → `secretsEnv = {}` + `ci.secret_strip_fork` audit. The object-existence signal is advisory only (fork objects are pre-copied) — DB fork markers are authoritative.
2. **Only injected secrets reach the runner,** as container env vars; `process.env` is never forwarded (no `DATABASE_URL` leak, S5/S13).
3. **Logs are scrubbed** for raw, URL-encoded, base64, and JSON-escaped variants, plus `COOKIE_SECRET`/`DATABASE_URL` (`maskSecretInLog`, S7 2M cap + truncation marker).
4. **Skipped secrets are visible by name** in job logs (`NOT injected` marker) so a missing secret cannot be mistaken for an injected one.

## 4. Authorization & audit

- Manage (create/rotate/delete): `isAdmin` (owner, member-admin, team-admin) — S3/S8.
- Audited: `ci.secret_create`, `ci.secret_delete`, `ci.secret_rotate`, `ci.secret_decrypt_failure`, `ci.secret_strip_fork`. Values never appear in audit rows.

## 5. Rotation & revocation runbook

- **Rotate one secret:** create new value is not supported in place — `DELETE` then `POST` (both audited), or rotate the whole repo (§6).
- **Rotate `SECRET_ENCRYPTION_KEY`:** (1) set the new key in `.env`; (2) restart; (3) as repo admin call `POST /api/repos/:owner/:repo/ci/secrets/rotate` for every repo (heals all rows to the new key; `skipped` rows need manual re-entry); (4) verify `rotated` counts.
- **Compromise:** revoke via `DELETE /ci/secrets/:key`, rotate the upstream credential at the provider, then repo-rotate. Sessions: `POST /api/auth/sessions/revoke-all`.
