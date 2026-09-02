# Security Phase S9 — Secrets Hygiene, Storage, & Cryptography Defense

**Status:** ✅ Complete  
**Date:** 2026-09-02  
**Owner:** Principal Security Engineer  
**Scope:** Key separation via dedicated `SECRET_ENCRYPTION_KEY`, HKDF-SHA256 key derivation with domain separation, AES-256-GCM AEAD encryption, versioned ciphertext format, zero-downtime key rotation, and multi-encoding CI log masking ([SEC-009](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-009--ci-secrets-encryption-key-coupled-to-session-secret-without-versioning)).

---

## 1. Objective

Isolate cryptographic secret management from web session keys, enforce AEAD standards (AES-256-GCM with fresh random 96-bit nonces), prevent auth tag tampering, support zero-downtime key rotation, and prevent secret leakage across API responses and execution logs.

---

## 2. Threat Analysis & Defensive Matrix

| Threat | Attack Path | Previous State | Implemented Control (S9) |
|---|---|---|---|
| **Cryptographic Key Coupling & Weak Derivation** (SEC-009) | CI repository secrets were encrypted using a 32-byte key derived via simple SHA-256 of `config.cookieSecret`. Compromise of session cookie keys directly exposed all repository secrets at rest, with no domain separation. | `getKey()` called `createHash('sha256').update(config.cookieSecret).digest()`. No separate encryption key. | Added `SECRET_ENCRYPTION_KEY` in `server/src/config.ts`. Derived 256-bit AES keys using `crypto.hkdfSync('sha256', rootKey, salt, 'itehaas-ci-secrets-v1', 32)` for strict domain separation. |
| **Ciphertext Versioning & Inability to Rotate Keys** | Stored ciphertexts had no schema or version identifiers, preventing algorithm upgrades or key rotation without breaking existing records. | Unversioned base64 payload. | Added version prefix (`v1:<base64>`). Added `rotateSecret(ciphertext, newRootKey)` supporting instant re-encryption, with transparent backward-compatible fallback for legacy ciphertexts. |
| **IV / Nonce Reuse & Tag Tampering** | Reusing nonces in AES-GCM destroys confidentiality and authenticity. Altering ciphertext without authentication tags allows bit-flipping attacks. | IV was random, but ciphertext tampering defenses weren't verified. | Enforced cryptographically random 12-byte IV per encryption (`crypto.randomBytes(12)`). Full AEAD verification (`decipher.setAuthTag(tag)`) ensures any single-bit mutation rejects decryption immediately. |
| **Secret Leakage in Execution Logs via Encoding Variants** | Build scripts or tools could print secrets in encoded forms (JSON-escaped in configuration files, URL-encoded in curl parameters, base64-encoded in headers). | Simple exact-string matching only masked raw values $\ge 3$ characters. | Implemented `maskSecretInLog(logs, secret)` in `server/src/lib/secrets.ts`. Simultaneously sanitizes raw, URL-encoded (`encodeURIComponent`), base64-encoded, and JSON-escaped representations of any secret of length $\ge 4$. |
| **API Secret Value Exposure** | Unprivileged users or observers querying repository secrets could inspect plaintext secret values. | Checked `GET /api/repos/:owner/:repo/ci/secrets`. | Route strictly queries `SELECT key, created_at FROM ci_secrets`, never exposing secret values or ciphertexts in HTTP responses. |

---

## 3. Files Modified

1. `server/src/config.ts`: Added `secretEncryptionKey` to `AppConfig`, defaulting securely to `SECRET_ENCRYPTION_KEY` with production length and entropy validation.
2. `server/src/lib/secrets.ts`: Rewrote with HKDF-SHA256 key derivation, AES-256-GCM AEAD, version-tagged ciphertexts (`v1:`), `rotateSecret`, and `maskSecretInLog`.
3. `server/src/routes/ci.ts`: Integrated `maskSecretInLog` into job execution runner for comprehensive multi-encoding log scrubbing.
4. `server/src/routes/s9-secrets.test.ts`: Expanded test suite to verify IV uniqueness, AEAD auth tag tampering rejection, key rotation, and multi-encoding masking.

---

## 4. Verification & Regression Tests

- **Secrets Security Test Suite (`server/src/routes/s9-secrets.test.ts`):** 11/11 tests passing:
  - `S9-02 encrypt at-rest: ciphertext != plaintext and decrypts`.
  - `S9-02 POST /secrets stores ciphertext not plaintext`.
  - `S9-03 GET /secrets returns key, created_at only, not value`.
  - `S9-03 error handler returns correlationId not path`.
  - `S9-05 logs scrub secrets: runPipeline with secret env → logs ***`.
  - `S9-02 decryptSafe fallback for legacy plaintext`.
  - `S9: auth responses never expose password_hash`.
  - `S9: IV uniqueness - encrypting identical plaintext produces distinct IVs and ciphertexts`.
  - `S9: AEAD auth tag tampering causes decryption to fail`.
  - `S9: Key rotation - rotateSecret re-encrypts with new key`.
  - `S9: maskSecretInLog scrubs raw, url-encoded, base64, and json-escaped secrets`.
- **Full Project Regression Test Suites:**
  - `pnpm --filter server test`: 22 test files, 193/193 tests green.
  - `cargo test`: 124/124 tests green.

---

## 5. Acceptance Criteria Checklist

- [x] Dedicated `SECRET_ENCRYPTION_KEY` implemented and validated (SEC-009)
- [x] HKDF-SHA256 key derivation with domain separation implemented
- [x] AES-256-GCM authenticated encryption verified with unique 12-byte IVs
- [x] Auth tag tampering detection verified
- [x] Zero-downtime key rotation mechanism implemented (`rotateSecret`)
- [x] Backward-compatible legacy decryption fallback preserved
- [x] Hardened multi-encoding log masking implemented (`maskSecretInLog`)
- [x] Vulnerability register updated
- [x] `PLAN.md` updated

---

## 6. Next Phase Gate

- **Active Phase Status:** S9 COMPLETE.
- **Next Phase:** `SECURITY PHASE S10 — CI/CD RUNNER ISOLATION & HOST SECURITY`
- **Scope:** CI secret exfiltration to untrusted fork PRs ([SEC-008](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-008--ci-secret-exfiltration-via-untrusted-fork-pull-requests)), host filesystem takeover via writable Docker socket/mounts ([SEC-010](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-010--host-filesystem-takeover-via-writable-docker-socket--workspace-mounts)), container sandboxing, capability dropping (`--cap-drop=ALL`), non-root execution, read-only workspace bind mounts.
