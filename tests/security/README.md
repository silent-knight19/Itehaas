# Itehaas Adversarial Security Test Corpus (Fresh S19)

**Date:** 2026-09-03 · **Rule:** every important attack path must fail safely *and*
prove it in a test. Happy-path tests are not security tests.

Run everything:

```bash
pnpm --filter server exec vitest run          # 31 files, 387 tests
pnpm --filter web exec vitest run             # jsdom XSS + CSP suites
cargo test -p itehaas                         # Rust parser/transport suites
```

## 1. Required categories → suites (fresh program)

| Required category | Suite | What it proves |
|---|---|---|
| Auth: expired/invalid/replay/fixation/brute-force | `server/.../auth-s2.test.ts` (23), `s19-fresh` auth chains | lockout audit, 401 replay-after-nuke, fixation rotation |
| AuthZ: IDOR/BOLA cross-repo/user/org/team, private leakage | `authz-s3` (33), `s19-fresh` tenant chains | 403/404 on every swap, private invisible |
| Filesystem: `../`, symlink, TOCTOU, Unicode, absolute, nested escape | `fs-s4` (19), `s4_fs_test` (4), `s19-fresh` battery | containment + i18n preserved |
| VCS: malformed objects, bad lengths, oversized blobs, cycles, deep graphs, bad packs, bombs | `s6_parser_test` (22), `store_tests`, `property_tests` | fail-safe parses, linear DAGs, capped packs |
| API: oversized bodies, invalid JSON/UUID/hash/ref, pagination abuse | `s7-dos` (21), `s8-db` (13), `s14-rate` (11), `s19-fresh` shapes | 400/404/413/429, never 500/leak |
| XSS: issue/PR/Markdown/filename/commit-message | `web/.../MarkdownViewer.test.tsx` (9), `next.config.test.ts` (2), `s10/s11-xss` | inert output, protocol locks, CSP derivation |
| CI: secret theft, network/FS access, exhaustion, fork isolation, priv-esc | `s9-secrets` (15), `s10-ci` (11), `s13-ci`, `s19-fresh` tenant chains | empty fork env, `:ro`+caps, budgets, 403s |
| SSRF: localhost/127/private/metadata/redirect/rebinding | `s13-ssrf` (18), `s12_ssrf_test` (4), `s19_net_test` (3) | gates at create+exec+connect; **redirects never followed** |
| Startup/config | `s1-baseline` (36) | fail-closed boot matrix |
| Concurrency/TOCTOU | `s15-concurrency` (10), `s15_rev_test` (3) | one lock key, steal-once, `--rev` reads |
| Supply chain | `s16-deps` (14), `s16-crypto` | pins, hygiene, `cargo audit` + `pnpm audit` gates |
| Deploy/host | `s17-deploy` (15) | profiles, perms, docs |
| Observability | `s18-audit` (12) | events, retention, secret-free proof |
| Process boundary | `s5-fresh` (7), `s5-proc`, `vcs-s5` | argv-only, caps, prefix pinning |

## 2. Legacy matrix (prior program, retained)

The `SEC-001…SEC-026` table below is preserved as history; the authoritative
fresh findings live in `docs/security/vulnerability-register.md` (`FSEC-001…`).

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

## 3. Regression rule

Every `FSEC-xxx` row in `docs/security/vulnerability-register.md` names its
regression suite. A fix without a failing-first adversarial test does not land.
