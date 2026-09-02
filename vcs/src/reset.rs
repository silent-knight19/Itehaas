use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use crate::error::{ItehaasError, Result};
use crate::hash::Hash;
use crate::index::Index;
use crate::tree_builder;

pub fn resolve_commit(repo: &Path, rev: &str) -> Result<Hash> {
    let h = crate::refs::resolve_rev(repo, rev)?.ok_or_else(|| {
        ItehaasError::Other(format!("failed to resolve '{}'", rev))
    })?;
    // Verify is commit
    let algo = crate::config::read_hasher(repo)?;
    let hasher = crate::hash::new_hasher(algo)?;
    let obj = crate::object::store::read_object(repo, &h, hasher.as_ref())?;
    match obj {
        crate::object::Object::Commit(_) => Ok(h),
        _ => Err(ItehaasError::Other(format!("object '{}' is not a commit", rev))),
    }
}

/// Move HEAD (branch or detached) to target, log reflog.
fn move_head_to(repo: &Path, target: &Hash, msg: &str) -> Result<()> {
    let head = crate::refs::read_head(repo)?;
    match head {
        crate::refs::Head::Ref(r) | crate::refs::Head::Unborn(r) => {
            // Move branch ref
            crate::refs::write_ref_with_log(repo, &r, target, msg)?;
        }
        crate::refs::Head::Detached(old) => {
            crate::refs::write_head_detached_with_log(repo, target, msg)?;
            // also log detached move? already done
            let _ = old;
        }
    }
    Ok(())
}

pub fn reset_soft(repo: &Path, target: &Hash, message: &str) -> Result<()> {
    move_head_to(repo, target, message)
}

pub fn reset_mixed(repo: &Path, target: &Hash, message: &str) -> Result<()> {
    move_head_to(repo, target, message)?;
    // Reset index to target tree
    let algo = crate::config::read_hasher(repo)?;
    let hasher = crate::hash::new_hasher(algo)?;
    let obj = crate::object::store::read_object(repo, target, hasher.as_ref())?;
    let tree_hash = match obj {
        crate::object::Object::Commit(c) => c.tree,
        _ => return Err(ItehaasError::InvalidObject("target is not commit".into())),
    };
    let map = tree_builder::flatten_tree_root(repo, &tree_hash, hasher.as_ref())?;
    let mut index = Index::new();
    for (path, (hash, mode)) in map {
        let entry = crate::index::IndexEntry::new(path, hash, mode);
        index.add_or_update(entry);
    }
    index.save(repo)?;
    Ok(())
}

pub fn reset_hard(repo: &Path, target: &Hash, message: &str) -> Result<()> {
    move_head_to(repo, target, message)?;
    // Reset index + working tree
    let algo = crate::config::read_hasher(repo)?;
    let hasher = crate::hash::new_hasher(algo)?;
    let obj = crate::object::store::read_object(repo, target, hasher.as_ref())?;
    let tree_hash = match obj {
        crate::object::Object::Commit(c) => c.tree,
        _ => return Err(ItehaasError::InvalidObject("target is not commit".into())),
    };
    let target_map = tree_builder::flatten_tree_root(repo, &tree_hash, hasher.as_ref())?;
    // Get current head map for deletion (after move, current is target, but we need old working tree diff)
    // Instead we compute current working tree files vs target: delete files not in target, create target files
    // Simpler: use checkout_forced logic but via direct map
    // We need current_map from previous HEAD? But we already moved HEAD, so reconstruct target_map vs working tree
    // We'll reuse checkout_forced via internal helper that doesn't check status and uses target hash
    // Since we already moved HEAD, checkout_forced to target will sync wt+index.
    // But checkout_forced expects branch name; we can use direct sync
    sync_working_tree(repo, &target_map, hasher.as_ref())?;
    // Ensure index is target (sync does it)
    Ok(())
}

