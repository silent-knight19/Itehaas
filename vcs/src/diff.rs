use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

use crate::error::Result;
use crate::hash::{Hash, Hasher};
use crate::index::Index;
use crate::object::store;
use crate::tree_builder;

#[derive(Debug, Clone)]
pub struct DiffEntry {
    pub path: String,
    /// For Renamed status, this holds the new path (old is `path`)
    pub new_path: Option<String>,
    pub status: DiffStatus,
    pub old_hash: Option<Hash>,
    pub new_hash: Option<Hash>,
    pub old_mode: Option<u32>,
    pub new_mode: Option<u32>,
    /// For renames, 0-100 similarity (GitHub uses 50 threshold)
    pub similarity: Option<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DiffStatus {
    Added,
    Deleted,
    Modified,
    TypeChange, // mode changed
    Renamed,
}

impl DiffEntry {
    pub fn status_str(&self) -> &'static str {
        match self.status {
            DiffStatus::Added => "added",
            DiffStatus::Deleted => "deleted",
            DiffStatus::Modified => "modified",
            DiffStatus::TypeChange => "typechange",
            DiffStatus::Renamed => "renamed",
        }
    }
    /// Display path for UI: for renames "old → new (similarity%)"
    pub fn display_path(&self) -> String {
        match &self.new_path {
            Some(np) if self.status == DiffStatus::Renamed => {
                if let Some(sim) = self.similarity {
                    format!("{} → {} ({}%)", self.path, np, sim)
                } else {
                    format!("{} → {}", self.path, np)
                }
            }
            _ => self.path.clone(),
        }
    }
    /// Effective new path for viewer: renamed uses new_path else path
    pub fn effective_new_path(&self) -> &str {
        self.new_path.as_deref().unwrap_or(&self.path)
    }
}

/// Compute diff between two maps: old vs new
pub fn diff_maps(
    old: &BTreeMap<String, (Hash, u32)>,
    new: &BTreeMap<String, (Hash, u32)>,
) -> Vec<DiffEntry> {
    let mut result = Vec::new();
    let keys: BTreeSet<String> = old.keys().chain(new.keys()).cloned().collect();
    for k in keys {
        let old_entry = old.get(&k);
        let new_entry = new.get(&k);
        match (old_entry, new_entry) {
            (None, Some((h, m))) => result.push(DiffEntry {
                path: k,
                new_path: None,
                status: DiffStatus::Added,
                old_hash: None,
                new_hash: Some(h.clone()),
                old_mode: None,
                new_mode: Some(*m),
                similarity: None,
            }),
            (Some((h, m)), None) => result.push(DiffEntry {
                path: k,
                new_path: None,
                status: DiffStatus::Deleted,
                old_hash: Some(h.clone()),
                new_hash: None,
                old_mode: Some(*m),
                new_mode: None,
                similarity: None,
            }),
            (Some((oh, om)), Some((nh, nm))) => {
                if oh.hex() != nh.hex() || om != nm {
                    let status = if om != nm && oh.hex() == nh.hex() {
                        DiffStatus::TypeChange
                    } else {
                        DiffStatus::Modified
                    };
                    result.push(DiffEntry {
                        path: k,
                        new_path: None,
                        status,
                        old_hash: Some(oh.clone()),
                        new_hash: Some(nh.clone()),
                        old_mode: Some(*om),
                        new_mode: Some(*nm),
                        similarity: None,
                    });
                }
            }
            (None, None) => {}
        }
    }
    result
}

/// Helper: compute similarity ratio 0.0..1.0 for rename detection.
/// Uses line-level equality ratio via `similar` crate.
fn compute_similarity(old: &str, new: &str) -> f32 {
    if old == new {
        return 1.0;
    }
    if old.is_empty() || new.is_empty() {
        return 0.0;
    }
    let diff = similar::TextDiff::from_lines(old, new);
    let mut equal: usize = 0;
    let mut total: usize = 0;
    for op in diff.ops() {
        for change in diff.iter_changes(op) {
            total += 1;
            if change.tag() == similar::ChangeTag::Equal {
                equal += 1;
            }
        }
    }
    if total == 0 {
        return 1.0;
    }
    equal as f32 / total as f32
}

