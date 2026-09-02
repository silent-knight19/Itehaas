# Security Phase S5 — Process Execution, Subprocess Isolation, & Resource Defense

**Status:** ✅ Complete  
**Date:** 2026-09-02  
**Owner:** Principal Security Engineer  
**Scope:** Eliminating subprocess storms in fast-forward ancestor checks ([SEC-016](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-016--denial-of-service-via-subprocess-storm-in-fast-forward-ancestor-check)), strict argument array execution (prohibiting shell strings), subprocess environment variable sanitization, flag injection prevention, and process execution timeouts.

---

## 1. Objective

Ensure all child process invocations are strictly bounded, executed without shell interpretation, cleansed of hostile environment variables (dynamic linker preloads, language runtime injection), protected against flag injection, and prevent subprocess storms during Git/VCS operations.

---

## 2. Threat Analysis & Defensive Matrix

| Threat | Attack Path | Previous State | Implemented Control (S5) |
|---|---|---|---|
| **Subprocess Storm in Fast-Forward Ancestor Check** (SEC-016) | During push operations, `isAncestor(repoPath, oldHash, newHash)` verified DAG ancestry by repeatedly spawning `itehaas cat-file -p` in a `while` loop for each visited commit parent. A branch with dozens or hundreds of commits spawned hundreds of concurrent/sequential child processes, causing PID table exhaustion, CPU spikes, and server DoS. | `server/src/routes/repos.ts` ran a loop spawning a separate child process per commit parent traversal. | Implemented `merge-base --is-ancestor <ancestor> <descendant>` and `is-ancestor` CLI subcommands in Rust (`vcs/src/main.rs`). The Fastify route now checks ancestry in a **single child process** executing in-memory BFS in Rust. Maintained bounded fallback. |
| **Loader & Dynamic Runtime Injection** | An attacker with environment injection capabilities sets `LD_PRELOAD`, `DYLD_INSERT_LIBRARIES`, `DYLD_LIBRARY_PATH`, `NODE_OPTIONS`, or `PYTHONPATH`. When the server spawns `itehaas`, malicious shared libraries or scripts are executed with backend permissions. | Environment variables could theoretically inherit from host. | `getAllowedEnv()` enforces a strict allowlist (`['PATH', 'LANG', 'HOME', 'USER', 'TMPDIR', 'SHELL']`). All dangerous loader and language runtime environment variables are dropped. |
| **Command-Line Flag Injection** | Attackers manipulate branch names or parameters formatted as flags (e.g. `--exec`, `--upload-pack`, `-f`) to alter the behavior of VCS commands. | Arguments were passed to child process, but without positional flag verification. | `execItehaas` enforces `isAllowedFlag` validation on any argument starting with `-` that is not a valid commit/object hash. Malicious or unrecognized flags are rejected before process spawn. |
| **Null Byte & Newline Injection in CLI Arguments** | Attackers pass strings containing `\0` or `\n` to truncate or split CLI arguments. | No input validation on individual array arguments. | `execItehaas` scans each argument array item and immediately rejects any string containing `\0`, `\r`, or `\n`. |
| **Runaway Process & Semaphore Starvation** | A stuck or slow VCS process holds a concurrency permit indefinitely, starving server throughput. | Timeout killed process but process group wasn't guaranteed to terminate. | Enforced 30-second hard timeout with `SIGTERM` followed by fallback `SIGKILL`. The `vcsSemaphore` is guaranteed to release on error, timeout, or completion. |

---

## 3. Files Modified

1. `vcs/src/main.rs`: Added `merge-base --is-ancestor <ancestor> <descendant>` and `is-ancestor <ancestor> <descendant>` subcommands backed by `itehaas_lib::merge::is_ancestor`.
2. `server/src/lib/vcs.ts`: Added `'--is-ancestor'` to `ALLOWED_FLAGS`; verified strict environment sanitization and argument safety checks.
3. `server/src/routes/repos.ts`: Updated `isAncestor` to execute single-process `merge-base --is-ancestor` first, eliminating recursive subprocess spawning while maintaining bounded fallback.
4. `server/src/routes/s5-proc.test.ts`: Added unit tests for environment sanitization, flag allowlisting, null-byte/newline rejection, and unapproved flag blocking.

---

## 4. Verification & Regression Tests

- **Phase S5 Process Security Tests (`server/src/routes/s5-proc.test.ts`):** 4/4 tests passed:
  - Environment sanitization strips `LD_PRELOAD`, `DYLD_*`, `NODE_OPTIONS`, `PYTHONPATH`, `SECRET_KEY`.
  - Flag allowlist permits `--is-ancestor`, `--oneline`, `-m`, etc., and rejects `--exec`, `--output`, etc.
  - Argument sanitization rejects null bytes (`\0`) and newlines (`\n`).
  - Unapproved flag injection in positional arguments is rejected before spawn.
- **Full Project Regression Test Suites:**
  - `pnpm --filter server test`: 22 test files, 184/184 tests green (including `s7-dos.test.ts` checks).
  - `cargo test`: 124/124 tests green.

---

## 5. Acceptance Criteria Checklist

- [x] Recursive subprocess storm eliminated in `isAncestor` via native CLI subcommand (SEC-016)
- [x] Hostile environment variables stripped before child process invocation
- [x] Argument arrays used exclusively (zero shell string interpolation)
- [x] Flag injection and control character injection blocked
- [x] Subprocess execution timeout and concurrency limits enforced
- [x] Zero functional regressions across existing test suites
- [x] Vulnerability register updated
- [x] `PLAN.md` updated

---

## 6. Next Phase Gate

- **Active Phase Status:** S5 COMPLETE.
- **Next Phase:** `SECURITY PHASE S6 — VCS OBJECT PARSER & SERIALIZATION SECURITY`
- **Scope:** Tree flattening DAG expansion bombs ([SEC-014](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-014--algorithmic-complexity-dos--dag-expansion-bomb-in-tree-flattening)), unbounded memory allocations in pack creation ([SEC-017](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-017--unbounded-memory-allocation-in-pack-creation)), and streaming packfile parser boundaries.
