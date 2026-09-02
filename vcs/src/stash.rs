use std::fs;
use std::path::Path;

use crate::error::{ItehaasError, Result};
use crate::hash::Hash;
use crate::index::Index;
use crate::object::{Commit, Object, Signature, Tree};
use crate::tree_builder;

const STASH_REF: &str = "refs/stash";
const STASH_LOG: &str = "logs/refs/stash";

fn stash_ref_path(repo: &Path) -> std::path::PathBuf {
    repo.join(".itehaas").join(STASH_REF)
}

fn stash_log_path(repo: &Path) -> std::path::PathBuf {
    repo.join(".itehaas").join(STASH_LOG)
}

/// Create a stash commit. Returns stash hash.
/// Logic: create two tree objects: index tree and wt tree
/// Then create stash commit with parents [HEAD] and tree = wt_tree, message "WIP on <branch>: <HEAD hash> <msg>"
/// We also store index tree as second parent via extra? git uses 2nd parent for index, 3rd for untracked.
fn create_stash_commit(
    repo: &Path,
    message: &str,
    include_untracked: bool,
) -> Result<Hash> {
    let algo = crate::config::read_hasher(repo)?;
    let hasher = crate::hash::new_hasher(algo)?;
    let head = crate::refs::resolve_head(repo)?.ok_or_else(|| ItehaasError::Other("no commits yet, cannot stash (nothing to stash)".into()))?;
    let branch = crate::refs::current_branch(repo)?.unwrap_or_else(|| "no branch".to_string());

    // Build index tree
    let index = Index::load(repo)?;
    let index_entries = index.entries_sorted();
    let index_tree = tree_builder::build_tree_from_index(repo, &index_entries, hasher.as_ref())?;

    // Build working tree tree (including untracked if requested)
    // We'll build a temporary index from working tree files (filtered)
    let mut wt_entries: Vec<crate::index::IndexEntry> = Vec::new();
    // Use walkdir, include files that are either tracked or untracked depending on flag
    let mut existing_index_paths: std::collections::BTreeSet<String> = index.entries_sorted().iter().map(|e| e.path.clone()).collect();
    for entry in walkdir::WalkDir::new(repo).min_depth(1).into_iter().filter_entry(|e| {
        let rel = e.path().strip_prefix(repo).unwrap_or(e.path());
        !crate::index::should_ignore(rel) && !crate::ignore::is_ignored(repo, rel, e.path().is_dir())
    }) {
        let entry = entry.map_err(|e| ItehaasError::Other(e.to_string()))?;
        let p = entry.path();
        if p.is_dir() { continue; }
        let rel = p.strip_prefix(repo).unwrap();
        if crate::index::should_ignore(rel) || crate::ignore::is_ignored(repo, rel, false) { continue; }
        let rel_str = crate::index::path_to_string(rel);
        // If include_untracked false, skip untracked files (not in index nor HEAD)
        if !include_untracked {
            // Determine if untracked: not in index and not in HEAD tree
            let head_map = {
                let obj = crate::object::store::read_object(repo, &head, hasher.as_ref())?;
                let tree = match obj { Object::Commit(c) => c.tree, _ => return Err(ItehaasError::Other("HEAD not commit".into())) };
                tree_builder::flatten_tree_root(repo, &tree, hasher.as_ref())?
            };
            if !existing_index_paths.contains(&rel_str) && !head_map.contains_key(&rel_str) {
                continue;
            }
        }
        let data = fs::read(p)?;
        let blob = crate::object::Blob::new(data);
        let obj = Object::Blob(blob);
        let hash = crate::object::store::write_object(repo, &obj, hasher.as_ref())?;
        let mode = crate::index::file_mode(&fs::metadata(p)?);
        wt_entries.push(crate::index::IndexEntry::new(rel_str, hash, mode));
    }
    // Include also deleted files? If index has file but wt doesn't, we should not include it in wt tree (deletion). That's fine because we only walk wt existing files.
    // Sort entries
    wt_entries.sort_by(|a,b| a.path.cmp(&b.path));
    let wt_refs: Vec<&crate::index::IndexEntry> = wt_entries.iter().collect();
    let wt_tree = tree_builder::build_tree_from_index(repo, &wt_refs, hasher.as_ref())?;

    // Create commit objects
    // First, create commit for index: tree = index_tree, parents = []? In git, stash index commit has parent HEAD. We will mimic: index commit parent is HEAD
    let (cfg_name, cfg_email) = crate::config::read_user(repo)?;
    let name = cfg_name.unwrap_or_else(|| "Author".to_string());
    let email = cfg_email.unwrap_or_else(|| "author@example.com".to_string());
    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
    let tz = "+0000".to_string();
    let sig = Signature::new(name.clone(), email.clone(), ts, tz.clone())?;
    // Index commit
    let index_commit = Commit::new(index_tree.clone(), vec![head.clone()], sig.clone(), sig.clone(), format!("index on {}: {}", branch, head.hex()[..7].to_string()));
    let index_hash = crate::object::store::write_object(repo, &Object::Commit(index_commit), hasher.as_ref())?;

    // Stash commit: tree = wt_tree, parents = [HEAD, index_commit]
    let stash_msg = if message.is_empty() {
        format!("WIP on {}: {} {}", branch, &head.hex()[..7], message)
    } else {
        format!("WIP on {}: {} {}", branch, &head.hex()[..7], message)
    };
    let stash_commit = Commit::new(wt_tree.clone(), vec![head.clone(), index_hash.clone()], sig.clone(), sig.clone(), stash_msg);
    let stash_hash = crate::object::store::write_object(repo, &Object::Commit(stash_commit), hasher.as_ref())?;

    Ok(stash_hash)
}

