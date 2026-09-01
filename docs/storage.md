# Itehaas — Storage Specification

> Filesystem-based content-addressable storage. One repo = one hash algo.

## 1. Repository Layout

```
.itehaas/
├── HEAD              # "ref: refs/heads/main\n" (symbolic) or "<hash_hex>\n" (detached)
├── config            # INI: [core] hasher = sha256, [user] name/email, repositoryformatversion = 1
├── index             # JSON staging area: {version:1, entries:{path:{path,hash,mode}}}
├── objects/
│   ├── ab/
│   │   └── cdef...   # first 2 hex chars = dir, rest = filename (SHA-256: 2+62)
│   └── pack/         # empty, reserved for Phase 10 (packfiles)
└── refs/
    ├── heads/        # one file per branch, contains hash hex
    ├── tags/         # annotated tags
    └── remotes/      # e.g., remotes/origin/main (Phase 5)
```

- All paths are within `.itehaas/`; no traversal outside.
- Fanout directory always 2 hex chars regardless of hash length (SHA-256: `2+62`, SHA-1 future: `2+38`).
- `objects/pack` is empty until Phase 10.

## 2. Hash Algorithm Invariant (Storage)

- At `itehaas init`, `[core] hasher` is written atomically (default `sha256`).
- Every `write_object`/`read_object` validates `hash.len() == hasher.hash_len()`; mismatch → `Error::HashAlgoMismatch`.
- No object with a foreign algorithm may exist in the repository. Tools must reject mixed-algo writes.

## 3. Object Storage Pipeline

```
Object → canonical_body (per object-model.md) → header = "<type> <len>" → hash_input = header + "\0" + body
ObjectID = H(hash_input)            # raw bytes
Stored bytes = zlib(hash_input)     # compressed, what hits disk
Path = objects/ab/cdef...           # hex(ObjectID) split
```

- Hashing on **uncompressed** canonical bytes only.
- Compression: `flate2` zlib, default level 6 (Phase 1; tunable later via config if Vivobook needs level 3).
- Write is atomic: write to `objects/tmp_<rand>` then `rename` to final fanout path. `create_dir_all` for fanout. If file exists, deduplication — no error, no overwrite.
- Size limit: >64 MiB object → reject Phase 1 (`ObjectTooLarge`) to avoid OOM/CPU spikes.

## 4. Read & Verification

On `read_object(hash)` / `verify(hash)`:

1. Validate `hash` hex regex for repo's algo.
2. Resolve path `objects/ab/cdef...`, read file, `zlib` decompress.
3. Split at first `\0` → `header`, `body`.
4. Parse header as `"<type> <len_decimal>"` (`type ∈ {blob,tree,commit,tag}`, `len` decimal).
5. Check `body.len() == len` → else `CorruptObject`.
6. Recompute `H(header+"\0"+body)` → compare to requested `hash` → mismatch → `CorruptObject`/`HashMismatch`.
7. Validate `type` matches expected caller type (if given) and body is parseable.
8. Return `Object` or `bool`.

Corruption cases tested: truncated zlib, bad header, len mismatch, hash mismatch, flipped byte.

## 5. NVMe / HDD Tiering (Vivobook Target)

- **NVMe 512GB (`/`, `/data/repos`)**: active `.itehaas/objects`, `PostgreSQL` data/WAL, hot repos. Random I/O, fsync critical path.
- **HDD 1TB (`/data-hdd`)**: `pg_basebackup`, WAL archive, cold pack archives, runner caches, backups. Never for hot object reads or PG WAL.

This tiering is policy, not code invariant — enforced via deployment docs, not store logic.

## 6. Concurrency & Safety

- No locking in Phase 1 (single process). Future: `O_EXCL` temp + rename is atomic on ext4; readers never see torn writes.
- Readers handle concurrent writer via existence check after `rename`.
- Phase 1: `Tokio` not needed; sync `std::fs` throughout.

## 7. Index (Staging Area) — Phase 2

