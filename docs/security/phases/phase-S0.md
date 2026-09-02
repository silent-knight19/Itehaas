# Security Phase S0 — Security Reconnaissance

**Status:** ✅ Complete (Documentation & Threat Modeling Only; Zero Code Modifications)  
**Date:** 2026-09-02  
**Owner:** Principal Security Engineer  
**Scope:** Full repository codebase (`vcs/`, `server/`, `web/`, `database/migrations/`, `docker-compose.yml`, CI)

---

## 1. Objective

Conduct an independent, first-principles defensive security assessment of the actual Itehaas codebase without assuming prior audits are correct. Map all trust boundaries, inventory external attack surfaces, trace data flows to sinks, uncover architectural and implementation vulnerabilities, and establish the defensive security baseline for phased remediation.

**Strict Phase Execution Rule:** Phase S0 performs reconnaissance and documentation only. **No application source code is modified in this phase.**

---

## 2. Scope

- **Inspected:**
  - Rust VCS engine: `vcs/src/main.rs`, `vcs/src/lib.rs`, `vcs/src/object/*`, `vcs/src/checkout.rs`, `vcs/src/pack.rs`, `vcs/src/remote/http.rs`, `vcs/src/revwalk.rs`.
  - Node.js API backend: `server/src/index.ts`, `server/src/config.ts`, `server/src/lib/*`, `server/src/middleware/*`, `server/src/routes/*`.
  - Next.js web application: `web/app/*`, `web/components/MarkdownViewer.tsx`, `web/next.config.js`.
  - PostgreSQL database: `database/migrations/001_init.sql` through `010_audit.sql`.
  - Deployment configuration: `docker-compose.yml`, `server/Dockerfile`, `web/Dockerfile`.
- **Static Analysis & Tests Executed:**
  - `cargo test`: 136 tests passing.
  - `cargo clippy`: 0 errors, zero `unsafe` blocks.
  - `pnpm --filter server test`: 124 tests in 19 test suites passing.
  - `pnpm audit --prod`: 0 critical, 13 high, 15 moderate, 3 low advisories.

---

## 3. Key Findings Discovered in S0

1. **CSRF Fail-Open Flaw (`server/src/middleware/csrf.ts:20`):** Missing `csrf_token` cookie bypasses CSRF check entirely.
2. **Reverse Proxy Rate Limit Collapsing (`server/src/lib/rateLimit.ts:9`):** Missing `trustProxy: true` in Fastify causes all clients to share `127.0.0.1`, enabling instance-wide denial of service.
3. **Quadratic Buffer Churn DoS (`server/src/routes/repos.ts:573`):** Repeated `Buffer.concat` on 64 KiB chunks allocates over 32 GB of transient heap buffers during 64 MiB object uploads.
4. **Outbound SSRF Loopback Bypass (`vcs/src/remote/http.rs:43`):** Unconditional exemption of `localhost` allows outbound VCS requests to probe internal loopback services.
5. **Packfile Unbounded Heap Allocation (`vcs/src/pack.rs:105`):** Untrusted 32-bit length headers are directly passed to `vec![0u8; len]`.
6. **Object Upload CAS Placement Race (`server/src/routes/repos.ts:701-716`):** Uploaded files are placed in CAS storage before running cryptographic verification.
7. **Cross-Fork Pull Request Authorization Defect (`server/src/routes/pulls.ts:74`):** Requiring write permissions on target repositories breaks external fork contributions.

---

## 4. Phase S0 Deliverables

- [x] `docs/security/audit-baseline.md` — Codebase snapshot, test execution logs, and ground-truth code review findings.
- [x] `docs/security/threat-model.md` — Architectural trust boundaries, high-value assets, threat actors, and attack vectors.
- [x] `docs/security/attack-surface.md` — Complete inventory of 123 external inputs, validation controls, and execution sinks.
- [x] `docs/security/security-architecture.md` — System segmentation, defensive controls matrix, architectural anti-patterns, and target design.
- [x] `docs/security/vulnerability-register.md` — Master register of 21 vulnerabilities (`SEC-001` through `SEC-021`) with CWE, OWASP mapping, and impact descriptions.
- [x] `docs/security/security-scorecard.md` — Objective qualitative maturity ratings across 23 security domains.
- [x] `docs/security/initial-security-assessment.md` — Comprehensive assessment report with executive summary and phased remediation roadmap.
- [x] `docs/security/phases/phase-S0.md` — Phase S0 readiness and reconnaissance report.
- [x] `PLAN.md` — Synchronized with the phased security program.

---

## 5. Next Phase Gate

- **Next Phase:** `SECURITY PHASE S1 — CRITICAL VULNERABILITY TRIAGE`
- **Criteria:** Stop and obtain user review and approval of the Phase S0 findings and phased roadmap before initiating any code modifications or proof triage.
 