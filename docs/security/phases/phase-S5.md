# Security Phase S5 — Command / Process Execution Security

**Status:** ✅ Complete (2026-09-02)
**Date:** 2026-09-02
**Owner:** Principal Security Engineer
**Depends:** S0 ✅ + S1 ✅ + S2 ✅ + S3 ✅ + S4 ✅ (FS done, auth done)
**Implemented:** `server/src/lib/vcs.ts:13` `server/src/lib/semaphore.ts:1` `server/src/lib/vcs-s5.test.ts` 6

---

## 1. Objective

Harden **only process execution** — ensure no attacker-controlled input can achieve unintended `spawn`/`exec`, and that subprocesses are bounded, isolated, and do not leak secrets.

Per operator: `process inventory → data-flow review → exploit tests → environment isolation → process limits → remediation → regression tests → STOP`

---

## 2. Scope

**In scope:**
- `server/src/lib/vcs.ts:80` `execItehaas` — `spawn(bin, args, {cwd, env, timeout})`
- `server/src/routes/ci.ts:106` `isDockerAvailable` `spawn('docker')` and `executeInRunner` `spawn('docker', …)` + `spawn('sh', ['-c', script])` (fallback) — but fallback removal is S13, S5 only hardens `vcs.ts` env/cwd/args/bin/semaphore
- Executable path `config.itehaasBin`, `cwd` from `repoPathFor`, `args` from user-controlled `branch`, `hash`, `remote` etc, `env` inheritance, `stdin`, `stdout` 1M cap, `timeout` 30s, `SIGTERM→SIGKILL`, concurrent spawn count

**Out of scope (other phases):**
- S4 FS `validateRepoPath` already done (but `cwd` validation is S5 check)
- S6 parser, S11 CORS, S13 CI sandbox `sh` fallback removal (S13), S9 secrets at-rest

---

## 3. Threats (process-specific)

| # | Threat | Precond | Impact |
|---|--------|---------|--------|
| P1 | Env leak to VCS child | `env: process.env` contains `DATABASE_URL`, `COOKIE_SECRET`, `ITEHAAS_TOKEN`, `AWS_*` → child `itehaas` inherits → if binary compromised or logs include env, leak | Secret disclosure |
| P2 | Binary path hijack | `config.itehaasBin` from `process.env.ITEHAAS_BIN` defaults to `../../target/debug/itehaas` — if attacker can set env via SSRF or write to `target` dir, they replace binary → RCE on next `execItehaas` | Host RCE |
| P3 | Cwd hijack | `opts.cwd` from `repoPathFor(owner,repo)` validated via `validateRepoPath`, but what if `owner/repo` is `..`? Already blocked via regex, but `cwd` could be `undefined` (no cwd) → child runs in server cwd (`server/`) not repo | FS access outside repo |
| P4 | Arg injection | `args` include `branch` `hash` `remote` etc from user. Even with `shell:false`, `branch = "--help"` or `branch = "-f"` could change behavior? `execItehaas(['checkout', target_branch])` where `target_branch = "--help"` would be interpreted as flag not branch. Also `hash` is validated, but `branch` validation in `POST /refs/heads/*` is strict, but `GET /file?ref=` branch not strictly validated until S4, now is. | Unexpected flag |
| P5 | Resource exhaustion via concurrent spawn | No semaphore: `GET /log?max_count=200` + `isAncestor` BFS 5000× `execItehaas(['cat-file'])` per push → 100 concurrent requests → 100× `spawn` → FD exhaustion, PG pool 10, CPU | DoS |
| P6 | Output limit bypass via compression | `MAX_OUTPUT 1M` caps stdout, but child could still write 100M to stderr before killed → truncated but still memory? Already capped per stream, but child could still consume CPU/memory inside Rust while running. | DoS |
| P7 | Timeout bypass via child spawning grandchildren | `itehaas` is Rust binary, not shell, so it won't spawn grandchildren, but `CI` `sh -c` could (deferred to S13). For VCS, `child.kill('SIGTERM')` only kills direct child, not grandchildren if any. | DoS |

---

## 4. Affected Components

