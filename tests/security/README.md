# Itehaas Dedicated Adversarial Security Test Suite (Phase S19)

**Scope:** End-to-end negative and positive adversarial verification for all 26 registered security vulnerabilities (SEC-001 through SEC-026).

---

## 1. Test Suite Location

The automated test suite runs via Vitest under:
[`server/src/routes/s19-adversarial.test.ts`](file:///Users/sachinkumarsingh/Projectss/Itehaas/server/src/routes/s19-adversarial.test.ts)

To execute the entire security test corpus:
```bash
pnpm --filter server test src/routes/s19-adversarial.test.ts
```

---

## 2. Vulnerability Coverage Matrix

| Vulnerability ID | Scenario Description | Tested Vector | Expected Outcome | Result |
|---|---|---|---|---|
| **SEC-001** | Production fallback to default credentials | Insecure `COOKIE_SECRET` under `NODE_ENV=production` | Fail closed with startup exception | ✅ Verified |
| **SEC-002** | Docker Compose hardcoded passwords | Hardcoded insecure postgres credentials | Strict environment interpolation & required change | ✅ Verified |
| **SEC-003** | Permissive CORS with credentials | Cross-origin preflight from untrusted origin | `Access-Control-Allow-Origin` omitted | ✅ Verified |
| **SEC-004** | CSRF double-submit bypass via cookie-tossing | Subdomain cookie injection / forged token | HTTP 403 Forbidden | ✅ Verified |
| **SEC-005** | PII email harvesting | Public request to `GET /api/users/:username` | Email omitted for unauthenticated callers | ✅ Verified |
| **SEC-006** | Universal repository takeover via org teams | Attaching foreign repository to org team | HTTP 403 Forbidden (`isAdmin` enforced) | ✅ Verified |
| **SEC-007** | Local filesystem remote exfiltration | Adding `file:///etc/shadow` or local path remote | HTTP 400 Bad Request | ✅ Verified |
| **SEC-008** | CI secret exfiltration to untrusted fork PRs | Running CI pipeline trigger on fork PR | Fork PR secrets injection blocked | ✅ Verified |
| **SEC-009** | CI secrets encryption key coupling | AES-256-GCM authenticated encryption | Dedicated key & authentication tag enforced | ✅ Verified |
| **SEC-010** | CI runner host repository bind mount | Docker volume mounting host repo | Mounted strictly with `:ro` (read-only) | ✅ Verified |
| **SEC-011** | BOLA cross-repo issue modification | Updating foreign repository issue | HTTP 404 Not Found / Scoped query | ✅ Verified |
| **SEC-012** | Unauthorized PR reviewer deletion | Non-author non-writer reviewer deletion | HTTP 403 Forbidden | ✅ Verified |
| **SEC-013** | Case-folded `.itehaas` control overwrite | Tree checkout collision (`.Itehaas/`, `.git`) | Rejected by `is_forbidden_component` | ✅ Verified |
| **SEC-014** | DAG expansion bomb in tree flattening | Recursive nesting explosion | Max depth (100) & entry ceiling (100k) | ✅ Verified |
| **SEC-015** | Synchronous 64 MiB decompression DoS | Unbounded payload inflate | Capped at 64 MiB maximum stream size | ✅ Verified |
| **SEC-016** | Subprocess storm in fast-forward check | Repetitive ancestor subprocess spawning | Native iterative DAG traversal in Rust engine | ✅ Verified |
| **SEC-017** | Unbounded memory allocation in pack creation | Enormous declared pack entry sizes | Cumulative 512 MiB and 64 MiB limits | ✅ Verified |
| **SEC-018** | DNS rebinding SSRF in remote fetch | Private IP & cloud metadata addresses | Socket-level `SafeResolver` blocks private IPs | ✅ Verified |
| **SEC-019** | PR merge concurrency collision | Simultaneous merge requests on same repo | Repository advisory lock (HTTP 423) | ✅ Verified |
| **SEC-020** | SQL string interpolation in contributions | SQL injection via interval parameter | Strict parameterization and validation | ✅ Verified |
| **SEC-021** | CPU exhaustion via unthrottled contributions | Rapid contribution queries | Tiered rate limiting (20/min) | ✅ Verified |
| **SEC-022** | Non-owner collaborator repository deletion | Deletion attempted by non-owner | HTTP 403 Forbidden | ✅ Verified |
| **SEC-023** | Public issue creation restriction | Public collaborator creating issue | HTTP 201 Created | ✅ Verified |
| **SEC-024** | Pending email invite account takeover | Querying unverified target email invites | Scoped strictly to `invited_user_id` | ✅ Verified |
| **SEC-025** | Known vulnerabilities in production dependencies | `pnpm audit --prod --audit-level=critical` | 0 critical vulnerabilities | ✅ Verified |
| **SEC-026** | Docker host binary mount failure | Docker cross-architecture execution | Built internally in multi-stage Dockerfile | ✅ Verified |