pub fn stash_push(repo: &Path, message: &str, include_untracked: bool) -> Result<Hash> {
    // Check if working tree is clean (nothing to stash)
    let st = crate::status::status(repo)?;
    if st.staged.is_empty() && st.not_staged.is_empty() && (!include_untracked || st.untracked.is_empty()) {
        return Err(ItehaasError::Other("No local changes to save".into()));
    }
    // Fail if already in merge
    if repo.join(".itehaas").join("MERGE_HEAD").exists() {
        return Err(ItehaasError::Other("cannot stash during merge".into()));
    }
    let hash = create_stash_commit(repo, message, include_untracked)?;

    // Update refs/stash
    let old = crate::refs::read_ref(repo, STASH_REF)?;
    crate::refs::write_ref(repo, STASH_REF, &hash)?;
    // reflog
    {
        let msg = format!("stash: {}", if message.is_empty() { "WIP" } else { message });
        let _ = crate::reflog::append_reflog(repo, STASH_REF, old.as_ref(), Some(&hash), &msg);
        let _ = crate::reflog::append_reflog(repo, "HEAD", old.as_ref(), Some(&hash), &msg); // not strictly HEAD but for visibility
    }
    // Also maintain stack list file .itehaas/stash_list for ordering? We use reflog count
    // Save stash stack as file containing list of stash hashes newest first
    let mut stack = read_stash_list(repo)?;
    stack.insert(0, hash.clone());
    write_stash_list(repo, &stack)?;

    // Reset working tree to HEAD (clean)
    let algo = crate::config::read_hasher(repo)?;
    let hasher = crate::hash::new_hasher(algo)?;
    let head = crate::refs::resolve_head(repo)?.unwrap();
    let obj = crate::object::store::read_object(repo, &head, hasher.as_ref())?;
    let tree = match obj { Object::Commit(c) => c.tree, _ => return Err(ItehaasError::Other("HEAD not commit".into())) };
    let map = tree_builder::flatten_tree_root(repo, &tree, hasher.as_ref())?;
    // Sync working tree to HEAD without moving HEAD (similar to reset --hard but without reflog HEAD move)
    // Delete files not in HEAD
    for entry in walkdir::WalkDir::new(repo).min_depth(1).into_iter().filter_entry(|e| {
        let rel = e.path().strip_prefix(repo).unwrap_or(e.path());
        !crate::index::should_ignore(rel) && !crate::ignore::is_ignored(repo, rel, e.path().is_dir())
    }) {
        let entry = entry.map_err(|e| ItehaasError::Other(e.to_string()))?;
        let p = entry.path();
        if p.is_file() {
            let rel = p.strip_prefix(repo).unwrap();
            if crate::index::should_ignore(rel) || crate::ignore::is_ignored(repo, rel, false) { continue; }
            let rel_str = crate::index::path_to_string(rel);
            if !map.contains_key(&rel_str) {
                let _ = fs::remove_file(p);
            }
        }
    }
    // Write target files
    for (path, (hash, mode)) in &map {
        let abs = repo.join(path);
        if let Some(parent) = abs.parent() { fs::create_dir_all(parent)?; }
        let content = crate::diff::get_blob_content(repo, hash, hasher.as_ref())?;
        fs::write(&abs, &content)?;
        #[cfg(unix)]{
            use std::os::unix::fs::PermissionsExt;
            let perm = if *mode == 0o100755 {0o755} else {0o644};
            let _ = fs::set_permissions(&abs, fs::Permissions::from_mode(perm));
        }
    }
    // Reset index to HEAD
    let mut idx = Index::new();
    for (path, (hash, mode)) in map {
        idx.add_or_update(crate::index::IndexEntry::new(path, hash, mode));
    }
    idx.save(repo)?;

    // Instead, ensure index and wt are clean: use direct sync
    // We already have head, so re-sync again if needed (already done via reset_hard)
    // But reset_hard had moved HEAD to head (same) - fine.
    Ok(hash)
}

