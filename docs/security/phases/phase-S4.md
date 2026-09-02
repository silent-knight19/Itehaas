# Security Phase S4 — Filesystem / Path / Symlink Security

**Status:** ✅ Complete (2026-09-02)
**Date:** 2026-09-02
**Owner:** Principal Security Engineer
**Depends:** S0 ✅ + S1 ✅ + S2 ✅ + S3 ✅ (authZ done)
**Implemented:** `server/src/lib/vcs.ts:21` `server/src/routes/repos.ts:12` `vcs/src/checkout.rs:13` `server/src/routes/ci.ts:192` + `fs-s4.test.ts` 10 + `s4_fs_test.rs` 2

---

## 1. Objective

Harden **only filesystem** — repoRoot containment, path traversal, symlink escape, TOCTOU, temporary paths. No auth, no process env, no CORS.

Per operator: `canonical path design → repository-root containment → symlink policy → path tests → remediation → regression tests → STOP`

---

## 2. Scope

**In scope:**
- `server/src/lib/vcs.ts:21` `validateRepoPath` + `repoPathFor`
- `server/src/routes/repos.ts:951` `GET /file/*`, `1020` `GET /history/*`, `1040` `GET /blame/*`, `1010` `GET /tree/:hash` (hash already validated)
- `vcs/src/checkout.rs:80` `repo.join(path)` + `create_dir_all` + `write`
- `vcs/src/object/store.rs:147` `object_path` fanout
- `server/src/routes/ci.ts:192` `collectArtifacts` `readdirSync` symlink
- Repository creation `POST /api/repos` `fs.promises.mkdir` + `execItehaas init`
- Repository deletion `DELETE /api/repos` `fs.promises.rm`
- Temporary files `object/store.rs:44` `tempfile::NamedTempFile`

**Out of scope (other phases):**
- S5 process (`spawn` env), S6 parser, S11 CORS, S9 secrets — deferred

---

## 3. Threats (FS-specific)