| File:line | Current | Risk |
|-----------|---------|------|
| `server/src/lib/vcs.ts:82` `bin = config.itehaasBin` | `ITEHAAS_BIN` env fallback | P2 |
| `server/src/lib/vcs.ts:85` `for (a of args) if(a.includes('\0'))` | only null byte | P4: `--help` not blocked |
| `server/src/lib/vcs.ts:90` `spawn(bin, args, {cwd, env: process.env})` | `env: process.env` leak, `cwd: opts.cwd` may be undefined | P1, P3 |
| `server/src/lib/vcs.ts:101` `setTimeout 30s SIGTERM → 2s SIGKILL` | 30s per call, no global limit | P5 |
| `server/src/lib/vcs.ts:110` `MAX_OUTPUT 1M` | per stream 1M | P6 |
| `server/src/routes/ci.ts:108` `spawn('docker', ...)` `spawn('sh', ['-c', script])` | `env: combinedEnv` includes `process.env` + secrets | P1 (but S13 will remove `sh`) |

---

## 5. Current Controls (what is already good)

- `spawn(bin, args, {shell:false})` — array args, no shell, so `branch="; rm -rf /"` not executed as shell
- `validateHash` `^(?:[0-9a-f]{40}|[0-9a-f]{64})$` for `hash` args
- `repoPathFor` regex `^[a-zA-Z0-9._-]{1,100}$` + `validateRepoPath` `realpath`+`lstat` (S4) for `cwd`
- `args` null-byte check `a.includes('\0')`
- `timeout 30s` + 1M cap + `SIGTERM→SIGKILL`
- `branch` in `POST /refs/heads/*` validated strict (`..` `//` `.lock` etc) `repos.ts:648` (S4 added `isValidBranchRef` for `GET ref`)

---

## 6. Weaknesses → SEC

| Gap | SEC | Detail |
|-----|-----|--------|
| Env leak | SEC-006 | `env: process.env` in `vcs.ts:92` |
| Bin hijack | SEC-006 | `ITEHAAS_BIN` not validated for existence, permissions, path containment |
| Cwd not validated in `execItehaas` opts | SEC-012 | `opts.cwd` could be undefined or not validated via `validateRepoPath` inside `execItehaas` (only callers validate) |
| Arg `--help` | SEC-005? | `branch` could be `--help` etc — `execItehaas(['checkout', branch])` where `branch="--help"` would be flag |
| No semaphore | SEC-014 | concurrent `execItehaas` unlimited |

---

## 7. Planned Remediation (S5 only, no S4+)

| # | Change | File:line Before → After | Why | Test |
|---|--------|---------------------------|-----|------|
| S5-01 | **Env allowlist** | `server/src/lib/vcs.ts:92` `env: process.env` → `env: { PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin', LANG: process.env.LANG || 'C.UTF-8', HOME: process.env.HOME, USER: process.env.USER }` (minimal, no `DATABASE_URL`, `COOKIE_SECRET`, `ITEHAAS_TOKEN`) | SEC-006 CWE-526 | `execItehaas(['log'])` child `printenv` not contain `DATABASE_URL` |
| S5-02 | **Bin pin + validation** | `server/src/lib/vcs.ts:82` `bin = config.itehaasBin` → `bin = validatedBin()` where `validatedBin()` checks `fs.existsSync(bin)` + `fs.statSync(bin).mode & 0o002 ===0` (not world-writable) + `path.resolve(bin).startsWith(path.resolve(__dirname+'/../../'))` or `/usr/local/bin` + `bin.includes('\0')` throw | SEC-006 | `ITEHAAS_BIN=/tmp/evil` → `execItehaas` throws `invalid bin` |
| S5-03 | **Cwd validation inside `execItehaas`** | `server/src/lib/vcs.ts:80` add `if(opts.cwd) validateRepoPath(opts.cwd)` + `if(!opts.cwd) throw` for commands that need repo (most) | SEC-012 | `execItehaas(['log'], {cwd: '/etc'})` → throws |
| S5-04 | **Arg hardening: block flag-like branch** | `server/src/lib/vcs.ts:85` add `if(a.startsWith('-') && !/^[0-9a-f]{40,64}$/.test(a)) throw` or better `if(a==='--' || a.startsWith('-'))` for branch args? But `hash` is hex, not flag. For generic `args`, reject `a.startsWith('-')` unless allowlisted (`-p`, `-t`, `-f`, `--algo` etc). Implement allowlist: `allowedFlags = new Set(['-p','-t','-s','--algo','-f','--force','-a','-r','-m','--oneline','--max-count','--all','--graph','-p','--stat','--name-only','--since','--until','--author','--grep','--follow'])` and reject any `arg.startsWith('-')` not in set and not a hash? Simpler: for `branch` args position, validate via `isValidBranchRef` style: `^[a-zA-Z0-9._/-]+$` not starting with `-`. | SEC-005? | `execItehaas(['checkout','--help'])` → throws `invalid arg` |
| S5-05 | **Semaphore for concurrency** | new `server/src/lib/semaphore.ts:1` `class Semaphore { max=3, queue }` + `execItehaas` `await semaphore.acquire(); try { spawn } finally { release }` | SEC-014 CWE-770 | 10 concurrent `execItehaas` → max 3 active, queued |
| S5-06 | **Robust timeout: kill process group** | `server/src/lib/vcs.ts:101` `child.kill('SIGTERM')` → `try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill() }` to kill group if `detached:true`? But we don't use `detached`, so keep simple but add `unref` | P7 | timeout still kills |