fn read_stash_list(repo: &Path) -> Result<Vec<Hash>> {
    let p = repo.join(".itehaas").join("stash_list");
    if !p.exists() {
        return Ok(vec![]);
    }
    let content = fs::read_to_string(&p)?;
    let algo = crate::config::read_hasher(repo)?;
    let mut out = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() { continue; }
        if let Ok(h) = Hash::from_hex(algo, trimmed) {
            out.push(h);
        }
    }
    Ok(out)
}

fn write_stash_list(repo: &Path, list: &[Hash]) -> Result<()> {
    let p = repo.join(".itehaas").join("stash_list");
    let mut content = String::new();
    for h in list {
        content.push_str(&h.hex());
        content.push('\n');
    }
    fs::write(p, content)?;
    Ok(())
}

pub fn stash_list(repo: &Path) -> Result<Vec<(Hash, String)>> {
    let list = read_stash_list(repo)?;
    let algo = crate::config::read_hasher(repo)?;
    let hasher = crate::hash::new_hasher(algo)?;
    let mut out = Vec::new();
    for h in list {
        let obj = crate::object::store::read_object(repo, &h, hasher.as_ref())?;
        let msg = match obj {
            Object::Commit(c) => c.message.clone(),
            _ => "".to_string(),
        };
        out.push((h, msg));
    }
    Ok(out)
}

pub fn stash_show(repo: &Path, idx: usize) -> Result<String> {
    let list = read_stash_list(repo)?;
    if idx >= list.len() {
        return Err(ItehaasError::Other(format!("stash@{{{}}} does not exist", idx)));
    }
    let hash = &list[idx];
    let algo = crate::config::read_hasher(repo)?;
    let hasher = crate::hash::new_hasher(algo)?;
    let obj = crate::object::store::read_object(repo, hash, hasher.as_ref())?;
    let commit = match obj { Object::Commit(c) => c, _ => return Err(ItehaasError::Other("stash not commit".into())) };
    // For stash show, display diff between stash commit's tree and parent
    let parent = &commit.parents[0];
    let diffs = crate::diff::diff_head_vs_commit(repo, hash)?; // This compares HEAD vs stash? Not correct.
    // Instead compute diff parent vs stash tree
    let parent_obj = crate::object::store::read_object(repo, parent, hasher.as_ref())?;
    let parent_tree = match parent_obj { Object::Commit(c) => c.tree, _ => return Err(ItehaasError::Other("parent not commit".into())) };
    let mut out = String::new();
    out.push_str(&format!("commit {}\n", hash.hex()));
    out.push_str(&format!("Author: {} <{}>\n", commit.author.name, commit.author.email));
    out.push_str(&format!("Date: {} {}\n\n", commit.author.timestamp, commit.author.tz_offset));
    out.push_str(&format!("    {}\n\n", commit.message));
    // Diff parent vs stash
    let parent_map = tree_builder::flatten_tree_root(repo, &parent_tree, hasher.as_ref())?;
    let stash_map = tree_builder::flatten_tree_root(repo, &commit.tree, hasher.as_ref())?;
    let diffs = crate::diff::diff_maps(&parent_map, &stash_map);
    for d in diffs {
        out.push_str(&format!("{} {}\n", d.status_str(), d.path));
        let old = d.old_hash.as_ref().and_then(|h| crate::diff::get_blob_content(repo, h, hasher.as_ref()).ok());
        let new = d.new_hash.as_ref().and_then(|h| crate::diff::get_blob_content(repo, h, hasher.as_ref()).ok());
        let diff_txt = match (old, new) {
            (Some(o), Some(n)) => crate::diff::unified_diff(&o, &n, &d.path),
            (None, Some(n)) => crate::diff::unified_diff(b"", &n, &d.path),
            (Some(o), None) => crate::diff::unified_diff(&o, b"", &d.path),
            _ => String::new(),
        };
        out.push_str(&diff_txt);
    }
    Ok(out)
}

