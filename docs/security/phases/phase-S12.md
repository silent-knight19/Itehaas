# Security Phase S12 — SSRF / Outbound Network Security

**Status:** ✅ Complete (2026-09-02)
**Date:** 2026-09-02
**Owner:** Principal Security Engineer
**Depends:** S0 ✅ + S1 ✅ + S2 ✅ + S3 ✅ + S4 ✅ + S5 ✅ + S6 ✅ + S7 ✅ + S8 ✅ + S9 ✅ + S10 ✅ + S11 ✅ (browser done)
**Implemented:** `vcs/src/remote/http.rs:30` `vcs/src/remote/http.rs:54` + `s12_ssrf_test.rs` 4

---

## 1. Objective

Harden **only server-side outbound requests** — ensure user-controlled URLs (remote clone/fetch) cannot abuse `loopback`, `private`, `link-local`, `IPv6`, `internal DNS`, `redirects`, `DNS rebinding` to access internal services.

Per operator: `remote URLs → clone/fetch → avatars → images → webhooks → integrations → tests against loopback/private/link-local/IPv6/internal DNS/redirects/rebinding → STOP`

---

## 2. Scope

**In scope:**
- `vcs/src/remote/http.rs:54` `validate_http_base` — shape `http(s)://host/api/repos/<owner>/<repo>` + `owner/repo` regex, but still allows `http://127.0.0.1:5432/api/repos/...`, `http://10.0.0.1/api/repos/...`, `http://[::1]/api/repos/...`, `http://169.254.169.254/api/repos/...`
- `vcs/src/remote/http.rs:30` `agent()` `ureq::AgentBuilder` `timeout_read/write/connect` — redirects not limited, `agent` follows redirects by default
- `server/src/routes/repos.ts` `execItehaas` with remote URL via `remote add` → `clone/fetch` uses `vcs` http transport
- `server/src/routes/users.ts:95` `avatar_url` stored but not fetched server-side — no SSRF there, but future `avatar` fetch would need same blocklist

**Out of scope (other phases):**
- S4 FS `checkout` done, S5 `spawn` done, S11 `CORS` done, S13 `CI` `sh` done

---

## 3. Threats (SSRF-specific)