| # | Threat | Precond | Impact |
|---|--------|---------|--------|
| F1 | `owner=..` traversal via `repoPathFor` | `owner` regex `^[a-zA-Z0-9._-]` blocks `..` exact, but `file/*` wildcard `*` is raw string `../../etc/passwd` not validated | Read outside repo via tree walk? Currently tree walk via `cat-file` not FS, but `refPath = path.join(repoPath, '.itehaas', 'refs', 'heads', ...branch.split('/'))` where `branch` from query `ref` is used directly `branch.split('/')` without validation → `branch=../../etc` could escape? Actually `ref` from `req.query.ref` is branch name, validated only via `isValidBranch?` Not yet. |
| F2 | Encoded traversal `/%2e%2e/%2f` double-encoded `/%252e%252e/` absolute `/etc/passwd` backslashes `..\` Unicode normalization, null bytes `%00` | Fastify may decode once, but double-encode bypasses simple `includes('..')` |  |
| F3 | Symlink escape via checkout: repo contains `link → /etc` then checkout writes `link/passwd` via `repo.join("link/passwd")` + `create_dir_all("link")` follows symlink to `/etc` | attacker controls tree entry `link/passwd`? But `TreeEntry.name` cannot contain `/`, so `link` is dir entry `040000` pointing to subtree hash, not symlink. However working-tree symlink `artifacts → /etc` created as file not via object, then `collectArtifacts` follows. Also checkout parent `sub/evil` where `sub/evil` is symlink to `/etc` created via `mkdir -p sub && ln -s /etc sub/evil` **outside** VCS, then checkout target contains `sub/evil/passwd` → `create_dir_all("sub/evil")` follows. |
| F4 | TOCTOU `validateRepoPath → use`: `validateRepoPath(p)` checks `startsWith(root+sep)` then `fs.promises.mkdir(path.dirname(p))` then `execItehaas init` — between validate and use, attacker races `rm -rf` and symlink replacement |  |
| F5 | Object path `objects/ab/cdef` fanout: hash `ab` + `cdef` validated hex, but `path.resolve(objectPath)` not checked after `path.join` — though `validateRepoPath` already checks `repoPath`, but `hash` itself could be `../` if not validated? Already `HASH_REGEX` blocks. |
| F6 | Archive/download path? Not yet, but `file/*` already covers. |
| F7 | Temporary file `tempfile::NamedTempFile::new_in(dir)` is safe (same dir, atomic), but `fs::write` via `repo.join` not. |

---

## 4. Affected Components

| File:line | Current | Risk |
|-----------|---------|------|
| `server/src/lib/vcs.ts:21` | `path.resolve(root).startsWith(root+sep)` + `includes('\0')` | F1/F4: no `realpath`, no `lstat`, encoded not decoded |
| `server/src/routes/repos.ts:951` `file/*` | `if(!filePath)400` only | F1/F2: no `..`, `/`, `\`, `\0` check, no absolute, no traversal |
| `server/src/routes/repos.ts:972` `refPath = path.join(repoPath, '.itehaas', 'refs', 'heads', ...branch.split('/'))` | `branch` from query `ref` raw, `branch.split('/')` | F1: `branch=../../etc/passwd` → `refPath` outside? But `readFileSync` would then read outside |
| `vcs/src/checkout.rs:80` `repo.join(path)` + `create_dir_all` | no `symlink_metadata`, no canonical check | F3 |
| `vcs/src/object/store.rs:147` `object_path` | `hex.split_at(2)` → `join(dir,file)` | F5 (already mitigated by hash regex) |
| `server/src/routes/ci.ts:192` `fs.readdirSync(dir)` `fs.statSync(full)` | `stat` follows symlink | F3 |

---

## 5. Current Controls (what is already good)

- `repoPathFor` regex `^[a-zA-Z0-9._-]{1,100}$` blocks `..` exact and `/` for `owner/repo` (good)
- `validateRepoPath` `startsWith(root+sep)` blocks absolute traversal via `path.resolve` (good but not canonical)
- `HASH_REGEX` `^(?:[0-9a-f]{40}|[0-9a-f]{64})$` blocks hash traversal
- `ref` branch name in `POST /refs/heads/*` validated strict `..` `//` `.lock` etc `repos.ts:648` (good, but `GET /file?ref=` not validated)
- `object/store.rs` fanout `2/62` from hex only, atomic `tempfile→persist` (good)
- `TreeEntry` `mode` `100644/100755/040000` only, `name` no `/` `\0` (good)
- `branch` in `POST /refs` validated strict (good)

---

## 6. Weaknesses → SEC

| Gap | SEC | Detail |
|-----|-----|--------|
| `validateRepoPath` no `realpath` / `lstat` | SEC-012 | `startsWith` bypass via symlink `data/repos/alice/repo` is symlink to `/etc`? Actually `repoPathFor` creates `path.join(resolve(root), owner, repo)` which is inside root, but if `data/repos/alice` is symlink to `/tmp`, then `resolve` gives `/tmp/repo` not inside root, but `startsWith` would fail? But not checked via `realpath`. |
| `file/*` raw | SEC-012 | no `..`/`/` absolute check |
| `refPath` from `branch` query raw | SEC-012 | `branch.split('/')` without validation |
| `checkout` `repo.join` no symlink check | SEC-013 | `create_dir_all` follows |
| `collectArtifacts` `stat` follows | SEC-013 | `lstat` needed |

---

## 7. Planned Remediation (S4 only, no S5+)

| # | Change | File:line Before → After | Why | Test |
|---|--------|---------------------------|-----|------|
| S4-01 | **Canonical `validateRepoPath`** | `server/src/lib/vcs.ts:21` `path.resolve` + `startsWith` → `fs.realpathSync` if exists + `lstatSync` parent chain + `!symlink` + `startsWith` after `realpath` | SEC-012 CWE-22/59 | `vcs.test.ts` `repoPathFor` `..` → throw, symlink parent → throw |
| S4-02 | **Validate `file/*`, `history/*`, `blame/*` + `ref` query** | `server/src/routes/repos.ts:951` add `if(filePath.includes('\0')\|\|filePath.includes('\\')\|\|path.isAbsolute(filePath)\|\|filePath.split('/').includes('..')\|\|filePath.split('/').some(p=>p.startsWith('.'))\|\|filePath.length>500)400` + decode `decodeURIComponent` safely + same for `branch` `ref` param validate via `refs::validate_branch_name` regex | SEC-012 CWE-22 | `authz` test `GET /file/../../etc/passwd →400` `GET /file/%2e%2e/%2fetc/passwd →400` `GET /file?ref=../../etc →400` |
| S4-03 | **Checkout containment** | `vcs/src/checkout.rs:80` `repo.join(path)` → helper `let abs = repo.join(path); let canon = abs.canonicalize().unwrap_or(abs.clone()); if(!canon.starts_with(repo.canonicalize().unwrap())) bail;` + before `create_dir_all` check `symlink_metadata(parent)` is not symlink | SEC-013 CWE-59 | `checkout` corpus `repo with symlink` → no write outside |
| S4-04 | **Checkout parent symlink refuse** | `vcs/src/checkout.rs:83` `create_dir_all(parent)` → `for anc in parent.ancestors() { if anc==repo break; if fs::symlink_metadata(anc).is_ok_and(|m| m.file_type().is_symlink()) { bail } }` then `create_dir_all` | SEC-013 | same |
| S4-05 | **Object path guard** (defense in depth) | `vcs/src/object/store.rs:147` already safe, add `debug_assert!(hex.chars().all(|c| c.is_ascii_hexdigit()))` | SEC-012 | — |
| S4-06 | **CI artifact `lstat`** | `server/src/routes/ci.ts:192` `fs.statSync` → `fs.lstatSync` + `if(isSymbolicLink()) continue` | SEC-013 | `artifacts → /etc` → 0 artifacts |

**Explicitly NOT in S4:** CORS, authZ, process env, parser bomb — deferred.

---

## 8. Test Strategy

| Test | Location | What it proves |
|------|----------|----------------|
| `vcs.test.ts` `validateRepoPath` | `server/src/lib/vcs.test.ts` | `repoPathFor('..','repo')` throws, `repoPathFor('alice','..')` throws |
| `file traversal` | `server/src/routes/authz-s3.test.ts` or new `server/src/routes/fs-s4.test.ts` | `GET /file/../../etc/passwd` →400, `GET /file/%2e%2e%2fpasswd` →400, `GET /file?ref=../../etc` →400 |
| `checkout symlink` | `vcs/tests/symlink_test.rs` (new) or `cargo test` | Repo with `mkdir sub && ln -s /tmp sub/evil` + checkout file `sub/evil/p` → `is_symlink` bail, no write to `/tmp/p` |
| `collectArtifacts lstat` | `server/src/routes/ci.test.ts` (new) | `artifacts → /etc` → 0 artifacts |
| Manual | `curl` | `curl /file/%252e%252e%2fetc/passwd` →400 |

Full suite after S4: `pnpm --filter server test` + `cargo test` 122.

---

## 9. Acceptance Criteria (S4)

- [ ] `validateRepoPath` canonical + `lstat` symlink refuse
- [ ] `file/*` `history/*` `blame/*` `ref` query validated `..` absolute `\` `\0` length
- [ ] `checkout` `repo.join` containment via `canonical` + parent symlink check
- [ ] `collectArtifacts` `lstat` not `stat`
- [ ] Traversal `../` `/%2e%2e/` `//` `\\` →400, symlink checkout → no outside write
- [ ] `pnpm test` green + `cargo test` green
- [ ] `vulnerability-register.md` SEC-012/013 partially fixed, `CYBERSECURITY_IMPLEMENTATION.md` S4 ✅, `PLAN.md` S4 ✅

---

## 10. Rollback Considerations

- Canonical `realpath` requires `fs` sync which may throw if path not exists yet (repo not yet created). Rollback to `path.resolve` if `realpath` fails for non-existent path, but keep `lstat` for existing parents.
- Strict `filePath` validation may break legitimate files with `.` prefix (dotfiles) — currently we reject `p.startsWith('.')` per `validate_branch_name` style, but dotfiles like `.env` are not typical in repo browsing. If needed, allow `.` but not `..`.
- Checkout symlink bail may break repos that legitimately contain symlink entries (currently not supported anyway, mode 120000 rejected) — so safe.

---

## 11. Completion Verification (2026-09-02)

- `pnpm --filter server test` 59/59 (32+7+10+10) green, `cargo test` 124 (122+2) green, `pnpm build` ok
- `isValidFilePath('..')` `../../etc` `%2e%2e` `%252e` `//` `\` `.itehaas` `?ref=..` →400, valid `a/b/c.txt` → not 400
- `s4_fs_test.rs` `test_checkout_symlink_parent_bail` → `symlink` error, no `/tmp/p.txt` escape
- `collectArtifacts` `lstat` skips symlink, size 10M, `rel` not `..`
- No process/SSRF edits — S4 scope respected

---

## 11. Next Phase

**S5 — Command / Process Execution** — after S4 STOP. Do not touch `spawn` env in S4.

**STOP per §8 — S4 Complete. Awaiting S5 approval.**
