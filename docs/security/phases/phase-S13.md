# Security Phase S13 — SSRF, Webhook, & Remote Fetch Security

**Status:** ✅ Complete  
**Date:** 2026-09-02  
**Owner:** Principal Security Engineer  
**Scope:** Elimination of DNS rebinding attacks in remote fetch transport ([SEC-018](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-018--dns-rebinding-ssrf-in-remote-fetch-transport)), IP resolution validation before connect (`SafeResolver`), IPv4-mapped IPv6 normalization and filtering, cloud metadata service isolation (`169.254.169.254`, `metadata.google.internal`), carrier-grade NAT (`100.64.0.0/10`), internal cluster domain rejection (`.internal`, `.local`), and API-layer remote destination validation.

---

## 1. Objective

Neutralize Server-Side Request Forgery (SSRF) and DNS rebinding time-of-check to time-of-use (TOCTOU) race conditions in remote fetch, clone, and remote URL configuration endpoints.

---

## 2. Threat Analysis & Defensive Matrix

| Threat | Attack Path | Previous State | Implemented Control (S13) |
|---|---|---|---|
| **DNS Rebinding SSRF in Remote Fetch** (SEC-018) | An attacker registers a domain with a 0-second TTL. On initial validation, `is_private_host` resolves the domain to a public IP. During `ureq` HTTP execution, the library performs a second DNS resolution, returning `127.0.0.1` or `169.254.169.254`, causing the server to fetch internal services or cloud credentials. | Upfront DNS check without socket-level IP pinning. | Implemented custom `SafeResolver: ureq::Resolver` in `vcs/src/remote/http.rs:31-48`. Registered with `AgentBuilder::resolver(SafeResolver)`. Immediately prior to socket connection, `SafeResolver` inspects all resolved socket addresses and aborts with `io::ErrorKind::PermissionDenied` if any resolved IP belongs to a loopback, private, link-local, or cloud metadata block. Redirects are pinned to 0 (`redirects(0)`). |
| **SSRF Bypass via IPv4-Mapped IPv6** | Attacker specifies `http://[::ffff:127.0.0.1]/...` or `http://[::ffff:169.254.169.254]/...`. Naive IPv6 parsers treat the address as non-loopback since the upper bits do not match `::1`. | IPv6 branch did not map embedded IPv4 addresses. | In `vcs/src/remote/http.rs:136-144`, added `v6.to_ipv4_mapped()` and `v6.to_ipv4()` extraction, recursively subjecting the unwrapped IPv4 address to full RFC 1918 / loopback / link-local validation. Added IPv6 bracket stripping and prefix matching in `server/src/routes/repos.ts:1380-1386`. |
| **Cloud Metadata Service Harvest** | Attacker configures remote URL pointing to AWS/Azure link-local `169.254.169.254` or Google Cloud `metadata.google.internal` to steal instance IAM credentials. | Only literal IPs were checked for link-local. | Explicitly blocked `169.254.0.0/16`, `metadata.google.internal`, `.internal`, and `.local` in both Rust (`is_private_host`, `is_private_ip`) and Fastify (`repos.ts:1380`). |
| **Carrier-Grade NAT (CGNAT) & Reserved Address Access** | Attacker targets Kubernetes or cloud provider VPCs mapped via `100.64.0.0/10` or `0.0.0.0/8`. | Missing CGNAT / 0.0.0.0/8 range blocks. | Added explicit filtering for `100.64.0.0/10` and `0.0.0.0/8` in `is_private_ip`. |

---

## 3. Files Modified