- File `.itehaas/index` is JSON (pretty-printed, `serde_json`), versioned (`version:1`), `BTreeMap` sorted by path. Each entry: `{path: "<unix>/path", hash: "<hex>", mode: 33188}` (mode `0o100644` regular, `0o100755` executable).
- Load: if missing or empty → empty index. Save atomic via tempfile+rename. Sorted iteration ensures deterministic `tree_builder` input.
- `file_mode()` on Unix uses `permissions().mode() & 0o111`, otherwise `0o100644`.
- `should_ignore()` skips `.itehaas` and `.git` at any depth.
- Workflow: `Working Tree → add → Index → commit → Objects`. `add <file>` hashes blob, writes object, updates index; `add .` stages all including deletions (removes missing from index); `add <dir>` recurses via `walkdir`.
- `status` compares three maps: `HEAD tree` (flattened via `tree_builder::flatten_tree_root`), `index`, `working tree` (walk + hash). Reports `staged` (index vs HEAD), `not_staged` (wt vs index, hash+mode), `untracked` (wt not in index nor HEAD).
- `tree_builder::build_tree_from_index` groups index entries by directory, recursively builds `Tree` objects (sorted, `mode 040000` for dirs), writes each tree, returns root hash. Empty index → empty tree `6ef19b...` (`tree 0\0`).
- `commit` builds tree from index, checks `nothing to commit` (no staged and tree == HEAD unless initial), creates `Commit` with parent `HEAD` (or none), author/committer from `config [user]` or `Author <author@example.com>`, timestamp `SystemTime` + `+0000`, writes commit, updates `refs/heads/<branch>` (from `HEAD` symbolic) or detached `HEAD`.
- `refs`: `HEAD` symbolic `ref: refs/heads/main` or detached hash or unborn; `read_head`/`write_head`/`read_ref`/`write_ref`/`resolve_head` all atomic.
- `log` walks first-parent chain from `HEAD`, prints `commit hash`, `Author`, `Date`, message, supports `--oneline` and `--max-count`.

## 8. Remotes — Phase 5

- Config `[remote "origin"] url = <path>` (filesystem path for Phase 5, `http` deferred). `config::add_remote`/`remove_remote`/`list_remotes`/`get_remote_url` parse INI sections `[remote "name"]`.
- `remote.rs`: `resolve_remote_path` (handles `file://`, relative, `.itehaas` suffix, canonicalize, `http` error), `collect_reachable_objects` (commit→tree→blob→parents BFS, `HashSet` dedup), `transfer_objects` (collect reachable from `start_hash` via `write_object` hasher, copy missing `objects/ab/cdef` via `fs::copy`, algo mismatch check), `transfer_all_heads`, `list_remote_refs` (walk `refs/heads/*`).
- `refs/remotes/<remote>/<branch>` stores fetched hash, not `refs/heads`. `fetch` transfers reachable from each remote `refs/heads/*` and updates `refs/remotes/<remote>/*`; does not touch working tree/index/`HEAD`.
- `push` transfers reachable from local `refs/heads/<branch>` to remote, checks fast-forward via `merge::is_ancestor` (local repo, `NotFound→false`), rejects non-ff unless `--force`, then `write_ref` on remote.
- `pull` = `fetch` + `merge` (`merge` with `refs/remotes/<remote>/<branch>` as feature, fast-forward or 3-way, `MERGE_HEAD` handling).
- `clone <url> [<path>]`: `init` dest with remote's hasher, `add_remote` origin, `transfer_objects` for each remote head, `refs/remotes/origin/*` + `refs/heads/*` for HEAD branch, `checkout_branch_forced` (bypass dirty, since index empty vs HEAD with file).
- Object reachability + `is_ancestor` (BFS, `NotFound→false`) ensures only missing objects copied, bounded concurrency (single process, `fs::copy`).

## 9. Future (Phase 10)

- `pack/` + delta, `fsck` full scan, `gc` reachability from `refs/*` + `HEAD`, streaming for large blobs, mmap for hot reads. Not in Phase 1-5.