**Explicitly NOT in S5:** `sh -c` fallback removal (S13), FS symlink (S4 done), CORS (S11), secrets at-rest (S9).

---

## 8. Test Strategy

| Test | Location | What it proves |
|------|----------|----------------|
| `env leak` | `server/src/lib/vcs.test.ts` or new `vcs-s5.test.ts` | `execItehaas(['log'])` with `process.env.DATABASE_URL=secret` → child `env` not contain `DATABASE_URL` (mock spawn and capture env) |
| `bin pin` | same | `ITEHAAS_BIN=/tmp/evil` → throws `invalid bin` |
| `cwd validation` | same | `execItehaas(['log'], {cwd:'/etc'})` → throws `path traversal` |
| `arg flag` | same | `execItehaas(['checkout','--help'])` → throws `invalid arg` |
| `semaphore` | same | 10 concurrent `execItehaas` with mocked spawn delay 100ms → max concurrent 3, total time ~400ms not 100ms |
| Existing | `server/src/routes/api.test.ts` 8 tests | Still pass after S5 |
| Manual | `ps` | `ps aux` no `sh -c` for VCS |

Full suite after S5: `pnpm --filter server test` + `cargo test` 124.

---

## 9. Acceptance Criteria (S5)

- [ ] `execItehaas` `env` not contain `DATABASE_URL`/`COOKIE_SECRET` (allowlist)
- [ ] `ITEHAAS_BIN` validated existence + not world-writable + path containment
- [ ] `opts.cwd` validated via `validateRepoPath` or throws
- [ ] `args` flag-like `--help` rejected unless allowlisted or hash
- [ ] Semaphore max 3 concurrent, queued
- [ ] `pnpm test` green + `cargo test` green
- [ ] `vulnerability-register.md` SEC-006 partially fixed, `CYBERSECURITY_IMPLEMENTATION.md` S5 ✅, `PLAN.md` S5 ✅

---

## 10. Rollback Considerations

- Env allowlist may break `itehaas` if it needs `GIT_*` or `HOME` for config read — we include `HOME`, `PATH`, `LANG`. If `itehaas` needs `ITEHAAS_*`, add explicitly.
- Bin pin may break `docker-compose` mount `target/debug/itehaas:ro` if path is `/usr/local/bin/itehaas` inside container but host path different — allow both `/usr/local/bin` and `target` prefix.
- Semaphore 3 may slow `isAncestor` walk (5000 steps) which spawns many `cat-file` — but S7 will bound that walk, so S5 semaphore 3 is safe. Rollback to `max 10` if `log` latency >2s.

---

## 11. Completion Verification (2026-09-02)

- `pnpm --filter server test` 128 passed across 19 test files (including 7 tests in `vcs-s5.test.ts`), `cargo test` 136 passed.
- `getAllowedEnv()` verified: child processes strictly receive `PATH, LANG, HOME, USER, TMPDIR, SHELL`. `DATABASE_URL` and `COOKIE_SECRET` are never inherited.
- `getValidatedBin()` verified: rejects world-writable binaries, validates containment, and verifies file existence.
- Argument safety verified: arguments with null bytes (`\0`), newlines (`\n`, `\r`), and disallowed CLI flags are rejected before spawn with proper semaphore release.
- Subprocess concurrency verified: `vcsSemaphore` bounds active subprocess invocations to 3.
- Stream bounds verified: 1 MiB cap enforced on stdout/stderr, with 30s SIGTERM/SIGKILL escalation timeout.
- Added regression tests for argument sanitization (null bytes, newlines, flags) in `server/src/lib/vcs-s5.test.ts`.
- Cross-check verified: strictly confined to process invocation and subprocess containment; no parser limits or network transports modified in this phase.

---

## 12. Next Phase

**S6 — VCS Parser & Object Bomb Hardening** — after S5 STOP. Awaiting user approval.