1. `vcs/src/remote/http.rs`: Implemented `SafeResolver` with `ureq::Resolver` trait; registered with `AgentBuilder::resolver(SafeResolver)`; added IPv4-mapped IPv6 unwrapping (`to_ipv4_mapped`); blocked cloud metadata hostnames and CGNAT ranges.
2. `server/src/routes/repos.ts`: Added API-layer SSRF validation in `POST /api/repos/:owner/:repo/remotes` rejecting loopback, link-local, metadata, and private IP ranges.
3. `vcs/tests/s12_ssrf_test.rs`: Added test cases for IPv4-mapped IPv6, metadata DNS, and CGNAT destinations.
4. `server/src/routes/s13-ssrf.test.ts`: Created server regression test suite verifying rejection of loopback, link-local, metadata, and RFC 1918 remote destinations.

---

## 4. Verification & Regression Tests

- **VCS SSRF Test Suite (`vcs/tests/s12_ssrf_test.rs`):** 4/4 tests passing:
  - `test_private_ip_blocked` (verifies 22 distinct SSRF vectors including IPv4, IPv6, IPv4-mapped IPv6, cloud metadata, and CGNAT).
  - `test_public_ip_allowed`.
  - `test_shape_still_required`.
  - `test_allow_private_with_env`.
- **Server SSRF Test Suite (`server/src/routes/s13-ssrf.test.ts`):** 13/13 tests passing:
  - `blocks SSRF destination: loopback IPv4 (http://127.0.0.1:3001/api/repos/a/b)`.
  - `blocks SSRF destination: localhost hostname (http://localhost:3001/api/repos/a/b)`.
  - `blocks SSRF destination: AWS/GCP/Azure link-local metadata (http://169.254.169.254/latest/meta-data)`.
  - `blocks SSRF destination: Google Cloud metadata DNS (http://metadata.google.internal/computeMetadata/v1/)`.
  - `blocks SSRF destination: Kubernetes internal cluster DNS (http://kubernetes.default.svc.cluster.local/api/repos/a/b)`.
  - `blocks SSRF destination: Internal private domain (http://backend.internal/api/repos/a/b)`.
  - `blocks SSRF destination: IPv6 loopback (http://[::1]/api/repos/a/b)`.
  - `blocks SSRF destination: IPv4-mapped IPv6 loopback (http://[::ffff:127.0.0.1]/api/repos/a/b)`.
  - `blocks SSRF destination: RFC 1918 class A (10.0.0.0/8) (http://10.0.0.1/api/repos/a/b)`.
  - `blocks SSRF destination: RFC 1918 class B (172.16.0.0/12) (http://172.20.0.1/api/repos/a/b)`.
  - `blocks SSRF destination: RFC 1918 class C (192.168.0.0/16) (http://192.168.1.1/api/repos/a/b)`.
  - `blocks SSRF destination: 0.0.0.0 bind-all (http://0.0.0.0:8080/api/repos/a/b)`.
  - `allows public HTTPS remote repository destinations`.
- **Full Project Regression Test Suites:**
  - `cargo test`: 124/124 tests green.
  - `pnpm --filter server test`: 26 test files, 228/228 tests green.

---

## 5. Acceptance Criteria Checklist

- [x] DNS rebinding TOCTOU race eliminated via `SafeResolver` socket-level IP validation (SEC-018)
- [x] IPv4-mapped IPv6 addresses unmapped and validated against private IP rules
- [x] Cloud metadata IPs and domains blocked (`169.254.169.254`, `metadata.google.internal`)
- [x] Internal cluster domains blocked (`.internal`, `.local`)
- [x] Carrier-grade NAT (`100.64.0.0/10`) and `0.0.0.0/8` blocked
- [x] Safe HTTP client redirects disabled (`redirects(0)`)
- [x] Vulnerability register updated
- [x] `PLAN.md` updated

---

## 6. Next Phase Gate

- **Active Phase Status:** S13 COMPLETE.
- **Next Phase:** `SECURITY PHASE S14 — API SECURITY, RATE LIMITING, & ABUSE CONTROLS`
- **Scope:** Fine-grained per-endpoint rate limits (login 5/min, register 3/min, contributions 10/min, file browsing 60/min), pagination bounds enforcement, payload size limits, and abuse quotas.
