# Itehaas — Branching and Merging (Phase 3)

> Branches are pointers to commits; checkout moves HEAD and working tree.

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

## Future

Phase 4 will add diff, three-way merge, fast-forward detection, conflict markers using common ancestors.