fn sync_working_tree(
    repo: &Path,
    target_map: &BTreeMap<String, (Hash, u32)>,
    hasher: &dyn crate::hash::Hasher,
) -> Result<()> {
    // Build current wt index map for deletion: list files currently on disk (including tracked+untracked)
    // But for reset --hard, we should make working tree exactly match target tree, regardless of current changes.
    // So we list current wt files, delete those not in target, write target files.
    let mut current_files: Vec<String> = Vec::new();
    for entry in walkdir::WalkDir::new(repo).min_depth(1).into_iter().filter_entry(|e| {
        let rel = e.path().strip_prefix(repo).unwrap_or(e.path());
        !crate::index::should_ignore(rel) && !crate::ignore::is_ignored(repo, rel, e.path().is_dir())
    }) {
        let entry = entry.map_err(|e| ItehaasError::Other(e.to_string()))?;
        let p = entry.path();
        if p.is_file() {
            let rel = p.strip_prefix(repo).unwrap();
            if crate::index::should_ignore(rel) || crate::ignore::is_ignored(repo, rel, false) {
                continue;
            }
            let rel_str = crate::index::path_to_string(rel);
            current_files.push(rel_str);
        }
    }
    // Delete files not in target
    for f in current_files {
        if !target_map.contains_key(&f) {
            let abs = repo.join(&f);
            if abs.exists() {
                let _ = fs::remove_file(&abs);
                // try remove empty parents
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
    // Write target files
    for (path, (hash, mode)) in target_map {
        let abs = repo.join(path);
        if let Some(parent) = abs.parent() {
            fs::create_dir_all(parent)?;
        }
        let obj = crate::object::store::read_object(repo, hash, hasher)?;
        let content = match obj {
            crate::object::Object::Blob(b) => b.content,
            _ => return Err(ItehaasError::InvalidObject(format!("tree entry {} not blob", path))),
        };
        fs::write(&abs, &content)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perm = if *mode == 0o100755 { 0o755 } else { 0o644 };
            let _ = fs::set_permissions(&abs, fs::Permissions::from_mode(perm));
        }
    }
    // Update index
    let mut idx = Index::new();
    for (path, (hash, mode)) in target_map {
        let entry = crate::index::IndexEntry::new(path.clone(), hash.clone(), *mode);
        idx.add_or_update(entry);
    }
    idx.save(repo)?;
    Ok(())
}

/// Reset specific paths from given commit to index (unstage)
/// Equivalent to `git reset HEAD <path>` — copy entries from target commit tree to index.
/// Does NOT move HEAD, does NOT touch working tree.
pub fn reset_paths(repo: &Path, target: &Hash, paths: &[String]) -> Result<Vec<String>> {
    let algo = crate::config::read_hasher(repo)?;
    let hasher = crate::hash::new_hasher(algo)?;
    let obj = crate::object::store::read_object(repo, target, hasher.as_ref())?;
    let tree_hash = match obj {
        crate::object::Object::Commit(c) => c.tree,
        _ => return Err(ItehaasError::InvalidObject("target is not commit".into())),
    };
    let mut target_map = BTreeMap::new();
    // Empty tree case: target may be empty? flatten handles
    let t = tree_builder::flatten_tree_root(repo, &tree_hash, hasher.as_ref())?;
    target_map.extend(t);

    let mut index = Index::load(repo)?;
    let mut affected = Vec::new();
    for p in paths {
        // Check if pattern? For now exact path plus prefix directory
        // Support both file and directory prefix
        let mut matched = false;
        // Check target map for exact and under prefix
        let mut entries: Vec<(String, (Hash, u32))> = Vec::new();
        for (k, v) in &target_map {
            if k == p || k.starts_with(&format!("{}/", p)) {
                entries.push((k.clone(), v.clone()));
            }
        }
        // Also handle index entries that may be under path dir but not in target (need to remove)
        // Find index keys matching path prefix
        let index_keys: Vec<String> = index
            .entries_sorted()
            .iter()
            .map(|e| e.path.clone())
            .filter(|k| k == p || k.starts_with(&format!("{}/", p)))
            .collect();

        if !entries.is_empty() {
            for (k, (h, m)) in entries {
                let entry = crate::index::IndexEntry::new(k.clone(), h, m);
                index.add_or_update(entry);
                affected.push(k);
                matched = true;
            }
            // Remove any index keys that are under p but not in target? Already handled by above loop? No, need to remove those not in entries
            for k in &index_keys {
                if !target_map.contains_key(k) {
                    index.remove(k);
                    affected.push(k.clone());
                    matched = true;
                }
            }
        } else {
            // No target entry — this means the file was added in index but not in HEAD, so unstaging should remove it
            // If target doesn't have path, removing from index means unstaging
            for k in index_keys {
                index.remove(&k);
                affected.push(k.clone());
                matched = true;
            }
        }
        if !matched {
            // Also try pattern match via wildcard? For simplicity, if no exact/prefix match, we treat as not matched and continue
            // But to mimic git, if path not in target and not in index, it's error? We'll just record as not affected
        }
    }
    // Deduplicate affected
    affected.sort();
    affected.dedup();
    index.save(repo)?;
    Ok(affected)
}
