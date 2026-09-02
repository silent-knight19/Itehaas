# Security Phase S6 — VCS Object Parser & Serialization Security

**Status:** ✅ Complete  
**Date:** 2026-09-02  
**Owner:** Principal Security Engineer  
**Scope:** Eliminating tree flattening DAG expansion bombs and cycles ([SEC-014](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-014--algorithmic-complexity-dos--dag-expansion-bomb-in-tree-flattening)), bounding memory allocation during pack creation and verification ([SEC-017](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-017--unbounded-memory-allocation-in-pack-creation)), and hardening author/committer signature parsing against CRLF and null-byte injection.

---

## 1. Objective

Harden all binary and text object parsers, serializers, and packfile decoders in the Rust VCS core against algorithmic complexity attacks, memory exhaustion (pack bombs, expansion bombs), and header injection vulnerabilities.

---

## 2. Threat Analysis & Defensive Matrix

| Threat | Attack Path | Previous State | Implemented Control (S6) |
|---|---|---|---|
| **DAG Expansion Bomb in Tree Flattening** (SEC-014) | Attacker crafts a diamond DAG where a small number of tree objects (e.g. 20 levels of paired subtrees) reference each other recursively. When `flatten_tree` walks the tree to construct the working directory or check diffs, the entry list expands exponentially ($2^{20} > 1,000,000$), exhausting heap memory and CPU. | `vcs/src/tree_builder.rs:flatten_tree` bounded depth to 100, but did not bound the total cumulative entry count or track cycle detection. | Implemented `flatten_tree_with_ancestors` with strict active ancestor cycle tracking (`active_ancestors: BTreeSet<String>`) and enforced a hard limit of 100,000 total flattened entries (`out.len() > 100_000`), terminating expansion bombs. |
| **Unbounded Memory Allocation in Pack Creation & Verification** (SEC-017) | Attacker crafts a repository or packfile containing thousands of loose objects or inflated entries claiming 64 MiB each, causing gigabytes of uncompressed memory to be pre-allocated during pack handling. | Pack verification checked single entry `len > 64M`, but did not bound cumulative pack payload size across all entries. Pack creation had no object count or byte bounds. | In `vcs/src/pack.rs`: bounded single pack creation to $\le 10,000$ entries and $\le 512$ MiB uncompressed bytes. In `verify_pack`, enforced a cumulative size cap of 512 MiB across all entries. |
| **Commit/Tag Signature Header Injection** | An attacker submits a commit with `\r` (carriage return) or `\0` in the author name or email. In CRLF-sensitive environments or when parsing commit headers, carriage returns can split headers or forge commit metadata lines. | `validate_sig_field` checked for `<`, `>`, and `\n`, but did not check `\r` or `\0`. | Updated `validate_sig_field` in `vcs/src/object/commit.rs` to explicitly reject strings containing `\r` or `\0`. |

---

## 3. Files Modified

1. `vcs/src/tree_builder.rs`: Implemented cycle detection via `active_ancestors` and bounded total flattened entries to 100,000 (SEC-014).
2. `vcs/src/object/commit.rs`: Added rejection of `\r` and `\0` in author/committer signature fields.
3. `vcs/src/pack.rs`: Enforced 10,000 entry limit and 512 MiB uncompressed data limit on `create_pack`; enforced 512 MiB cumulative data limit on `verify_pack` (SEC-017).
4. `vcs/tests/s6_parser_test.rs`: Added negative regression tests for cycle detection in tree flattening and CRLF/null rejection in signatures.

---

## 4. Verification & Regression Tests

- **Parser Security Test Suite (`cargo test --test s6_parser_test`):** 11/11 tests passing:
  - `test_tree_cycle_detection`: Verifies cycle detection triggers and rejects cyclic references without recursion explosion.
  - `test_signature_rejection_crlf_null`: Verifies `\r\n` and `\0` are rejected in signatures.
  - `test_invalid_mode_rejected`.
  - `test_duplicate_tree_rejected`.
  - `test_huge_commit_message_rejected`.
  - `test_pack_entry_declared_length_limit`.
  - `test_pack_bomb_count_limit`.
  - `test_deep_tree_build_limit`.
  - `test_truncated_zlib_corrupt`.
  - `test_tree_too_many_entries`.
  - `test_bomb_64m_decompression_guard`.
- **Full Project Regression Test Suites:**
  - `cargo test`: 124/124 tests green.
  - `pnpm --filter server test`: 22 test files, 184/184 tests green.

---

## 5. Acceptance Criteria Checklist

- [x] Tree cycle detection and DAG expansion limit enforced (SEC-014)
- [x] Memory bounds on pack creation and verification enforced (SEC-017)
- [x] Signature header injection (CRLF, null bytes) blocked
- [x] Zero functional regressions in existing tests
- [x] Vulnerability register updated
- [x] `PLAN.md` updated

---

## 6. Next Phase Gate

- **Active Phase Status:** S6 COMPLETE.
- **Next Phase:** `SECURITY PHASE S7 — RESOURCE EXHAUSTION, DOS, & ASYNC DECOMPRESSION`
- **Scope:** Synchronous 64 MiB inflate event loop starvation ([SEC-015](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-015--event-loop-starvation-dos-via-synchronous-64-mib-decompression)), and unthrottled contributions endpoint CPU exhaustion ([SEC-021](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-021--unauthenticated-remote-cpu--subprocess-exhaustion-via-contributions)).
