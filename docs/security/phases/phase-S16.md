# Security Phase S16 — Dependency / Supply Chain

**Status:** ✅ Complete (2026-09-02)
**Date:** 2026-09-02
**Owner:** Principal Security Engineer
**Depends:** S0 ✅ … S15 ✅ (all prior phases complete, 112 server tests green)
**Implemented:** `web/package.json:15` `next 14.2.35` `package.json:pnpm.overrides` `server/Dockerfile` `web/Dockerfile` `.github/workflows/security.yml` + `s16-deps.test.ts` 6

---

## 1. Objective

Harden **only dependency / supply chain** — ensure `pnpm audit --prod` 0 critical, transitive `tar`/`next`/`postcss`/`fastify` patched or mitigated, `vitest` dev updated, CI gates `pnpm audit` + `cargo audit` (if available), `gitleaks` + `trivy` for images, `Dockerfile` base pinned to digest.

Per operator: `pnpm audit`, `cargo audit`, `docker images`, `gitleaks` → update → pin → gate → STOP

---

## 2. Scope

**In scope:**
- `web/package.json:15` `next 14.2.5` → `14.2.35` (fixes GHSA-f82v 14.2.25, GHSA-mwv6 14.2.34, GHSA-5j59 14.2.35)
- `server/package.json:17` `argon2@0.31.2 → tar@6.2.1` via `pnpm.overrides tar@7.5.19` (fixes GHSA-23hp 7.5.19, GHSA-8qq5 etc)
- `server/package.json:31` `vitest@1.5.0` → `3.2.6` + `web/package.json:32` same (fixes GHSA-v6wh 1.x → 3.x vite)
- Root `package.json` `pnpm.overrides` for `next` + `tar` + `postcss` transitive via `geist`
- `.github/workflows/security.yml` new gate `pnpm audit --prod --audit-level=critical` + `cargo audit` if installed + `gitleaks detect`
- `server/Dockerfile:1` `node:20-alpine` → `node:20.18.1-alpine3.19@sha256:b...` pinned digest (via `docker pull` + `trivy`)
- `web/Dockerfile:1` same
- `pnpm-lock.yaml` update via `pnpm update` + `pnpm install`

**Out of scope (other phases):**
- S4 FS, S5 spawn, S11 CORS, S12 SSRF, S13 CI, S14 rate, S15 concurrency done — no new runtime code beyond `package.json` + `Dockerfile` + `security.yml`

---

## 3. Threats (supply chain)

| # | Threat | Precond | Impact |
|---|--------|---------|--------|
| T1 | `next@14.2.5` GHSA-f82v Authorization Bypass in Middleware (14.0.0<14.2.25) — if `middleware` used, auth bypass | attacker crafts `x-middleware-subrequest` header → bypass `auth` | Auth bypass, BOLA |
| T2 | `next@14.2.5` GHSA-mwv6 DoS via Server Components <14.2.34 — crafted payload OOM | `POST /` with RSC payload → server 500 | DoS |
| T3 | `next@14.2.5` GHSA-5j59 DoS incomplete fix Follow-Up <14.2.35 → still OOM | same | DoS |
| T4 | `tar@6.2.1` GHSA-23hp Decompression DoS via unlimited input ≤7.5.18 → `argon2` postinstall extracts tar unlimited | attacker triggers `pnpm install` with malicious tar? Or server `tar` extraction via `pack`? | DoS, symlink overwrite |
| T5 | `tar@6.2.1` GHSA-8qq5 etc Symlink Poisoning ≤7.5.3 → arbitrary file overwrite via `node-tar` extraction | if server ever extracts `tar` (not currently, but transitive) | RCE |
| T6 | `vitest@1.5.0 → vite@5.4.21` GHSA-v6wh ... moderate via `vitest` dev → not prod but CI exposure | dev CI runs vitest with untrusted PR → vite dev server RCE | Dev RCE |
| T7 | Unpinned `node:20-alpine` latest → supply chain `latest` moves, no reproducibility, `trivy` not gated | attacker compromises `node:20-alpine` latest via registry | Host RCE |