/// Detect renames among Added/Deleted entries.
/// Pairs Deleted→Added where content similarity ≥ 0.5 (50%)
/// Returns new vec with Renamed entries replacing pairs.
pub fn detect_renames(repo: &Path, mut entries: Vec<DiffEntry>) -> Result<Vec<DiffEntry>> {
    let algo = crate::config::read_hasher(repo)?;
    let hasher = crate::hash::new_hasher(algo)?;
    let mut added_idx: Vec<usize> = Vec::new();
    let mut deleted_idx: Vec<usize> = Vec::new();
    let mut _other: Vec<DiffEntry> = Vec::new();
    for (i, e) in entries.iter().enumerate() {
        match e.status {
            DiffStatus::Added => added_idx.push(i),
            DiffStatus::Deleted => deleted_idx.push(i),
            _ => {}
        }
    }
    if added_idx.is_empty() || deleted_idx.is_empty() {
        return Ok(entries);
    }
    let mut used_added = std::collections::HashSet::new();
    let mut used_deleted = std::collections::HashSet::new();
    let mut renames: Vec<DiffEntry> = Vec::new();

    for &d_i in &deleted_idx {
        let d_entry = &entries[d_i];
        let old_hash = match &d_entry.old_hash {
            Some(h) => h,
            None => continue,
        };
        let old_content = match get_blob_content(repo, old_hash, hasher.as_ref()) {
            Ok(c) => c,
            Err(_) => continue,
        };
        if is_binary(&old_content) {
            continue;
        }
        let old_str = String::from_utf8_lossy(&old_content).to_string();
        let mut best: Option<(usize, f32)> = None;
        for &a_i in &added_idx {
            if used_added.contains(&a_i) {
                continue;
            }
            let a_entry = &entries[a_i];
            let new_hash = match &a_entry.new_hash {
                Some(h) => h,
                None => continue,
            };
            let new_content = match get_blob_content(repo, new_hash, hasher.as_ref()) {
                Ok(c) => c,
                Err(_) => continue,
            };
            if is_binary(&new_content) {
                continue;
            }
            let new_str = String::from_utf8_lossy(&new_content).to_string();
            let sim = compute_similarity(&old_str, &new_str);
            if sim >= 0.5 {
                if best.is_none() || sim > best.unwrap().1 {
                    best = Some((a_i, sim));
                }
            }
        }
        if let Some((a_i, sim)) = best {
            used_added.insert(a_i);
            used_deleted.insert(d_i);
            let a_entry = &entries[a_i];
            renames.push(DiffEntry {
                path: d_entry.path.clone(), // old path
                new_path: Some(a_entry.path.clone()),
                status: DiffStatus::Renamed,
                old_hash: d_entry.old_hash.clone(),
                new_hash: a_entry.new_hash.clone(),
                old_mode: d_entry.old_mode,
                new_mode: a_entry.new_mode,
                similarity: Some((sim * 100.0) as u8),
            });
        }
    }

    // Build result
    let mut result: Vec<DiffEntry> = Vec::new();
    for (i, e) in entries.into_iter().enumerate() {
        if used_added.contains(&i) || used_deleted.contains(&i) {
            continue;
        }
        result.push(e);
    }
    result.extend(renames);
    // Keep sorted by display path for determinism
    result.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(result)
}

/// Diff two trees directly (by hash)
pub fn diff_trees(repo: &Path, tree_a: &Hash, tree_b: &Hash) -> Result<Vec<DiffEntry>> {
    let algo = crate::config::read_hasher(repo)?;
    let hasher = crate::hash::new_hasher(algo)?;
    let map_a = tree_builder::flatten_tree_root(repo, tree_a, hasher.as_ref())?;
    let map_b = tree_builder::flatten_tree_root(repo, tree_b, hasher.as_ref())?;
    Ok(diff_maps(&map_a, &map_b))
}

/// Diff two commits (by commit hash). Returns diff of their trees.
pub fn diff_commits(repo: &Path, a: &Hash, b: &Hash) -> Result<Vec<DiffEntry>> {
    if a.hex() == b.hex() {
        return Ok(Vec::new());
    }
    let algo = crate::config::read_hasher(repo)?;
    let hasher = crate::hash::new_hasher(algo)?;
    // Resolve a to tree: try commit first, fallback to tree
    let tree_a = match store::read_object(repo, a, hasher.as_ref()) {
        Ok(crate::object::Object::Commit(c)) => c.tree,
        Ok(crate::object::Object::Tree(_)) => a.clone(),
        Ok(_) => return Err(crate::error::ItehaasError::InvalidObject(format!("{} is not a commit or tree", a.hex()))),
        Err(e) => return Err(e),
    };
    let tree_b = match store::read_object(repo, b, hasher.as_ref()) {
        Ok(crate::object::Object::Commit(c)) => c.tree,
        Ok(crate::object::Object::Tree(_)) => b.clone(),
        Ok(_) => return Err(crate::error::ItehaasError::InvalidObject(format!("{} is not a commit or tree", b.hex()))),
        Err(e) => return Err(e),
    };
    diff_trees(repo, &tree_a, &tree_b)
}

