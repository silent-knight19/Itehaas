use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{ItehaasError, Result};
use crate::hash::Hash;
use crate::index::{file_mode, path_to_string, Index, IndexEntry};
use crate::object::store;
use crate::tree_builder;

/// S4: ensure path inside repo and no symlink in parent chain
fn ensure_no_symlink_and_inside_repo(repo: &Path, abs: &Path) -> Result<()> {
    // Must be inside repo via canonical or starts_with after join
    // Check for .itehaas escape
    let rel = abs.strip_prefix(repo).map_err(|_| ItehaasError::Other(format!("path escapes repository: {}", abs.display())))?;
    let rel_str = path_to_string(rel);
    if rel_str.is_empty() {
        return Err(ItehaasError::Other("empty path".into()));
    }
    // Reject .itehaas/.git segments
    for comp in rel.components() {
        let s = comp.as_os_str().to_string_lossy();
        if s == ".itehaas" || s == ".git" {
            return Err(ItehaasError::Other(format!("path contains forbidden component: {}", s)));
        }
        if s == ".." || s == "." {
            return Err(ItehaasError::Other(format!("path contains traversal: {}", rel_str)));
        }
    }
    // Check each ancestor from repo to parent of abs for symlink
    if let Some(parent) = abs.parent() {
        let mut cur: PathBuf = parent.to_path_buf();
        // Walk up to repo (exclusive)
        while cur != *repo && cur.starts_with(repo) {
            match fs::symlink_metadata(&cur) {
                Ok(m) if m.file_type().is_symlink() => {
                    return Err(ItehaasError::Other(format!("refusing to traverse symlink: {}", cur.display())));
                }
                Ok(_) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(ItehaasError::Io(e)),
            }
            if let Some(p) = cur.parent() {
                let pbuf = p.to_path_buf();
                if pbuf == cur {
                    break;
                }
                cur = pbuf;
            } else {
                break;
            }
        }
        // Also check abs itself if it exists and is symlink (should not overwrite symlink)
        if let Ok(m) = fs::symlink_metadata(abs) {
            if m.file_type().is_symlink() {
                return Err(ItehaasError::Other(format!("refusing to overwrite symlink: {}", abs.display())));
            }
        }
    }
    // Canonical containment if parent exists
    if let Some(parent) = abs.parent() {
        if parent.exists() {
            // Use canonicalize for existing parent to ensure not escaping via symlink mount
            if let Ok(canon_parent) = parent.canonicalize() {
                if let Ok(canon_repo) = repo.canonicalize() {
                    if !canon_parent.starts_with(&canon_repo) {
                        return Err(ItehaasError::Other(format!("path escapes repository (canonical): {}", abs.display())));
                    }
                }
            }
        }
    }
    Ok(())
}

