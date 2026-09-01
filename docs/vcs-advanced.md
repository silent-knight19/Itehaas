# Itehaas — Advanced VCS (Phase 10)

> Packfiles, GC, fsck, Git interop, benchmarks.

## Packfiles (`vcs/src/pack.rs:1`)

- Format `ITEHAAS PACK v1\n` + `u32 count BE` + entries `hash_hex(64) + u32 len BE + zlib_bytes`. Deterministic sorted by hash.
- `itehaas pack` (`vcs/src/main.rs:520` `cmd_pack`) collects loose objects `objects/*/*`, writes `objects/pack/pack-<timestamp>-<count>.pack`, prints `orig -> packed bytes + %`, verifies via `verify_pack`.
- Delta compression placeholder: currently stores full zlib bytes; future: use `similar` xdelta. Pack verifies by decompressing + re-hashing (`pack.rs:85`).
- List `itehaas count-objects` + `pack::list_packs` (`vcs/src/fsck.rs:149`).

```
cargo test --test phase10_tests test_pack_create_verify // ok
./itehaas pack // 3 objects 220 -> 444 bytes
```

## GC (`vcs/src/gc.rs:1`)

- Reachability: `remote::collect_reachable_objects` BFS from all `refs/*` + `HEAD` (`gc.rs:12`). Uses `HashSet` dedup.
- `itehaas gc` counts unreachable, `itehaas gc --prune` deletes loose files not in reachable + empty fanout dirs. Returns pruned count.
- `list_unreachable` helper for `fsck`.

```
printf unreachable | itehaas hash-object -w --stdin // unreachable
itehaas gc // found 1
itehaas gc --prune // pruned 1
```

Test `phase10_tests::test_gc_unreachable` ok.

## Fsck (`vcs/src/fsck.rs:1`)

- `itehaas fsck` scans `objects/*/*`, `Hash::from_hex` + `store::verify_object` (`vcs/src/fsck.rs:30` `hasher.hash(decompressed)`), collects `corrupted`, `missing_refs` (refs pointing to missing objects, HEAD detached), `unreachable` (total - reachable).
- `itehaas count-objects` (`vcs/src/main.rs:540`) prints `count loose, packs`.

```
itehaas fsck // checked 3, ok
corrupt byte flip → fsck reports corrupt deflate stream
```

Test `test_fsck_ok` ok.

## Git Interop (deferred, Phase 10 advanced)

- Hash abstraction trait already supports `Sha1` variant (`vcs/src/hash.rs:90` `UnsupportedAlgo`), tree raw length algo-dependent (`vcs/src/object/tree.rs:54` 32B for SHA256, 20B for SHA1). Git compat requires adapting tree raw + testing `git mktree` vectors — not claimed until then (see `docs/object-model.md:114`).

## Benchmarks

- No premature optimization; conservative `flate2` level 6, `pg` pool 10. Vivobook benchmarks deferred to `Phase 10` after pack/GC measured. Placeholder: `cargo test` 65 tests, `pack` 201% (no delta) indicates delta needed for true reduction — documented for future.
- Bounded concurrency (4 workers on 3500U) already at `docs/architecture.md:17`.

## CLI Summary

```
itehaas fsck
itehaas gc [--prune]
itehaas pack
itehaas count-objects
itehaas verify <hash>
```

All verified in `vcs/tests/phase10_tests.rs:1` (4 tests).