/// Diff a commit against its first parent (or empty if root). Git `show` semantics.
pub fn diff_commit_with_parent(repo: &Path, hash: &Hash) -> Result<Vec<DiffEntry>> {
    let algo = crate::config::read_hasher(repo)?;
    let hasher = crate::hash::new_hasher(algo)?;
    let obj = store::read_object(repo, hash, hasher.as_ref())?;
    let commit = match obj {
        crate::object::Object::Commit(c) => c,
        _ => return Err(crate::error::ItehaasError::InvalidObject(format!("{} is not a commit", hash.hex()))),
    };
    let cur_map = tree_builder::flatten_tree_root(repo, &commit.tree, hasher.as_ref())?;
    let parent_map = if let Some(parent_hash) = commit.parents.first() {
        let p_obj = store::read_object(repo, parent_hash, hasher.as_ref())?;
        match p_obj {
            crate::object::Object::Commit(pc) => tree_builder::flatten_tree_root(repo, &pc.tree, hasher.as_ref())?,
            _ => BTreeMap::new(),
        }
    } else {
        BTreeMap::new()
    };
    Ok(diff_maps(&parent_map, &cur_map))
}

/// Count additions/deletions for a patch string
pub fn count_patch_stats(patch: &str) -> (usize, usize) {
    let mut add: usize = 0;
    let mut del: usize = 0;
    for line in patch.lines() {
        if line.starts_with('+') && !line.starts_with("+++") {
            add += 1;
        } else if line.starts_with('-') && !line.starts_with("---") {
            del += 1;
        }
    }
    (add, del)
}

/// Check if path is likely an image (for UI image diff)
pub fn is_image_path(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".gif")
        || lower.ends_with(".webp")
        || lower.ends_with(".svg")
        || lower.ends_with(".bmp")
        || lower.ends_with(".ico")
}

/// Get file content for a hash (blob)
pub fn get_blob_content(repo: &Path, hash: &Hash, hasher: &dyn Hasher) -> Result<Vec<u8>> {
    let obj = store::read_object(repo, hash, hasher)?;
    match obj {
        crate::object::Object::Blob(b) => Ok(b.content),
        _ => Err(crate::error::ItehaasError::InvalidObject(format!(
            "object {} is not a blob",
            hash.hex()
        ))),
    }
}

/// Check if content is binary (contains null byte or non-utf8)
pub fn is_binary(data: &[u8]) -> bool {
    if data.contains(&0) {
        return true;
    }
    // Check if valid utf8
    std::str::from_utf8(data).is_err()
}

/// Generate unified diff string for two contents
pub fn unified_diff(old: &[u8], new: &[u8], path: &str) -> String {
    if is_binary(old) || is_binary(new) {
        return format!("Binary files a/{} and b/{} differ\n", path, path);
    }
    let old_str = String::from_utf8_lossy(old);
    let new_str = String::from_utf8_lossy(new);
    if old_str == new_str {
        return String::new();
    }
    let diff = similar::TextDiff::from_lines(&old_str, &new_str);
    let patch = diff
        .unified_diff()
        .context_radius(3)
        .header(&format!("a/{}", path), &format!("b/{}", path))
        .to_string();
    let mut out = String::new();
    out.push_str(&format!("diff --itehaas a/{} b/{}\n", path, path));
    if patch.is_empty() {
        // Fallback if no hunk header produced but still changed
        out.push_str(&format!("--- a/{}\n+++ b/{}\n", path, path));
        out.push_str("@@ -1 +1 @@\n");
        for line in old_str.lines() {
            out.push_str(&format!("-{}\n", line));
        }
        for line in new_str.lines() {
            out.push_str(&format!("+{}\n", line));
        }
    } else {
        out.push_str(&patch);
        // Ensure trailing newline
        if !out.ends_with('\n') {
            out.push('\n');
        }
    }
    out
}