/// Update working tree and index to match target commit's tree.
/// Also updates HEAD (symbolic or detached) as requested.
pub fn checkout(
    repo: &Path,
    target_hash: &Hash,
    detached: bool,
    branch_name: Option<&str>,
) -> Result<()> {
    let algo = crate::config::read_hasher(repo)?;
    let hasher = crate::hash::new_hasher(algo)?;

    // Resolve target tree
    let target_commit_obj = store::read_object(repo, target_hash, hasher.as_ref())?;
    let target_tree_hash = match target_commit_obj {
        crate::object::Object::Commit(c) => c.tree,
        _ => return Err(ItehaasError::InvalidObject("target is not a commit".into())),
    };
    let target_map = tree_builder::flatten_tree_root(repo, &target_tree_hash, hasher.as_ref())?;

    // Get current HEAD tree (if any) for deletion logic
    let current_head = crate::refs::resolve_head(repo)?;
    let current_map: BTreeMap<String, (Hash, u32)> = if let Some(head_hash) = current_head {
        let obj = store::read_object(repo, &head_hash, hasher.as_ref())?;
        let cur_tree = match obj {
            crate::object::Object::Commit(c) => c.tree,
            _ => return Err(ItehaasError::InvalidObject("HEAD is not a commit".into())),
        };
        tree_builder::flatten_tree_root(repo, &cur_tree, hasher.as_ref())?
    } else {
        BTreeMap::new()
    };

    // Safety: check working tree status is clean (staged/not_staged) unless we want --force
    // For Phase 3, require clean (except untracked)
    let st = crate::status::status(repo)?;
    if !st.staged.is_empty() || !st.not_staged.is_empty() {
        return Err(ItehaasError::Other(
            "working tree has modifications; commit or stash them before checkout".into(),
        ));
    }

    // Delete files that are in current but not in target
    for (path, _) in &current_map {
        if !target_map.contains_key(path) {
            let abs = repo.join(path);
            if abs.exists() {
                fs::remove_file(&abs)?;
                // Try to remove empty parent dirs (e.g., src/ if empty)
                if let Some(parent) = abs.parent() {
                    // Only remove if parent is inside repo and becomes empty
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
                            Err(_) => break, // not empty or error
                        }
                    }
                }
            }
        }
    }

    // Write target files — S4 hardened
    for (path, (hash, mode)) in &target_map {
        let abs = repo.join(path);
        ensure_no_symlink_and_inside_repo(repo, &abs)?;
        if let Some(parent) = abs.parent() {
            // Ensure parent chain has no symlink before creating
            ensure_no_symlink_and_inside_repo(repo, &parent.join("_placeholder"))?;
            fs::create_dir_all(parent)?;
            // Re-check after creation to ensure not raced to symlink
            let mut cur = parent.to_path_buf();
            while cur != *repo && cur.starts_with(repo) {
                if let Ok(m) = fs::symlink_metadata(&cur) {
                    if m.file_type().is_symlink() {
                        return Err(ItehaasError::Other(format!("refusing to traverse symlink after mkdir: {}", cur.display())));
                    }
                }
                if let Some(p) = cur.parent() {
                    cur = p.to_path_buf();
                } else {
                    break;
                }
            }
        }
        let obj = store::read_object(repo, hash, hasher.as_ref())?;
        let content = match obj {
            crate::object::Object::Blob(b) => b.content,
            _ => return Err(ItehaasError::InvalidObject(format!("tree entry {} is not blob", path))),
        };
        fs::write(&abs, &content)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perm = if *mode == 0o100755 { 0o755 } else { 0o644 };
            let _ = fs::set_permissions(&abs, fs::Permissions::from_mode(perm));
        }
    }

    // Update index to match target
    let mut index = Index::new();
    for (path, (hash, mode)) in target_map.clone() {
        let entry = IndexEntry::new(path, hash, mode);
        index.add_or_update(entry);
    }
    index.save(repo)?;

    // Update HEAD with reflog
    // Capture old HEAD for message
    let old_head = crate::refs::resolve_head(repo).unwrap_or(None);
    let old_branch = crate::refs::current_branch(repo).unwrap_or(None).unwrap_or_else(|| "HEAD".to_string());
    if detached {
        crate::refs::write_head_detached(repo, target_hash)?;
        let msg = format!("checkout: moving from {} to {}", old_branch, target_hash.hex()[..7].to_string());
        let _ = crate::reflog::append_reflog(repo, "HEAD", old_head.as_ref(), Some(target_hash), &msg);
    } else if let Some(branch) = branch_name {
        let ref_name = format!("refs/heads/{}", branch);
        crate::refs::write_head_ref(repo, &ref_name)?;
        let msg = format!("checkout: moving from {} to {}", old_branch, branch);
        let _ = crate::reflog::append_reflog(repo, "HEAD", old_head.as_ref(), Some(target_hash), &msg);
    } else {
        // Should not happen
        return Err(ItehaasError::Other("checkout: no branch or detached".into()));
    }

    Ok(())
}

/// Checkout helper for branch name
pub fn checkout_branch(repo: &Path, branch: &str) -> Result<()> {
    let hash = crate::refs::read_ref(repo, &format!("refs/heads/{}", branch))?
        .ok_or_else(|| ItehaasError::Other(format!("branch '{}' not found", branch)))?;
    checkout(repo, &hash, false, Some(branch))
}

/// Checkout detached
pub fn checkout_detached(repo: &Path, hash: &Hash) -> Result<()> {
    checkout(repo, hash, true, None)
}

