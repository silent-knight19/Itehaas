# Itehaas — Branching and Merging (Phase 3 & 4)

> Branches are pointers to commits; checkout moves HEAD and working tree; merge reconciles histories.

## References

- `refs/heads/<name>` stores commit hash hex (`vcs/src/refs.rs:92`). `list_branches` walks `refs/heads` via `walkdir`, `validate_branch_name` rejects `..`, spaces, `~^:?*[\` etc., hierarchical `feature/sub` allowed.
- `HEAD` is `ref: refs/heads/<branch>` (symbolic), hash hex (detached), or unborn `ref: refs/heads/<branch>` where file missing. `read_head`/`write_head_*` atomic via tempfile.

## Branch

- `itehaas branch` — list, `*` current, `(HEAD detached at <hash>)` note.
- `itehaas branch <name> [<start-point>]` — create at `HEAD` or start_point (branch/hash/HEAD via `resolve_rev`), validates, fails if exists, checks start_point is commit.
- `itehaas branch -d/-D <name>` — delete, fails if current branch or not found.

## Checkout

- `itehaas checkout <branch|hash|HEAD>` — switch. Branch → symbolic HEAD, hash → detached. Resolves via `read_ref` then hash check then `resolve_rev`.
- `itehaas checkout -b <new-branch> [<start-point>]` — create at start_point (default HEAD) then checkout. Fails if exists, start_point must be commit.
- `itehaas switch <branch>` and `switch -c <new-branch> [<start-point>]` — aliases.
- `-f/--force` bypasses dirty working tree check.

## Working Tree Sync

`vcs/src/checkout.rs:1` — `checkout(repo, target_hash, detached, branch_name)`:

1. Flatten target and current HEAD trees via `tree_builder::flatten_tree_root`.
2. Status clean check: `staged`/`not_staged` must be empty unless `--force`; untracked allowed.
3. Delete files in `current_map` not in `target_map` (remove_file + try `remove_dir` empty parents).
4. Write `target_map` files: `store::read_object` blob → `fs::write`, `chmod` exec, `create_dir_all`.
5. Rebuild `index` from `target_map` (mode preserved) and `save`.
6. Update `HEAD`.

Index after checkout matches target tree, not previous. Nested `dir/sub/file.txt` handled via parent dir cleanup.

## DAG

History is DAG: commits have 0..N parents. `log` walks first-parent chain from `HEAD`; `branch` histories share base but diverge. `status` shows `On branch <name>` or `HEAD detached`. `log` per branch shows independent histories (tested in `phase3_tests.rs:80` with `base → feature` vs `base → main`).

## Diff — Phase 4

`vcs/src/diff.rs:1` — `diff_maps` (old vs new BTreeMap), `is_binary`, `unified_diff` via `similar` crate, `get_blob_content`:

- `diff_working_vs_index` (unstaged): wt map (walkdir hash) vs index.
- `diff_index_vs_head` (staged, `--staged`/`--cached`): index vs HEAD tree.
- `diff_head_vs_commit` (target branch): HEAD vs target commit tree.
- CLI `itehaas diff` (wt vs index), `itehaas diff --staged`, `itehaas diff <branch>` — prints `added/deleted/modified` + unified `diff --itehaas a/... b/...` with `---`/`+++` and `@@`, binary files as `Binary files differ`.

## Merge — Phase 4

`vcs/src/merge.rs:1` — implements Git-like three-way merge:

- **Common ancestor**: `find_common_ancestor` BFS ancestors of `a` + BFS from `b` until intersection; `is_ancestor` BFS.
- **Fast-forward**: if `current` is ancestor of `feature`, update `refs/heads/<current>` to `feature` hash and checkout working tree/index (like `checkout`); fails if dirty unless `-f`.
- **Already up-to-date**: if `feature` is ancestor of `current`, print `Already up to date.`
- **Three-way**: `O` (ancestor), `A` (current), `B` (feature) flattened maps. Union of paths. For each path, `merge_file` logic:

```
if A==B => take A
else if A==O => take B
else if B==O => take A
else conflict
```

`eq` is `None==None` or `Some(hash==hash && mode==mode)`. Added/deleted handled as `None`.

- **Non-conflicted**: staged (add to new `Index`, write file, delete if `None`), then if `conflicts.is_empty()` build tree via `tree_builder`, create merge commit with `parents=[current, feature]`, message `Merge branch 'feature' into <current>`, update current branch ref.

- **Conflict**: `merge_file` generates `<<<<<<< HEAD\n<current>\n=======\n<feature>\n>>>>>>> <feature>` (or binary marker), writes to working tree, keeps `current` version in index (so `status` shows `not_staged modified`), collects `conflicts`, writes `.itehaas/MERGE_HEAD`/`MERGE_MSG`/`MERGE_BRANCH`, does not create commit. User must resolve (`edit` → `add` → `commit`). `commit` detects `MERGE_HEAD` and creates 2-parent commit, cleans `MERGE_*`.

- **Status/dirty**: merge requires clean `staged`/`not_staged` (untracked allowed) like checkout.

Tested in `phase4_tests.rs:1` — `fast_forward`, `already_up_to_date`, `3-way no conflict` (different files), `conflict` (both modified), `merge_file` logic, `diff` variants, `is_ancestor`/`common_ancestor`. Manual verified: fast-forward, 3-way, conflict with markers, diff --staged, diff target, resolve.

## Future

Phase 5 will add remotes (`remote`, `clone`, `fetch`, `push`, `pull`) with own HTTP protocol.
