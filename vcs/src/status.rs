use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

use walkdir::WalkDir;

use crate::error::Result;
use crate::hash::{Hash, Hasher};
use crate::index::{file_mode, Index};
use crate::object::store;
use crate::tree_builder;

#[derive(Debug, Default)]
pub struct Status {
    /// Files staged for commit: index differs from HEAD
    pub staged: Vec<StatusEntry>,
    /// Files not staged: working tree differs from index
    pub not_staged: Vec<StatusEntry>,
    /// Untracked files: in working tree but not in index nor HEAD
    pub untracked: Vec<String>,
    /// Branch name
    pub branch: Option<String>,
    /// HEAD commit hash if exists
    pub head_hash: Option<Hash>,
}

#[derive(Debug, Clone)]
pub struct StatusEntry {
    pub path: String,
    pub status: String, // "new file", "modified", "deleted"
}

impl Status {
    pub fn is_clean(&self) -> bool {
        self.staged.is_empty() && self.not_staged.is_empty() && self.untracked.is_empty()
    }
}

/// Compute status: compares HEAD tree, index, working tree.
pub fn status(repo: &Path) -> Result<Status> {
    let algo = crate::config::read_hasher(repo)?;
    let hasher = crate::hash::new_hasher(algo)?;
    let index = Index::load(repo)?;
    let head = crate::refs::resolve_head(repo)?;
    let branch = crate::refs::current_branch(repo)?;

    // Build HEAD file map if exists
    let head_map: BTreeMap<String, (Hash, u32)> = if let Some(head_hash) = &head {
        let commit_obj = store::read_object(repo, head_hash, hasher.as_ref())?;
        let tree_hash = match commit_obj {
            crate::object::Object::Commit(c) => c.tree,
            _ => {
                return Err(crate::error::ItehaasError::InvalidObject(
                    "HEAD is not a commit".into(),
                ))
            }
        };
        tree_builder::flatten_tree_root(repo, &tree_hash, hasher.as_ref())?
    } else {
        BTreeMap::new()
    };

    // Build index map
    let mut index_map: BTreeMap<String, (Hash, u32)> = BTreeMap::new();
    for e in index.entries_sorted() {
        let h = e.hash_as(algo)?;
        index_map.insert(e.path.clone(), (h, e.mode));
    }

    // Build working tree map (hash each file)
    let mut wt_map: BTreeMap<String, (Hash, u32)> = BTreeMap::new();
    let mut wt_files_set: BTreeSet<String> = BTreeSet::new();
    for entry in WalkDir::new(repo).min_depth(1).into_iter().filter_entry(|e| {
        // Skip .itehaas directory
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
        wt_files_set.insert(rel_str.clone());
        // Read file and hash as blob
        let data = fs::read(path)?;
        let blob = crate::object::Blob::new(data);
        let obj = crate::object::Object::Blob(blob);
        let hash = obj.hash(hasher.as_ref());
        let mode = file_mode(&fs::metadata(path)?);
        wt_map.insert(rel_str, (hash, mode));
    }

    // Compute staged: index vs HEAD
    let mut staged: Vec<StatusEntry> = Vec::new();
    let all_staged_keys: BTreeSet<String> = head_map
        .keys()
        .chain(index_map.keys())
        .cloned()
        .collect();
    for key in all_staged_keys {
        let head_entry = head_map.get(&key);
        let index_entry = index_map.get(&key);
        match (head_entry, index_entry) {
            (None, Some(_)) => staged.push(StatusEntry {
                path: key,
                status: "new file".into(),
            }),
            (Some(_), None) => staged.push(StatusEntry {
                path: key,
                status: "deleted".into(),
            }),
            (Some((h_hash, h_mode)), Some((i_hash, i_mode)))
                if h_hash.hex() != i_hash.hex() || h_mode != i_mode =>
            {
                staged.push(StatusEntry {
                    path: key,
                    status: "modified".into(),
                })
            }
            _ => {}
        }
    }

    // Compute not_staged: working tree vs index
    let mut not_staged: Vec<StatusEntry> = Vec::new();
    let all_not_staged_keys: BTreeSet<String> = index_map
        .keys()
        .chain(wt_map.keys())
        .cloned()
        .collect();
    for key in all_not_staged_keys {
        let index_entry = index_map.get(&key);
        let wt_entry = wt_map.get(&key);
        match (index_entry, wt_entry) {
            (Some(_), None) => not_staged.push(StatusEntry {
                path: key,
                status: "deleted".into(),
            }),
            (Some((i_hash, i_mode)), Some((w_hash, w_mode)))
                if i_hash.hex() != w_hash.hex() || i_mode != w_mode =>
            {
                not_staged.push(StatusEntry {
                    path: key,
                    status: "modified".into(),
                })
            }
            _ => {}
        }
    }

    // Untracked: in wt but not in index nor head
    let mut untracked: Vec<String> = Vec::new();
    for key in wt_files_set {
        if !index_map.contains_key(&key) && !head_map.contains_key(&key) {
            untracked.push(key);
        }
    }

    Ok(Status {
        staged,
        not_staged,
        untracked,
        branch,
        head_hash: head,
    })
}
