use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use std::fs;
use std::path::Path;

use crate::error::{ItehaasError, Result};
use crate::hash::{Hash, Hasher};
use crate::index::{Index, IndexEntry};
use crate::object::store;
use crate::tree_builder;

#[derive(Debug, Clone)]
pub struct MergeResult {
    pub conflicts: Vec<String>,
    pub staged: Vec<String>,
    pub fast_forward: bool,
    pub already_up_to_date: bool,
}

#[derive(Debug, Clone)]
pub struct MergeFileResult {
    pub path: String,
    pub conflict: bool,
    pub result_hash: Option<Hash>,
    pub result_mode: Option<u32>,
    pub conflict_content: Option<Vec<u8>>,
}

/// Find common ancestor (merge base) of two commits.
/// Returns None if no common ancestor (disjoint histories — treat as empty).
pub fn find_common_ancestor(repo: &Path, a: &Hash, b: &Hash) -> Result<Option<Hash>> {
    let algo = crate::config::read_hasher(repo)?;
    let hasher = crate::hash::new_hasher(algo)?;

    if a.hex() == b.hex() {
        return Ok(Some(a.clone()));
    }

    // Collect ancestors of a with distance
    let ancestors_a = collect_ancestors(repo, a, hasher.as_ref())?;
    // BFS from b until found in ancestors_a
    let mut visited = BTreeSet::new();
    let mut queue = VecDeque::new();
    queue.push_back(b.clone());
    visited.insert(b.hex());

    let mut best: Option<Hash> = None;

    while let Some(cur) = queue.pop_front() {
        if ancestors_a.contains_key(&cur.hex()) {
            best = Some(cur.clone());
            break;
        }
        let obj = store::read_object(repo, &cur, hasher.as_ref())?;
        let parents = match obj {
            crate::object::Object::Commit(c) => c.parents,
            _ => vec![],
        };
        for p in parents {
            if !visited.contains(&p.hex()) {
                visited.insert(p.hex());
                queue.push_back(p);
            }
        }
    }

    Ok(best)
}

fn collect_ancestors(repo: &Path, start: &Hash, hasher: &dyn Hasher) -> Result<HashMap<String, usize>> {
    let mut map = HashMap::new();
    let mut queue = VecDeque::new();
    queue.push_back((start.clone(), 0usize));
    let mut visited = BTreeSet::new();
    visited.insert(start.hex());

    while let Some((cur, depth)) = queue.pop_front() {
        map.insert(cur.hex(), depth);
        let obj = store::read_object(repo, &cur, hasher)?;
        let parents = match obj {
            crate::object::Object::Commit(c) => c.parents,
            _ => vec![],
        };
        for p in parents {
            if !visited.contains(&p.hex()) {
                visited.insert(p.hex());
                queue.push_back((p, depth + 1));
            }
        }
    }
    Ok(map)
}

pub fn is_ancestor(repo: &Path, ancestor: &Hash, descendant: &Hash) -> Result<bool> {
    if ancestor.hex() == descendant.hex() {
        return Ok(true);
    }
    let algo = crate::config::read_hasher(repo)?;
    let hasher = crate::hash::new_hasher(algo)?;
    let mut visited = BTreeSet::new();
    let mut queue = VecDeque::new();
    queue.push_back(descendant.clone());
    visited.insert(descendant.hex());

    while let Some(cur) = queue.pop_front() {
        let obj = store::read_object(repo, &cur, hasher.as_ref())?;
        let parents = match obj {
            crate::object::Object::Commit(c) => c.parents,
            _ => vec![],
        };
        for p in parents {
            if p.hex() == ancestor.hex() {
                return Ok(true);
            }
            if !visited.contains(&p.hex()) {
                visited.insert(p.hex());
                queue.push_back(p);
            }
        }
    }
    Ok(false)
}