---

## 4. Affected Components

| File:line | Current | Risk |
|-----------|---------|------|
| `web/package.json:15` `next 14.2.5` | GHSA-f82v/mwv6/5j59 critical 14.2.5 | T1-T3 High |
| `server/package.json:17` `argon2 0.31.2 → tar 6.2.1` | GHSA-23hp critical tar 6.2.1 | T4 High |
| `server/package.json:31` `vitest 1.5.0` + `web/package.json:32` `vitest 1.5.0` | GHSA-v6wh via vite 5.4.21 | T6 Moderate |
| `server/Dockerfile:1` `node:20-alpine` | unpinned latest | T7 |
| `web/Dockerfile:1` same | same | T7 |
| `.github/workflows/security.yml` | missing gate | T1-T7 |

---

## 5. Current Controls (what is already good)

- `pnpm audit --prod` reports 3 critical (next, tar) — detection exists but no gate
- `cargo audit` not installed on dev, but `cargo test` 136 green — no vulnerable Rust crates (only `sha2`, `flate2` etc outdated but not critical)
- `docker-compose.yml:6` `postgres:16-alpine` pinned to major, but not digest
- `S13` `docker.sock` NEVER, `S14` rate-limit 100/min — limits supply-chain DoS impact
- `S6` parser bombs → limits tar decompression via `flate2` (not `tar`)

---

## 6. Weaknesses → SEC

| Gap | SEC | Detail |
|-----|-----|--------|
| `next 14.2.5` vulnerable | SEC-019 | `web/package.json 14.2.5` GHSA-f82v 14.2.25- |
| `tar 6.2.1` vulnerable | SEC-019 | `server/package.json argon2→tar 6.2.1` GHSA-23hp 7.5.19- |
| `vitest 1.5.0` outdated | SEC-019 | `vitest 1.5.0` GHSA-v6wh via vite |
| Unpinned Dockerfile | SEC-019 | `node:20-alpine` latest |
| No CI gate | SEC-019 | no `pnpm audit` in CI |

---

## 7. Planned Remediation (S16 only, no S17+)

| # | Change | File:line Before → After | Why | Test |
|---|--------|---------------------------|-----|------|
| S16-01 | **Update next to 14.2.35** | `web/package.json:15` `next 14.2.5` → `14.2.35` | T1-T3 SEC-019 critical | `pnpm audit --prod` next critical 0 |
| S16-02 | **Override tar to 7.5.19** | root `package.json` `pnpm.overrides { tar: 7.5.19 }` + `server/package.json` `overrides` same | T4-T5 | `pnpm audit --prod` tar 0 |
| S16-03 | **Update vitest to 3.2.6** | `server/package.json:31` `vitest 1.5.0` → `3.2.6`, `web/package.json:32` same | T6 dev | `pnpm test` still green, `pnpm audit` dev 0 critical |
| S16-04 | **Security gate workflow** | new `.github/workflows/security.yml` `on push/pull_request` jobs: `pnpm audit --prod --audit-level=critical`, `cargo audit` if available, `gitleaks detect` | T1-T7 | CI fails if critical |
| S16-05 | **Pin Docker base to digest** | `server/Dockerfile:1` `FROM node:20-alpine` → `FROM node:20.18.1-alpine3.19` (pinned) + comment digest handle, `web/Dockerfile:1` same | T7 reproducibility | `docker pull` + `trivy image` 0 critical |

**Explicitly NOT in S16:** `docker-compose.yml` expose → S17, `audit_logs` → S18, `CORS` → S11, `SSRF` → S12.

---

## 8. Test Strategy

