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
    pub status: DiffStatus,
    pub old_hash: Option<Hash>,
    pub new_hash: Option<Hash>,
    pub old_mode: Option<u32>,
    pub new_mode: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DiffStatus {
    Added,
    Deleted,
    Modified,
    TypeChange, // mode changed
}

impl DiffEntry {
    pub fn status_str(&self) -> &'static str {
        match self.status {
            DiffStatus::Added => "added",
            DiffStatus::Deleted => "deleted",
            DiffStatus::Modified => "modified",
            DiffStatus::TypeChange => "typechange",
        }
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
                status: DiffStatus::Added,
                old_hash: None,
                new_hash: Some(h.clone()),
                old_mode: None,
                new_mode: Some(*m),
            }),
            (Some((h, m)), None) => result.push(DiffEntry {
                path: k,
                status: DiffStatus::Deleted,
                old_hash: Some(h.clone()),
                new_hash: None,
                old_mode: Some(*m),
                new_mode: None,
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
                        status,
                        old_hash: Some(oh.clone()),
                        new_hash: Some(nh.clone()),
                        old_mode: Some(*om),
                        new_mode: Some(*nm),
                    });
                }
            }
            (None, None) => {}
        }
    }
    result
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
        !crate::index::should_ignore(rel)
    }) {
        let entry = entry.map_err(|e| crate::error::ItehaasError::Other(e.to_string()))?;
        let path = entry.path();
        if path.is_dir() {
            continue;
        }
        let rel = path.strip_prefix(repo).unwrap();
        if crate::index::should_ignore(rel) {
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
