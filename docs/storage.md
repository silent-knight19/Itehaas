# Itehaas — Storage Specification

> Filesystem-based content-addressable storage. One repo = one hash algo.

## 1. Repository Layout

```
.itehaas/
├── HEAD              # "ref: refs/heads/main\n" (symbolic) or "<hash_hex>\n" (detached) — Phase 1 symbolic only
├── config            # INI: [core] hasher = sha256, repositoryformatversion = 1
├── index             # empty file, reserved for Phase 2 (staging area)
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

## 7. Future (Phase 10)

- `pack/` + delta, `fsck` full scan, `gc` reachability from `refs/*` + `HEAD`, streaming for large blobs, mmap for hot reads. Not in Phase 1.
