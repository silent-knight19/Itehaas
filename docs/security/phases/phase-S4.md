# Security Phase S4 — Filesystem & Path Traversal Security

**Status:** ✅ Complete  
**Date:** 2026-09-02  
**Owner:** Principal Security Engineer  
**Scope:** Hardening VCS object trees, checkout working trees, and Fastify file browsing routes against path traversal, symlink escapes, case-insensitive collision attacks ([SEC-013](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-013--case-insensitive-filesystem-control-structure-overwrite-via-content)), 8.3 short-filename collisions, Windows reserved device names, and trailing normalization bypasses.

---

## 1. Objective

Ensure that untrusted repository content, branch checkouts, and file browsing APIs cannot escape repository roots, traverse symlinks, or overwrite internal VCS control structures (`.itehaas`, `.git`, `.hg`, `.svn`) on case-insensitive filesystems (macOS APFS, Windows NTFS/FAT).

---

## 2. Threat Analysis & Defensive Matrix

| Threat | Attack Path | Previous State | Implemented Control (S4) |
|---|---|---|---|
| **Case-Insensitive Control Structure Overwrite** (SEC-013) | An attacker commits files named `.Itehaas/config`, `.ITEHAAS/HEAD`, or `.iTeHaAs/hooks` into a repository. When cloned or checked out on macOS or Windows, the filesystem resolves the path to `.itehaas/`, corrupting or taking over repository metadata. | `vcs/src/checkout.rs` checked `s == ".itehaas" || s == ".git"` using exact case-sensitive comparison. `TreeEntry::new` permitted any string without `/` or `\0`. | Implemented `is_forbidden_component` in `vcs/src/object/tree.rs`. Validates that all path components case-insensitively reject `.itehaas`, `.git`, `.hg`, and `.svn`. Applied at tree object validation and checkout layers. |
| **8.3 Short Filename Collision Attack** (SEC-013) | On Windows/FAT/NTFS filesystems with 8.3 short filename generation enabled, `.itehaas` generates alias `ITEHAA~1`. A tree entry named `ITEHAA~1/config` bypasses standard checks and writes directly into `.itehaas/config`. | No 8.3 alias detection in either Rust VCS or Node.js API layers. | Rejects any path component whose lowercase representation starts with `itehaa~` or `git~`. |
| **Windows Reserved Device Names** | An attacker creates files named `CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9` (or with extensions like `nul.txt`). On Windows filesystems, accessing these names causes OS hangs, denial of service, or arbitrary device pipe writes. | No reserved device name checks. | Implemented strict rejection in `is_forbidden_component` (Rust) and `isValidFilePath` (TypeScript) for `CON`, `PRN`, `AUX`, `NUL`, `COM1..9`, `LPT1..9`. |
| **Trailing Dots & Spaces Normalization** | Attackers craft filenames ending with `.` or space ` ` (e.g. `foo.` or `foo `). Windows and certain macOS APIs strip trailing dots/spaces during file creation, causing filename collisions or file extension masquerading. | No trailing character validation. | Explicitly rejected components where `ends_with('.')` or `ends_with(' ')`. |
| **Symlink Parent Traversal & Working Tree Escapes** | An attacker commits a symlink pointing to an external directory (e.g. `/tmp` or `/etc`), followed by a commit that writes files under that directory. | Handled in `vcs/src/checkout.rs` via `ensure_no_symlink_and_inside_repo`, but now reinforced with full forbidden component checks across all ancestor segments. | Verified that symlinks cannot be traversed during checkout, symlink metadata is validated at every directory level, and non-canonical escapes are rejected. |

---

## 3. Files Modified

1. `vcs/src/object/tree.rs`: Added `pub fn is_forbidden_component(name: &str) -> bool`; integrated into `validate_name(&name)` so malformed trees are rejected upon object creation/parsing.
2. `vcs/src/checkout.rs`: Updated `ensure_no_symlink_and_inside_repo` to validate every path segment against `is_forbidden_component`.
3. `server/src/routes/repos.ts`: Hardened `isValidFilePath(p: string)` to enforce case-insensitive control structure rejection, 8.3 short name alias rejection, Windows reserved device names, and trailing dots/spaces.
4. `vcs/tests/s4_fs_test.rs`: Added negative regression tests for `is_forbidden_component` and `TreeEntry::new`.
5. `server/src/routes/fs-s4.test.ts`: Added negative regression tests for case collisions, 8.3 aliases, and Windows reserved names in `isValidFilePath`.

---

## 4. Verification & Regression Tests

- **Rust Filesystem Security Suite (`cargo test --test s4_fs_test`):** 4/4 tests passed:
  - `test_tree_entry_creation_rejects_forbidden_names` (rejects `.Itehaas`, `.ITEHAAS`, `itehaa~1`, `CON`, `..`)
  - `test_is_forbidden_component_blocks_case_and_aliases` (verifies all case combinations, aliases, and device names)
  - `test_checkout_dot_itehaas_blocked`
  - `test_checkout_symlink_parent_bail`
- **Server Filesystem Suite (`server/src/routes/fs-s4.test.ts`):** All tests passed:
  - Traversal (`../../etc/passwd`, encoded `%2e%2e`, double encoded `%252e%252e`) $\rightarrow$ rejected
  - Case-insensitive control structures (`.Itehaas`, `.ITEHAAS`, `.iTeHaAs`, `.Git`, `.GIT`) $\rightarrow$ rejected
  - 8.3 aliases (`itehaa~1`, `git~1`) $\rightarrow$ rejected
  - Windows reserved names (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`) $\rightarrow$ rejected
  - Trailing dots/spaces $\rightarrow$ rejected
  - Legitimate paths (`src/main.rs`, `README.md`, `.gitignore`) $\rightarrow$ accepted
- **Full Project Regression Suites:**
  - `cargo test`: 124/124 tests green.
  - `pnpm --filter server test`: 21 test files, 180/180 tests green.

---

## 5. Acceptance Criteria Checklist

- [x] Case-insensitive `.itehaas` / `.git` / `.hg` / `.svn` collisions blocked (SEC-013)
- [x] 8.3 short-filename collisions (`itehaa~*`, `git~*`) blocked
- [x] Windows reserved device names blocked
- [x] Trailing dots and spaces normalization blocked
- [x] Symlink containment verified
- [x] Zero functional regressions in existing tests
- [x] Vulnerability register updated
- [x] `PLAN.md` updated

---

## 6. Next Phase Gate

- **Active Phase Status:** S4 COMPLETE.
- **Next Phase:** `SECURITY PHASE S5 — PROCESS EXECUTION, SUBPROCESS ISOLATION, & RESOURCE DEFENSE`
- **Scope:** Audit and eliminate subprocess storms in `isAncestor` ([SEC-016](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-016--denial-of-service-via-subprocess-storm-in-fast-forward-ancestor-check)), strict binary path validation, parameter array invocation (no shell parsing), and execution timeout budgets.