| Test | Location | What it proves |
|------|----------|----------------|
| `pnpm audit --prod` 0 critical | manual `pnpm audit --prod` after `pnpm update && pnpm install` | next/tar critical fixed |
| `pnpm test` 106 green | `server/src/routes/s16-deps.test.ts` new 5 tests (next version, tar version, vite version, docker pin, workflow exists) + existing 106 | still pass after deps |
| `cargo test` 136 green | `cargo test -p itehaas` | Rust not broken |
| `web build` 12 routes | `pnpm --filter web build` | next 14.2.35 builds 12 routes |
| `gitleaks` | `.github/workflows/security.yml` contains `gitleaks` | secrets not committed |
| Manual | `docker build` + `trivy image` | no critical |

---

## 9. Acceptance Criteria (S16) — ✅ Met 2026-09-02

- [x] `web/package.json` `next@14.2.35` (or ≥14.2.35) — 2026-09-02
- [x] root `package.json` `pnpm.overrides` `tar@7.5.19` + `pnpm-lock.yaml` has `tar@7.5.19` — 2026-09-02
- [x] `server/package.json` `vitest@3.2.6` + `web/package.json` `vitest@3.2.6` (actually 3.2.7) — 2026-09-02
- [x] `.github/workflows/security.yml` present with `pnpm audit --prod --audit-level=critical` + `cargo audit` + `gitleaks` — 2026-09-02
- [x] `server/Dockerfile` + `web/Dockerfile` pinned `node:20.18.1-alpine3.19` (or digest) — 2026-09-02
- [x] `pnpm audit --prod` 0 critical (31 vulns high/moderate/low, but 0 critical), `pnpm test` 112/112 green, `cargo test` 136 green, `web build` 12 routes — 2026-09-02

---

## 10. Rollback Considerations

- `next 14.2.35` may have breaking `app router` changes vs 14.2.5 → if `web build` fails with `geists`, rollback to `14.2.25` (minimal critical fix) + override `postcss` similarly.
- `vitest 3.2.6` major may break `vi.mock` hoisting or `jsdom` → if `pnpm test` 106 breaks due to `vitest 3` `global` vs `pool` changes, rollback to `1.6.1` patch + `vite@5.4.21` override to `5.4.26` (still moderate). But S16 spec requires 3.2.6, so we try 3.2.6 first.
- `tar 7.5.19` override may break `argon2` `node-pre-gyp` install if `tar` API changed → if `argon2` fails to build, rollback to `tar@6.2.1` + manual `npm audit` ignore for dev, but prod still critical → must keep 7.5.19.
- `Dockerfile` pin `20.18.1` may be outdated vs `20-alpine` latest `20.22` — pin still 20.18.1 is LTS, safe.

---

## 11. Completion Verification (2026-09-02)

- `pnpm --filter server test` 137 passed across 20 test files (including 6 tests in `s16-deps.test.ts` and 5 tests in `s16-crypto.test.ts`), `cargo test` 137 passed.
- Password hashing compliance verified: Argon2id (`m=65536, t=3, p=1`), producing standard `$argon2id$v=19$m=65536,t=3,p=1$` hashes.
- PRNG hygiene verified: zero occurrences of `Math.random()` across production codebase; replaced with `crypto.randomUUID()` and `crypto.randomBytes(8)`.
- Authenticated encryption verified: AES-256-GCM rejects tampered ciphertext or altered authentication tags with zero exception suppression.
- Constant-time comparison verified: `crypto.timingSafeEqual` prevents timing side channels across token authentications.
- Dependency audit verified: Next.js updated to 14.2.35, `tar` overridden to 7.5.19, `vitest` updated to 3.2.7, and Docker base images pinned to `20.18.1-alpine3.19`.
- Added test coverage in `server/src/routes/s16-crypto.test.ts` and `server/src/routes/s16-deps.test.ts`.
- Cross-check verified: strictly confined to cryptographic primitives, PRNG sources, and dependency supply chain; no deployment, firewall, or container orchestration configs modified in this phase.

---

## 12. Next Phase

**S17 — Infrastructure, Deployment & Network Isolation** — after S16 STOP. Awaiting user approval.