/// Forced checkout (bypass dirty check) — used for clone
pub fn checkout_branch_forced(repo: &Path, branch: &str) -> Result<()> {
    let hash = crate::refs::read_ref(repo, &format!("refs/heads/{}", branch))?
        .ok_or_else(|| ItehaasError::Other(format!("branch '{}' not found", branch)))?;
    checkout_forced(repo, &hash, false, Some(branch))
}

/// Forced checkout without status check
pub fn checkout_forced(
    repo: &Path,
    target_hash: &Hash,
    detached: bool,
    branch_name: Option<&str>,
) -> Result<()> {
    let algo = crate::config::read_hasher(repo)?;
    let hasher = crate::hash::new_hasher(algo)?;
    let target_commit_obj = store::read_object(repo, target_hash, hasher.as_ref())?;
    let target_tree_hash = match target_commit_obj {
        crate::object::Object::Commit(c) => c.tree,
        _ => return Err(ItehaasError::InvalidObject("target is not a commit".into())),
    };
    let target_map = tree_builder::flatten_tree_root(repo, &target_tree_hash, hasher.as_ref())?;
    let current_head = crate::refs::resolve_head(repo)?;
    let current_map: BTreeMap<String, (Hash, u32)> = if let Some(head_hash) = current_head {
        let obj = store::read_object(repo, &head_hash, hasher.as_ref())?;
        let cur_tree = match obj {
            crate::object::Object::Commit(c) => c.tree,
            _ => return Err(ItehaasError::InvalidObject("HEAD is not a commit".into())),
        };
        tree_builder::flatten_tree_root(repo, &cur_tree, hasher.as_ref()).unwrap_or_default()
    } else {
        BTreeMap::new()
    };
    // Delete files not in target
    for (path, _) in &current_map {
        if !target_map.contains_key(path) {
            let abs = repo.join(path);
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
        }
    }
    for (path, (hash, mode)) in &target_map {
        let abs = repo.join(path);
        ensure_no_symlink_and_inside_repo(repo, &abs)?;
        if let Some(parent) = abs.parent() {
            ensure_no_symlink_and_inside_repo(repo, &parent.join("_placeholder"))?;
            fs::create_dir_all(parent)?;
            let mut cur = parent.to_path_buf();
            while cur != *repo && cur.starts_with(repo) {
                if let Ok(m) = fs::symlink_metadata(&cur) {
                    if m.file_type().is_symlink() {
                        return Err(ItehaasError::Other(format!("refusing to traverse symlink after mkdir: {}", cur.display())));
                    }
                }
                if let Some(p) = cur.parent() {
                    cur = p.to_path_buf();
                } else {
                    break;
                }
            }
        }
        let obj = store::read_object(repo, hash, hasher.as_ref())?;
        let content = match obj {
            crate::object::Object::Blob(b) => b.content,
            _ => return Err(ItehaasError::InvalidObject(format!("tree entry {} is not blob", path))),
        };
        fs::write(&abs, &content)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perm = if *mode == 0o100755 { 0o755 } else { 0o644 };
            let _ = fs::set_permissions(&abs, fs::Permissions::from_mode(perm));
        }
    }
    let mut index = Index::new();
    for (path, (hash, mode)) in target_map.clone() {
        let entry = IndexEntry::new(path, hash, mode);
        index.add_or_update(entry);
    }
    index.save(repo)?;
    // reflog for forced checkout as well
    let old_head = crate::refs::resolve_head(repo).unwrap_or(None);
    let old_branch = crate::refs::current_branch(repo).unwrap_or(None).unwrap_or_else(|| "HEAD".to_string());
    if detached {
        crate::refs::write_head_detached(repo, target_hash)?;
        let msg = format!("checkout: moving from {} to {}", old_branch, target_hash.hex()[..7].to_string());
        let _ = crate::reflog::append_reflog(repo, "HEAD", old_head.as_ref(), Some(target_hash), &msg);
    } else if let Some(branch) = branch_name {
        let ref_name = format!("refs/heads/{}", branch);
        crate::refs::write_head_ref(repo, &ref_name)?;
        let msg = format!("checkout: moving from {} to {}", old_branch, branch);
        let _ = crate::reflog::append_reflog(repo, "HEAD", old_head.as_ref(), Some(target_hash), &msg);
    }
    Ok(())
}