/// Diff working tree vs index (unstaged)
pub fn diff_working_vs_index(repo: &Path) -> Result<Vec<DiffEntry>> {
    let algo = crate::config::read_hasher(repo)?;
    let hasher = crate::hash::new_hasher(algo)?;
    let index = Index::load(repo)?;
    let mut index_map = BTreeMap::new();
    for e in index.entries_sorted() {
        let h = e.hash_as(algo)?;
        index_map.insert(e.path.clone(), (h, e.mode));
    }
    // Working tree map
    let mut wt_map = BTreeMap::new();
    for entry in walkdir::WalkDir::new(repo).min_depth(1).into_iter().filter_entry(|e| {
        let rel = e.path().strip_prefix(repo).unwrap_or(e.path());
        !crate::index::should_ignore(rel) && !crate::ignore::is_ignored(repo, rel, e.path().is_dir())
    }) {
        let entry = entry.map_err(|e| crate::error::ItehaasError::Other(e.to_string()))?;
        let path = entry.path();
        if path.is_dir() {
            continue;
        }
        let rel = path.strip_prefix(repo).unwrap();
        if crate::index::should_ignore(rel) || crate::ignore::is_ignored(repo, rel, false) {
            continue;
        }
        let rel_str = crate::index::path_to_string(rel);
        let data = fs::read(path)?;
        let blob = crate::object::Blob::new(data);
        let obj = crate::object::Object::Blob(blob);
        let hash = obj.hash(hasher.as_ref());
        let mode = crate::index::file_mode(&fs::metadata(path)?);
        wt_map.insert(rel_str, (hash, mode));
    }
    Ok(diff_maps(&index_map, &wt_map))
}

/// Diff index vs HEAD (staged)
pub fn diff_index_vs_head(repo: &Path) -> Result<Vec<DiffEntry>> {
    let algo = crate::config::read_hasher(repo)?;
    let hasher = crate::hash::new_hasher(algo)?;
    let index = Index::load(repo)?;
    let mut index_map = BTreeMap::new();
    for e in index.entries_sorted() {
        let h = e.hash_as(algo)?;
        index_map.insert(e.path.clone(), (h, e.mode));
    }
    let head = crate::refs::resolve_head(repo)?;
    let head_map = if let Some(head_hash) = head {
        let obj = store::read_object(repo, &head_hash, hasher.as_ref())?;
        let tree_hash = match obj {
            crate::object::Object::Commit(c) => c.tree,
            _ => return Err(crate::error::ItehaasError::InvalidObject("HEAD is not commit".into())),
        };
        tree_builder::flatten_tree_root(repo, &tree_hash, hasher.as_ref())?
    } else {
        BTreeMap::new()
    };
    Ok(diff_maps(&head_map, &index_map))
}

/// Diff HEAD vs target commit
pub fn diff_head_vs_commit(repo: &Path, target_hash: &Hash) -> Result<Vec<DiffEntry>> {
    let algo = crate::config::read_hasher(repo)?;
    let hasher = crate::hash::new_hasher(algo)?;
    let head = crate::refs::resolve_head(repo)?;
    let head_map = if let Some(head_hash) = head {
        let obj = store::read_object(repo, &head_hash, hasher.as_ref())?;
        let tree_hash = match obj {
            crate::object::Object::Commit(c) => c.tree,
            _ => return Err(crate::error::ItehaasError::InvalidObject("HEAD is not commit".into())),
        };
        tree_builder::flatten_tree_root(repo, &tree_hash, hasher.as_ref())?
    } else {
        BTreeMap::new()
    };
    let target_obj = store::read_object(repo, target_hash, hasher.as_ref())?;
    let target_tree = match target_obj {
        crate::object::Object::Commit(c) => c.tree,
        _ => return Err(crate::error::ItehaasError::InvalidObject("target is not commit".into())),
    };
    let target_map = tree_builder::flatten_tree_root(repo, &target_tree, hasher.as_ref())?;
    Ok(diff_maps(&head_map, &target_map))
}

/// Get content for a path from a map (or working tree if None)
pub fn get_content_for_diff(
    repo: &Path,
    map: &BTreeMap<String, (Hash, u32)>,
    path: &str,
    hasher: &dyn Hasher,
) -> Result<Option<Vec<u8>>> {
    if let Some((hash, _)) = map.get(path) {
        let content = get_blob_content(repo, hash, hasher)?;
        Ok(Some(content))
    } else {
        Ok(None)
    }
}