/// Three-way merge for a single file path
pub fn merge_file(
    repo: &Path,
    path: &str,
    ancestor: Option<&(Hash, u32)>,
    current: Option<&(Hash, u32)>,
    feature: Option<&(Hash, u32)>,
    current_branch: &str,
    feature_branch: &str,
    hasher: &dyn Hasher,
) -> Result<MergeFileResult> {
    // Helper to compare optional entries
    let eq = |a: Option<&(Hash, u32)>, b: Option<&(Hash, u32)>| -> bool {
        match (a, b) {
            (None, None) => true,
            (Some((ah, am)), Some((bh, bm))) => ah.hex() == bh.hex() && am == bm,
            _ => false,
        }
    };

    // If current == feature, take current (no conflict)
    if eq(current, feature) {
        return Ok(MergeFileResult {
            path: path.to_string(),
            conflict: false,
            result_hash: current.map(|(h, _)| h.clone()),
            result_mode: current.map(|(_, m)| *m),
            conflict_content: None,
        });
    }
    // If current == ancestor, take feature
    if eq(current, ancestor) {
        return Ok(MergeFileResult {
            path: path.to_string(),
            conflict: false,
            result_hash: feature.map(|(h, _)| h.clone()),
            result_mode: feature.map(|(_, m)| *m),
            conflict_content: None,
        });
    }
    // If feature == ancestor, take current
    if eq(feature, ancestor) {
        return Ok(MergeFileResult {
            path: path.to_string(),
            conflict: false,
            result_hash: current.map(|(h, _)| h.clone()),
            result_mode: current.map(|(_, m)| *m),
            conflict_content: None,
        });
    }

    // Conflict
    // Need to generate conflict markers
    let current_content = if let Some((h, _)) = current {
        // Check binary?
        let data = crate::diff::get_blob_content(repo, h, hasher).unwrap_or_default();
        if crate::diff::is_binary(&data) {
            // Binary conflict — keep markers simple?
            // For binary, we can't merge; just report conflict with binary marker
            return Ok(MergeFileResult {
                path: path.to_string(),
                conflict: true,
                result_hash: None,
                result_mode: None,
                conflict_content: Some(format!("<<<<<<< HEAD\nBinary file {}\n=======\nBinary file {}\n>>>>>>> {}\n", path, path, feature_branch).into_bytes()),
            });
        }
        String::from_utf8_lossy(&data).to_string()
    } else {
        String::new()
    };

    let feature_content = if let Some((h, _)) = feature {
        let data = crate::diff::get_blob_content(repo, h, hasher).unwrap_or_default();
        if crate::diff::is_binary(&data) {
            return Ok(MergeFileResult {
                path: path.to_string(),
                conflict: true,
                result_hash: None,
                result_mode: None,
                conflict_content: Some(format!("<<<<<<< HEAD\nBinary file {}\n=======\nBinary file {}\n>>>>>>> {}\n", path, path, feature_branch).into_bytes()),
            });
        }
        String::from_utf8_lossy(&data).to_string()
    } else {
        String::new()
    };

    // If one side is deleted, show appropriate marker
    let conflict_text = if current.is_none() {
        // Deleted on current, modified on feature
        format!(
            "<<<<<<< HEAD\n=======\n{}>>>>>>> {}\n",
            feature_content, feature_branch
        )
    } else if feature.is_none() {
        format!(
            "<<<<<<< HEAD\n{}=======\n>>>>>>> {}\n",
            current_content, feature_branch
        )
    } else {
        format!(
            "<<<<<<< HEAD\n{}=======\n{}>>>>>>> {}\n",
            current_content, feature_content, feature_branch
        )
    };

    Ok(MergeFileResult {
        path: path.to_string(),
        conflict: true,
        result_hash: None,
        result_mode: None,
        conflict_content: Some(conflict_text.into_bytes()),
    })
}