pub fn stash_apply(repo: &Path, idx: usize, do_pop: bool) -> Result<()> {
    let mut list = read_stash_list(repo)?;
    if idx >= list.len() {
        return Err(ItehaasError::Other(format!("stash@{{{}}} does not exist", idx)));
    }
    let stash_hash = list[idx].clone();
    let algo = crate::config::read_hasher(repo)?;
    let hasher = crate::hash::new_hasher(algo)?;
    let stash_obj = crate::object::store::read_object(repo, &stash_hash, hasher.as_ref())?;
    let stash_commit = match stash_obj { Object::Commit(c) => c, _ => return Err(ItehaasError::Other("stash not commit".into())) };

    // Check clean?
    // For apply, we can allow dirty but will attempt merge.
    let st = crate::status::status(repo)?;
    // If working tree dirty, merging stash may conflict. Allow but warn.
    // Use merge logic: we have stash tree vs current HEAD vs index?
    // Simplified: just checkout stash tree onto working tree, merging with current changes via 3-way.
    // For simplicity, we apply stash by comparing stash's parent (HEAD at stash time) vs stash tree vs current wt.
    let parent_hash = &stash_commit.parents[0];
    let parent_obj = crate::object::store::read_object(repo, parent_hash, hasher.as_ref())?;
    let parent_tree = match parent_obj { Object::Commit(c) => c.tree, _ => return Err(ItehaasError::Other("parent not commit".into())) };
    let parent_map = tree_builder::flatten_tree_root(repo, &parent_tree, hasher.as_ref())?;
    let stash_map = tree_builder::flatten_tree_root(repo, &stash_commit.tree, hasher.as_ref())?;
    // Current index/head wt?
    let current_head = crate::refs::resolve_head(repo)?.unwrap();
    let cur_obj = crate::object::store::read_object(repo, &current_head, hasher.as_ref())?;
    let cur_tree = match cur_obj { Object::Commit(c) => c.tree, _ => return Err(ItehaasError::Other("HEAD not commit".into())) };
    let _cur_map = tree_builder::flatten_tree_root(repo, &cur_tree, hasher.as_ref())?;

    // Instead of complex 3-way, we'll just patch working tree with stash changes where possible
    // For each path in stash_map vs parent_map
    let diffs = crate::diff::diff_maps(&parent_map, &stash_map);
    // Track conflicts
    let mut conflicts = Vec::new();
    let mut index = Index::load(repo)?;

    for d in diffs {
        let path = &d.path;
        // Determine current wt content
        let abs = repo.join(path);
        let wt_exists = abs.exists();
        let wt_hash_opt = if wt_exists {
            let data = fs::read(&abs).ok();
            if let Some(data) = data {
                let blob = crate::object::Blob::new(data);
                Some(Object::Blob(blob).hash(hasher.as_ref()))
            } else { None }
        } else { None };

        let parent_entry = parent_map.get(path);
        let stash_entry = stash_map.get(path);
        // If wt == parent (clean relative to stash base), apply stash
        // Else if wt == stash (already has), skip
        // Else conflict
        let wt_eq_parent = match (wt_hash_opt.as_ref(), parent_entry) {
            (Some(w), Some((ph, pm))) => w.hex() == ph.hex() && {
                if wt_exists { crate::index::file_mode(&fs::metadata(&abs).unwrap_or(fs::metadata(repo).unwrap())) == *pm } else { true }
            },
            (None, None) => true,
            _ => false,
        };
        let wt_eq_stash = match (wt_hash_opt.as_ref(), stash_entry) {
            (Some(w), Some((sh, _))) => w.hex() == sh.hex(),
            (None, None) => true,
            _ => false,
        };
        if wt_eq_parent {
            // Apply stash
            if let Some((sh, mode)) = stash_entry {
                // write file
                if let Some(parent) = abs.parent() { fs::create_dir_all(parent)?; }
                let content = crate::diff::get_blob_content(repo, sh, hasher.as_ref())?;
                fs::write(&abs, &content)?;
                #[cfg(unix)]{
                    use std::os::unix::fs::PermissionsExt;
                    let perm = if *mode == 0o100755 {0o755} else {0o644};
                    let _ = fs::set_permissions(&abs, fs::Permissions::from_mode(perm));
                }
                let entry = crate::index::IndexEntry::new(path.clone(), sh.clone(), *mode);
                index.add_or_update(entry);
            } else {
                // stash deleted file
                if wt_exists { let _ = fs::remove_file(&abs); }
                index.remove(path);
            }
        } else if wt_eq_stash {
            // already equals stash, skip
            continue;
        } else {
            // Conflict: wt diverged from parent and stash diverged differently
            // Generate conflict markers if both are text? Simplified mark conflict
            conflicts.push(path.clone());
            // Write conflict markers to file
            let stash_content = stash_entry.as_ref().and_then(|(h,_)| crate::diff::get_blob_content(repo, h, hasher.as_ref()).ok());
            let parent_content = parent_entry.as_ref().and_then(|(h,_)| crate::diff::get_blob_content(repo, h, hasher.as_ref()).ok());
            let wt_content = wt_exists.then(|| fs::read(&abs).unwrap_or_default()).unwrap_or_default();
            // Create conflict file: <<<<<<< Updated upstream ... ======= ... >>>>>>> Stashed changes
            let mut conflict = Vec::new();
            conflict.extend_from_slice(b"<<<<<<< Updated upstream\n");
            conflict.extend_from_slice(&wt_content);
            if !wt_content.ends_with(b"\n") { conflict.push(b'\n'); }
            conflict.extend_from_slice(b"=======\n");
            if let Some(sc) = stash_content {
                conflict.extend_from_slice(&sc);
                if !sc.ends_with(b"\n") { conflict.push(b'\n'); }
            } else if let Some(pc) = parent_content {
                // deleted in stash but wt modified
                let _ = pc;
            }
            conflict.extend_from_slice(format!(">>>>>>> Stashed changes\n").as_bytes());
            fs::write(&abs, &conflict)?;
            // Don't update index for conflicted path
        }
    }
    index.save(repo)?;

    if !conflicts.is_empty() {
        return Err(ItehaasError::Other(format!("conflicts during stash apply: {}", conflicts.join(", "))));
    }
    if do_pop {
        // Remove from list and update reflog? Also update refs/stash to next top or delete
        list.remove(idx);
        write_stash_list(repo, &list)?;
        if let Some(new_top) = list.first() {
            crate::refs::write_ref(repo, STASH_REF, new_top)?;
            let _ = crate::reflog::append_reflog(repo, STASH_REF, Some(&stash_hash), Some(new_top), "stash pop");
        } else {
            let _ = fs::remove_file(stash_ref_path(repo));
            // log deletion with zero? we skip
            let _ = fs::remove_file(repo.join(".itehaas").join("stash_list"));
        }
    }
    Ok(())
}

pub fn stash_pop(repo: &Path, idx: usize) -> Result<()> {
    stash_apply(repo, idx, true)
}

pub fn stash_clear(repo: &Path) -> Result<()> {
    let _ = fs::remove_file(stash_ref_path(repo));
    let _ = fs::remove_file(repo.join(".itehaas").join("stash_list"));
    let _ = fs::remove_file(stash_log_path(repo));
    Ok(())
}

pub fn stash_drop(repo: &Path, idx: usize) -> Result<()> {
    let mut list = read_stash_list(repo)?;
    if idx >= list.len() {
        return Err(ItehaasError::Other(format!("stash@{{{}}} does not exist", idx)));
    }
    let removed = list.remove(idx);
    write_stash_list(repo, &list)?;
    if let Some(new_top) = list.first() {
        crate::refs::write_ref(repo, STASH_REF, new_top)?;
        let _ = crate::reflog::append_reflog(repo, STASH_REF, Some(&removed), Some(new_top), "stash drop");
    } else {
        let _ = fs::remove_file(stash_ref_path(repo));
        let _ = fs::remove_file(stash_log_path(repo));
    }
    Ok(())
}
