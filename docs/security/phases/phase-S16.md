# Security Phase S16 — Dependency, Supply Chain, & Cryptographic Audit

**Status:** ✅ Complete  
**Date:** 2026-09-02  
**Owner:** Principal Security Engineer  
**Scope:** Triage and mitigation of known dependencies vulnerabilities ([SEC-025](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-025--deprecated-and-vulnerable-transitive-dependencies)), lockfile integrity verification, cryptographic primitive audit (Argon2id, AES-256-GCM, HMAC-SHA256, CSPRNG), elimination of insecure random functions, and automated CI supply chain gating.

---

## 1. Objective

Ensure that all third-party software components, lockfiles, and cryptographic algorithms across the Itehaas platform are audited, pinned, hardened, and free of reachable critical vulnerabilities.

---

## 2. Threat Analysis & Defensive Matrix

| Threat | Attack Path | Previous State | Implemented Control (S16) |
|---|---|---|---|
| **Critical Transitive Vulnerabilities in Node Packages** (SEC-025) | `tar` versions prior to 7.5.19 suffer from uncontrolled recursion and arbitrary file write vulnerabilities; earlier Next.js versions exhibit cache poisoning and server-side request starvation. | Discovered during reconnaissance audit. | Enforced root `pnpm.overrides` pinning `tar` to `7.5.19` and updated `web/package.json` to `next@14.2.35`. Pinned `vitest` to `>=3.2.6`. Result: `pnpm audit --prod --audit-level=critical` reports 0 critical vulnerabilities. |
| **Weak Password Hashing Parameters** | Weak KDF parameters allow offline GPU brute-force recovery of database password hashes. | Unverified parameters. | Verified Argon2id configuration in `server/src/lib/auth.ts`: `m=65536` (64 MiB), `t=3` iterations, `p=1` parallelism. Adheres to OWASP KDF guidelines; validated in `s16-crypto.test.ts`. |
| **Tampered Secret Ciphertext** | Bit-flipping attacks on AES-CBC or unauthenticated stream modes allow ciphertext manipulation. | AES-256-GCM authenticated encryption. | Verified AES-256-GCM with 96-bit CSPRNG IV and 128-bit authentication tag verification in `server/src/lib/secrets.ts`. Ciphertext tampering is immediately detected and rejected with a decryption error. |
| **Insecure Pseudorandom Generation** | Use of `Math.random()` for tokens or session IDs allows PRNG state prediction. | Potential risk in node services. | Enforced zero `Math.random()` occurrences across server source code via regression test (`s16-crypto.test.ts`); all security-sensitive tokens and identifiers use `crypto.randomBytes` or `crypto.randomUUID`. |
| **Timing Side-Channel on Token Comparison** | Standard string equality (`===`) leaks timing information byte-by-byte. | Potential timing leakage. | Enforced `crypto.timingSafeEqual` for CSRF and HMAC signature verification. |

---

## 3. Files Created / Modified

1. `docs/security/dependency-audit.md`: Comprehensive dependency audit report, vulnerability triage matrix, lockfile analysis, and cryptographic parameters review.
2. `server/src/routes/s16-crypto.test.ts`: Regression tests verifying Argon2id parameters, AES-256-GCM authentication tag tampering detection, CSPRNG entropy, constant-time token comparison, and zero `Math.random()` usage.
3. `server/src/routes/s16-deps.test.ts`: Automated assertions for Next.js and tar version pins, Vitest versions, Docker base image tags, and critical audit status.
4. `docs/security/vulnerability-register.md`: Marked `SEC-025` as *Mitigated in S16*.

---

## 4. Verification & Regression Tests

- **Cryptographic Security Suite (`server/src/routes/s16-crypto.test.ts`):** 5/5 tests passing:
  - `Argon2id password hashing adheres to secure parameters ($argon2id$v=19$m=65536,t=3,p=1$)`.
  - `Zero Math.random usage in production server source code`.
  - `AES-256-GCM authenticated encryption rejects tampered ciphertext`.
  - `Constant-time comparison rejects unequal tokens without timing variance`.
  - `CSPRNG session IDs maintain high entropy`.
- **Dependency & Supply Chain Suite (`server/src/routes/s16-deps.test.ts`):** 6/6 tests passing:
  - `S16-01 web next >=14.2.35`.
  - `S16-02 tar override to 7.5.19`.
  - `S16-03 vitest >=3.2.6`.
  - `S16-04 security.yml gate exists`.
  - `S16-05 Dockerfile pinned to 20.18.1-alpine3.19`.
  - `S16-06 pnpm audit --prod critical 0`.
- **Full Project Regression Test Suites:**
  - `pnpm audit --prod --audit-level=critical`: **0 critical advisories**.
  - `pnpm --filter server test`: 27 test files, 233/233 tests green.
  - `cargo test`: 124/124 tests green.

---

## 5. Acceptance Criteria Checklist

- [x] Transitive dependencies audited and triaged (SEC-025)
- [x] Zero critical production vulnerabilities (`pnpm audit --prod --audit-level=critical`)
- [x] `tar` and `next` overrides verified in lockfile
- [x] Argon2id parameters verified against OWASP guidelines
- [x] AES-256-GCM authentication tag validation verified against tampering
- [x] Timing-safe comparisons verified
- [x] Zero `Math.random()` verified in production server code
- [x] `docs/security/dependency-audit.md` authored
- [x] Vulnerability register updated
- [x] `PLAN.md` updated

---

## 6. Next Phase Gate

- **Active Phase Status:** S16 COMPLETE.
- **Next Phase:** `SECURITY PHASE S17 — HOST ENVIRONMENT, RUNTIME, & DOCKER HARDENING`
- **Scope:** Resolution of Docker cross-architecture binary mounting failure ([SEC-026](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-026--docker-architecture-mismatch--host-binary-mounting-failure)), multi-stage Dockerfile with internal Rust compilation, non-root user execution, read-only root filesystems, and minimal Alpine containers.