/// Perform merge of feature branch into current branch
pub fn merge(
    repo: &Path,
    feature_branch: &str,
    feature_hash: &Hash,
    current_branch: &str,
    current_hash: &Hash,
) -> Result<MergeResult> {
    let algo = crate::config::read_hasher(repo)?;
    let hasher = crate::hash::new_hasher(algo)?;

    // Check if already ancestor
    if is_ancestor(repo, feature_hash, current_hash)? {
        return Ok(MergeResult {
            conflicts: vec![],
            staged: vec![],
            fast_forward: false,
            already_up_to_date: true,
        });
    }

    // Check fast-forward
    if is_ancestor(repo, current_hash, feature_hash)? {
        // Status check: ensure clean (like checkout) — do before any writes
        let st = crate::status::status(repo)?;
        if !st.staged.is_empty() || !st.not_staged.is_empty() {
            return Err(ItehaasError::Other(
                "working tree has modifications; commit or stash them before merge".into(),
            ));
        }
        // Fast-forward: update current branch ref to feature_hash and checkout
        crate::refs::write_ref(repo, &format!("refs/heads/{}", current_branch), feature_hash)?;
        // Update working tree and index to feature's tree
        let feature_commit = store::read_object(repo, feature_hash, hasher.as_ref())?;
        let feature_tree = match feature_commit {
            crate::object::Object::Commit(c) => c.tree,
            _ => return Err(ItehaasError::InvalidObject("feature is not commit".into())),
        };
        let feature_map = tree_builder::flatten_tree_root(repo, &feature_tree, hasher.as_ref())?;

        // Delete files not in feature, write those in feature
        let current_commit = store::read_object(repo, current_hash, hasher.as_ref())?;
        let current_tree = match current_commit {
            crate::object::Object::Commit(c) => c.tree,
            _ => return Err(ItehaasError::InvalidObject("current is not commit".into())),
        };
        let current_map = tree_builder::flatten_tree_root(repo, &current_tree, hasher.as_ref())?;

        for (path, _) in &current_map {
            if !feature_map.contains_key(path) {
                let abs = repo.join(path);
                if abs.exists() {
                    fs::remove_file(&abs)?;
                    // Clean empty dirs
                    if let Some(parent) = abs.parent() {
                        let mut cur = parent.to_path_buf();
                        while cur != *repo && cur.starts_with(repo) {
                            match fs::remove_dir(&cur) {
                                Ok(_) => {
                                    if let Some(p) = cur.parent() {
                                        cur = p.to_path_buf();
                                    } else {
                                        break;
                                    }
                                }
                                Err(_) => break,
                            }
                        }
                    }
                }
            }
        }
        for (path, (hash, mode)) in &feature_map {
            let abs = repo.join(path);
            if let Some(parent) = abs.parent() {
                fs::create_dir_all(parent)?;
            }
            let content = crate::diff::get_blob_content(repo, hash, hasher.as_ref())?;
            fs::write(&abs, &content)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let perm = if *mode == 0o100755 { 0o755 } else { 0o644 };
                let _ = fs::set_permissions(&abs, fs::Permissions::from_mode(perm));
            }
        }
        // Update index
        let mut index = Index::new();
        for (path, (hash, mode)) in feature_map {
            let entry = IndexEntry::new(path, hash, mode);
            index.add_or_update(entry);
        }
        index.save(repo)?;

        return Ok(MergeResult {
            conflicts: vec![],
            staged: vec![],
            fast_forward: true,
            already_up_to_date: false,
        });
    }

    // Find common ancestor
    let ancestor_opt = find_common_ancestor(repo, current_hash, feature_hash)?;
    let ancestor_map = if let Some(anc_hash) = ancestor_opt {
        let anc_commit = store::read_object(repo, &anc_hash, hasher.as_ref())?;
        let anc_tree = match anc_commit {
            crate::object::Object::Commit(c) => c.tree,
            _ => return Err(ItehaasError::InvalidObject("ancestor is not commit".into())),
        };
        tree_builder::flatten_tree_root(repo, &anc_tree, hasher.as_ref())?
    } else {
        BTreeMap::new() // no ancestor -> empty tree
    };

    let current_commit = store::read_object(repo, current_hash, hasher.as_ref())?;
    let current_tree = match current_commit {
        crate::object::Object::Commit(c) => c.tree,
        _ => return Err(ItehaasError::InvalidObject("current is not commit".into())),
    };
    let current_map = tree_builder::flatten_tree_root(repo, &current_tree, hasher.as_ref())?;

    let feature_commit = store::read_object(repo, feature_hash, hasher.as_ref())?;
    let feature_tree = match feature_commit {
        crate::object::Object::Commit(c) => c.tree,
        _ => return Err(ItehaasError::InvalidObject("feature is not commit".into())),
    };
    let feature_map = tree_builder::flatten_tree_root(repo, &feature_tree, hasher.as_ref())?;

    // Check clean status
    let st = crate::status::status(repo)?;
    if !st.staged.is_empty() || !st.not_staged.is_empty() {
        return Err(ItehaasError::Other(
            "working tree has modifications; commit or stash them before merge".into(),
        ));
    }

    // Union of all paths
    let mut all_paths = BTreeSet::new();
    for k in ancestor_map.keys() {
        all_paths.insert(k.clone());
    }
    for k in current_map.keys() {
        all_paths.insert(k.clone());
    }
    for k in feature_map.keys() {
        all_paths.insert(k.clone());
    }

    let mut conflicts = Vec::new();
    let mut staged = Vec::new();
    let mut index = Index::new();
    // We need to preserve index entries that are not part of merge? Actually index currently matches current HEAD.
    // For merge, we will rebuild index from merge results.
    // For non-conflicted, stage result; for conflicted, leave with markers and not staged.

    // Also need to handle deletion of files in working tree for non-conflicted deletions
    // First, collect current working tree files to know what to delete

    for path in all_paths {
        let anc = ancestor_map.get(&path);
        let cur = current_map.get(&path);
        let feat = feature_map.get(&path);

        let result = merge_file(
            repo,
            &path,
            anc,
            cur,
            feat,
            current_branch,
            feature_branch,
            hasher.as_ref(),
        )?;

        if result.conflict {
            conflicts.push(path.clone());
            // Write conflict markers to working tree
            let abs = repo.join(&path);
            if let Some(parent) = abs.parent() {
                fs::create_dir_all(parent)?;
            }
            if let Some(content) = result.conflict_content {
                fs::write(&abs, content)?;
            } else {
                // Should not happen
                fs::write(&abs, b"")?;
            }
            // Keep current version in index for conflicted (so status shows not_staged modified, not staged deleted)
            // This mimics Git's "unmerged" state where index has current version
            if let Some((hash, mode)) = current_map.get(&path).or_else(|| feature_map.get(&path)) {
                let entry = IndexEntry::new(path.clone(), hash.clone(), *mode);
                index.add_or_update(entry);
            }
            // Do not consider conflicted as staged; it will show as not_staged
        } else {
            // No conflict
            if let Some(hash) = result.result_hash {
                // File should exist
                let mode = result.result_mode.unwrap();
                // Write file to working tree (if not already)
                let abs = repo.join(&path);
                if let Some(parent) = abs.parent() {
                    fs::create_dir_all(parent)?;
                }
                // For non-conflicted, if result is from either side, we need to ensure file content matches result hash
                // The result hash is already from one side's blob; we can fetch its content
                // But if result is same as current, file already exists; we can just ensure it exists
                // To be safe, write file from blob
                let content = crate::diff::get_blob_content(repo, &hash, hasher.as_ref())?;
                fs::write(&abs, &content)?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let perm = if mode == 0o100755 { 0o755 } else { 0o644 };
                    let _ = fs::set_permissions(&abs, fs::Permissions::from_mode(perm));
                }
                let entry = IndexEntry::new(path.clone(), hash, mode);
                index.add_or_update(entry);
                staged.push(path.clone());
            } else {
                // Deleted
                let abs = repo.join(&path);
                if abs.exists() {
                    fs::remove_file(&abs)?;
                    if let Some(parent) = abs.parent() {
                        let mut cur = parent.to_path_buf();
                        while cur != *repo && cur.starts_with(repo) {
                            match fs::remove_dir(&cur) {
                                Ok(_) => {
                                    if let Some(p) = cur.parent() {
                                        cur = p.to_path_buf();
                                    } else {
                                        break;
                                    }
                                }
                                Err(_) => break,
                            }
                        }
                    }
                }
                // Do not add to index (deleted)
                staged.push(path.clone()); // for reporting, but not in index
            }
        }
    }

    // For non-conflicted paths that were deleted, we already handled.
    // For paths that were already staged (non-conflicted), index now contains merged result.
    // For conflicted, index does NOT contain them; we need to ensure index for non-conflicted is saved.
    // However, we built a new index from scratch with only merged non-conflicted entries.
    // But what about files that were unchanged and not in all_paths? They are in current_map and target_map and ancestorMap same, they will be in staged? Actually our loop covers all_paths, and for unchanged files, merge_file will return result_hash = current (since current == feature), so they will be added to index.
    // So new index is complete.

    if conflicts.is_empty() {
        // No conflicts: create merge commit directly
        // Build tree from index
        let entries: Vec<_> = index.entries_sorted();
        // Need to pass references to build_tree
        let refs_entries: Vec<&IndexEntry> = entries.into_iter().collect();
        // But index.entries_sorted returns Vec<&IndexEntry> already? Actually it returns Vec<&IndexEntry>
        // Let's handle: entries is Vec<&IndexEntry>
        // We already have index, but we need to build tree from it
        let algo2 = crate::config::read_hasher(repo)?;
        let hasher2 = crate::hash::new_hasher(algo2)?;
        // Need to collect IndexEntry refs
        let idx_entries = index.entries_sorted();
        let tree_hash = crate::tree_builder::build_tree_from_index(repo, &idx_entries, hasher2.as_ref())?;
        // Create merge commit
        let sig = {
            let (name_opt, email_opt) = crate::config::read_user(repo)?;
            let name = name_opt.unwrap_or_else(|| "Author".to_string());
            let email = email_opt.unwrap_or_else(|| "author@example.com".to_string());
            let ts = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64;
            crate::object::Signature::new(name, email, ts, "+0000".to_string())?
        };
        let commit = crate::object::Commit::new(
            tree_hash,
            vec![current_hash.clone(), feature_hash.clone()],
            sig.clone(),
            sig,
            format!("Merge branch '{}' into {}", feature_branch, current_branch),
        );
        let obj = crate::object::Object::Commit(commit);
        let commit_hash = store::write_object(repo, &obj, hasher2.as_ref())?;
        // Update current branch
        crate::refs::write_ref(repo, &format!("refs/heads/{}", current_branch), &commit_hash)?;
        // Update index already saved, but we need to save it
        index.save(repo)?;
        // Also ensure HEAD points correctly (it already does)
        return Ok(MergeResult {
            conflicts: vec![],
            staged: staged,
            fast_forward: false,
            already_up_to_date: false,
        });
    } else {
        // Conflicts: save index for non-conflicted staged, and create MERGE_HEAD
        index.save(repo)?;
        // Write MERGE_HEAD
        fs::write(repo.join(".itehaas").join("MERGE_HEAD"), format!("{}\n", feature_hash.hex()))?;
        fs::write(
            repo.join(".itehaas").join("MERGE_MSG"),
            format!("Merge branch '{}' into {}\n", feature_branch, current_branch),
        )?;
        // Also save feature branch name for conflict markers? Already used
        fs::write(
            repo.join(".itehaas").join("MERGE_BRANCH"),
            feature_branch,
        )?;
        return Ok(MergeResult {
            conflicts,
            staged,
            fast_forward: false,
            already_up_to_date: false,
        });
    }
}