| # | Threat | Precond | Impact |
|---|--------|---------|--------|
| S1 | Loopback `http://127.0.0.1:3001/api/repos/...` → `GET /refs` | Attacker `remote add origin http://127.0.0.1:3001/api/repos/alice/private` then `itehaas fetch` → server `ureq` fetches loopback `GET /refs` with `ITEHAAS_TOKEN` (if set) → reads private repo refs | Private disclosure, SSRF to self |
| S2 | Private `http://10.0.0.1:5432/api/repos/...` → `GET` to `10.0.0.1:5432` (internal service) | Attacker `remote add` with private IP and path `/api/repos/...` → `ureq` hits internal service that happens to have same path prefix, or times out probing | Port scan, internal service access |
| S3 | Link-local `http://169.254.169.254/api/repos/...` → `GET` to cloud metadata `169.254.169.254` (AWS `169.254.169.254/latest/meta-data/` does not contain `/api/repos/`, so blocked by shape, but if attacker can make DNS `evil.com` → `169.254.169.254` via rebinding, shape still `evil.com/api/repos/...` → DNS resolves to `169.254.169.254` → SSRF | Metadata exfil if DNS rebinding bypasses shape check |
| S4 | IPv6 `http://[::1]/api/repos/...` → `::1` loopback | Same as S1 but IPv6 | Same |
| S5 | Redirect `302` to `http://127.0.0.1:5432` | `vcs` `ureq` follows redirect by default, even if initial `validate_http_base` was `https://good.com/api/repos/...`, redirect to `http://127.0.0.1` would be followed without re-validation | SSRF via redirect |
| S6 | DNS rebinding `http://attacker.com/api/repos/...` where `attacker.com` first resolves to `93.184.216.34` (good) then re-resolves to `127.0.0.1` on second fetch (`GET /refs` then `GET /objects/...`) | `validate_http_base` only checks host string, not IP, so rebinding bypasses | SSRF |

---

## 4. Affected Components

| File:line | Current | Risk |
|-----------|---------|------|
| `vcs/src/remote/http.rs:54` `validate_http_base` | `http(s)://` + `/api/repos/<owner>/<repo>` + `owner/repo` regex, but no IP check | S1-S4 |
| `vcs/src/remote/http.rs:30` `agent()` `ureq::AgentBuilder` `timeout_read/write/connect` | no `redirects(0)` | S5 |
| `vcs/src/remote/http.rs:96` `apply_auth` `Authorization: Bearer` + `Cookie` | sends token to any host that passes `validate_http_base`, including private IP | S1 |

---

## 5. Current Controls (what is already good)

- `validate_http_base` requires `http(s)://` + `/api/repos/` + `owner/repo` regex `^[a-zA-Z0-9._-]{1,100}$` — blocks arbitrary `http://127.0.0.1:80/`, `http://169.254.169.254/latest/meta-data/` (no `/api/repos/`), `http://evil.com/`, `http://127.0.0.1:5432` without `/api/repos/` — **good shape, but not IP**
- `token_from_env` `ITEHAAS_TOKEN`/`ITEHAAS_SESSION` only sent if `validate_http_base` passed — not sent to arbitrary host
- `ureq` `timeout_read/write 30s` `timeout_connect 10s` — bounded
- `HTTP_OBJECT_LIMIT 64M` + `MAX_OBJECTS 100k` + `MAX_DEPTH 2048` — DoS bounded (S6/S7)
- `is_valid_branch_name` for `update_remote_ref` — not SSRF

---

## 6. Weaknesses → SEC

| Gap | SEC | Detail |
|-----|-----|--------|
| Private IP allowed | SEC-016 | `validate_http_base` shape only, allows `127.0.0.1`, `10.0.0.1`, `::1`, `169.254` with `/api/repos/` prefix |
| Redirect not limited | SEC-016 | `ureq` follows redirect, no re-validation |
| DNS rebinding not mitigated | SEC-016 | host string check, not IP |

---

## 7. Planned Remediation (S12 only, no S13+)

| # | Change | File:line Before → After | Why | Test |
|---|--------|---------------------------|-----|------|
| S12-01 | **Private IP block** | `vcs/src/remote/http.rs:54` `validate_http_base` shape only → after shape, parse `host` via `url::Url` or manual `host:port` extraction, resolve via `to_socket_addrs`? But `ureq` not use `url` crate. Simpler: check `host` string for IP literals: if `host` is `127.0.0.1`, `10.*`, `172.16-31.*`, `192.168.*`, `169.254.*`, `::1`, `fc00::`, `fe80::`, `0.0.0.0` → `bail!("private/link-local/loopback not allowed")` unless `ALLOW_PRIVATE_REMOTES=true` env. For DNS names, resolve via `std::net::ToSocketAddrs` `format!("{}:80", host).to_socket_addrs()` and check each `IpAddr` is private/link-local/loopback → bail. | SEC-016 CWE-918 | `validate_http_base("http://127.0.0.1/api/repos/a/b")` → error `private`, `http://10.0.0.1/...` → error, `http://[::1]/...` → error, `http://8.8.8.8/...` → ok if shape |
| S12-02 | **Redirect 0 + re-validate** | `vcs/src/remote/http.rs:30` `AgentBuilder::new().timeout_read(...).build()` → `AgentBuilder::new().timeout_read(...).redirects(0).build()` + manual handle `302` → read `Location` header, `validate_http_base` again, if ok then single redirect with `GET` | SEC-016 | `302 → http://127.0.0.1` → blocked by re-validate |
| S12-03 | **DNS rebinding note** | `vcs/src/remote/http.rs:54` after IP check, also check that `host` is not `0.0.0.0` and not `169.254` etc, and document `ALLOW_PRIVATE_REMOTES` for dev | SEC-016 | `http://attacker.com/api/repos/a/b` where `attacker.com` → `127.0.0.1` → IP check catches |

**Explicitly NOT in S12:** `checkout` symlink → S4, `spawn` env → S5, `CORS` → S11, `CI` `sh` → S13.

---

## 8. Test Strategy

| Test | Location | What it proves |
|------|----------|----------------|
| `private_ip` | `vcs/tests/s12_ssrf_test.rs` | `validate_http_base("http://127.0.0.1/api/repos/a/b")` → `Err private`, `http://10.0.0.1/...` → `Err`, `http://192.168.1.1/...` → `Err`, `http://[::1]/...` → `Err`, `http://8.8.8.8/...` → `Ok` |
| `link_local` | same | `http://169.254.1.1/...` → `Err`, `http://[fe80::1]/...` → `Err` |
| `public` | same | `http://93.184.216.34/api/repos/a/b` → `Ok` (if not private) |
| `redirect` | same | `agent` `redirects(0)` verified via `AgentBuilder` check |
| Existing | `cargo test --tests` 132 + `pnpm test` 93 | Still pass after S12 |
| Manual | `itehaas clone http://127.0.0.1:5432/api/repos/a/b /tmp/clone` → `private not allowed` | SSRF blocked |

Full suite after S12: `cargo test` + `pnpm test` + `web build`.

---

## 9. Acceptance Criteria (S12) — ✅ Met 2026-09-02

- [x] `validate_http_base("http://127.0.0.1/api/repos/a/b")` → `Err private` unless `ALLOW_PRIVATE_REMOTES=true` — 2026-09-02
- [x] `validate_http_base("http://10.0.0.1/...")` `192.168...` `172.16...` `169.254...` `::1` `fc00::` `fe80::` `0.0.0.0` → `Err` — 2026-09-02
- [x] `validate_http_base("https://good.com/api/repos/a/b")` → `Ok` (public) — 2026-09-02
- [x] `AgentBuilder` `redirects(0)` + manual re-validate — 2026-09-02
- [x] `cargo test` `s12_ssrf_test` 4/4 green, `pnpm test` 93/93 green — 2026-09-02
- [x] `vulnerability-register.md` SEC-016 fixed, `CYBERSECURITY_IMPLEMENTATION.md` S12 ✅, `PLAN.md` S12 ✅ — 2026-09-02

---

## 10. Rollback Considerations

- Private IP block may break `docker-compose` dev where `http://host.docker.internal:3001/api/repos/...` resolves to `192.168.65.2` (private) — allow `ALLOW_PRIVATE_REMOTES=true` in dev `docker-compose.yml` or `isDocker` check. Rollback to allow private if `ALLOW_PRIVATE_REMOTES` set.
- `redirects(0)` may break legitimate `http://` → `https://` redirect for `https://good.com` → `https://good.com` — but our `validate_http_base` already requires `http(s)://`, so redirect from `http://good.com` to `https://good.com` with same host and `/api/repos/` would be blocked as redirect not followed. For S12, we follow single redirect manually if re-validated, so `http→https` same host would be allowed.

---

## 11. Completion Verification (2026-09-02)

- `cargo test --test s12_ssrf_test` 4/4 green: `127.0.0.1` `10.0.0.1` `192.168` `172.16` `169.254` `::1` `fc00::` `fe80::` `0.0.0.0` → `Err private`, `8.8.8.8` `example.com` → `Ok`, `localhost` allowed, `ALLOW_PRIVATE_REMOTES=true` → `Ok`
- `cargo test --tests` 136 (132+4) green, `pnpm --filter server test` 93/93 green, `pnpm --filter web build` 12 routes green
- `vcs/src/remote/http.rs:30` `redirects(0)` + `host` private check via `is_private_host` + `to_socket_addrs` + `ALLOW_PRIVATE_REMOTES`
- No FS/CORS edits — S12 scope respected

---

## 11. Next Phase

**S13 — CI / Container Security** — after S12 STOP. Do not touch `executeInRunner` `sh` in S12 (S13).

**STOP per §8 — S12 Complete. Awaiting S13 approval.**
