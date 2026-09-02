# Dependency & Supply Chain Security Audit (SEC-025)

**Date:** 2026-09-02  
**Scope:** Monorepo package dependencies (`server`, `web`, `vcs`), lockfile integrity, vulnerability triage, and cryptographic primitive verification.

---

## 1. Executive Summary

A comprehensive dependency and supply chain security audit was performed across the Itehaas monorepo. All critical-severity advisories have been mitigated via targeted package upgrades and root-level `pnpm.overrides`. Cryptographic primitives across both TypeScript and Rust components were audited and verified to meet or exceed OWASP guidelines.

---

## 2. Vulnerability Triage & Disposition Matrix (SEC-025)

| Package | Affected Versions | Current Resolution | Severity | Reachability Analysis | Disposition |
|---|---|---|---|---|---|
| `tar` | `<7.5.19` (critical DoS / arbitrary write) | Overridden to `7.5.19` via root `package.json:pnpm.overrides` | High (previously Critical) | Used transitively by `@mapbox/node-pre-gyp` during native module compilation (`argon2`). Uncontrolled recursion on member selection is not reachable in production server runtime. | **MITIGATE** (Lockfile overridden to `7.5.19`; 0 critical advisories). |
| `next` | `<14.2.35` (cache poisoning / SSR DoS) | Upgraded to `14.2.35` in `web/package.json` and root overrides | High (previously Critical) | Next.js server actions and caching layer. Replaced vulnerable versions with patched `14.2.35`. | **UPGRADE** (Verified in `s16-deps.test.ts`). |
| `vitest` | `<3.2.6` (test runner devDep) | Upgraded to `>=3.2.6` across workspaces | Moderate | DevDependency only. Not included in production bundles or runtime Docker containers. | **UPGRADE** (Pinned in devDependencies). |
| `find-my-way` | `<9.7.0` (HTTP/2 route DoS) | Fastify 4.x transitively bundles `find-my-way@8.2.2` | High | Fastify server in Itehaas operates over HTTP/1.1 behind reverse proxies (Nginx / Cloudflare) with HTTP/2 disabled on node process. The HTTP/2 DoS vector is unreachable. | **ACCEPT / MITIGATED BY ARCHITECTURE** (Documented residual risk until Fastify 5 upgrade). |
| `postcss` | `<8.5.18` (Source map path traversal) | Bundled transitively by Next.js / Geist | High | Build-time CSS postprocessing only. Does not execute on production request paths. | **ACCEPT** (Build-time only). |

---

## 3. Lockfile & Version Pinning Integrity

- **`pnpm-lock.yaml`:** Committed to version control; verified frozen in CI via `pnpm install --frozen-lockfile`.
- **`Cargo.lock`:** Committed to version control; all 14 dependencies (`clap`, `sha2`, `sha1`, `flate2`, `ureq`, etc.) are pinned with exact cryptographic checksums.
- **Floating Dependencies:** Zero unpinned wildcard (`*`) or `latest` tags in production manifests.

---

## 4. Cryptographic Hygiene & Parameter Audit

| Primitive | Implementation | Parameter Configuration | Standard Compliance |
|---|---|---|---|
| **Password Hashing** | Argon2id (`argon2`) | `m=65536` (64 MiB), `t=3` (3 iterations), `p=1` (1 thread) | Exceeds OWASP minimum recommended settings (`m=19456, t=2, p=1`). |
| **Secret Encryption** | AES-256-GCM (`crypto`) | 256-bit key from `SECRET_ENCRYPTION_KEY`, 96-bit (12-byte) CSPRNG IV per encryption, 128-bit authentication tag. | NIST SP 800-38D compliant. Authentication tag enforced on deciphering. |
| **CSPRNG Generation** | `crypto.randomBytes` / `crypto.randomUUID` | High-entropy hardware/OS entropy pool (`/dev/urandom`). | Zero `Math.random()` usage in production server source code (enforced by `s16-crypto.test.ts`). |
| **CSRF / Signature Verification** | HMAC-SHA256 (`crypto.timingSafeEqual`) | Timing-attack resistant byte comparison (`timingSafeEqual`). | Prevents side-channel timing analysis. |
| **VCS Hashing** | SHA-256 (`sha2`) / SHA-1 (`sha1`) | SHA-256 is the default algorithm for all new repositories; SHA-1 is supported solely for legacy Git object compatibility. | Modern SHA-256 hash tree construction. |

---

## 5. Automated CI Gating

The CI pipeline (`.github/workflows/security.yml`) enforces:
1. `pnpm audit --prod --audit-level=critical` (must report 0 critical vulnerabilities).
2. Secret scanning with Gitleaks.
3. Cryptographic and dependency regression test suites (`s16-crypto.test.ts` and `s16-deps.test.ts`).
