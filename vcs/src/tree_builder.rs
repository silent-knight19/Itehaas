use std::collections::BTreeMap;
use std::path::Path;

use crate::error::Result;
use crate::hash::{Hash, Hasher};
use crate::index::IndexEntry;
use crate::object::{Tree, TreeEntry};

/// Build trees from index entries, writing each tree object to store.
/// Returns root tree hash.
pub fn build_tree_from_index(
    repo: &Path,
    entries: &[&IndexEntry],
    hasher: &dyn Hasher,
) -> Result<Hash> {
    // Group entries by directory depth
    // Use recursive helper: build subtree for prefix
    // entries are already sorted by path

    // Convert to map of path -> (hash, mode) for quick
    // Build using BTreeMap of directory -> list of direct children

    // Helper: collect all directories and their direct children
    // We'll build via recursion from root.

    // Create a map: dir -> Vec<IndexEntry> where dir is parent dir
    // For flat entries like "a", "b/c", "b/d", root has "a" and dir "b"

    // Sort entries by path already (Index uses BTreeMap)

    // Use a function that builds tree for a given prefix
    fn build_dir(
        repo: &Path,
        entries: &[&IndexEntry],
        prefix: &str, // "" for root, else "src" or "src/lib"
        hasher: &dyn Hasher,
        depth: usize,
    ) -> Result<Hash> {
        // S6: depth limit to prevent stack overflow via deep nesting
        if depth > 100 {
            return Err(crate::error::ItehaasError::InvalidObject(format!("tree depth too deep: {}", depth)));
        }
        // Collect direct files and subdirs at this prefix
        let mut direct_files: Vec<&IndexEntry> = Vec::new();
        let mut subdirs: BTreeMap<String, Vec<&IndexEntry>> = BTreeMap::new();

        let prefix_with_slash = if prefix.is_empty() {
            "".to_string()
        } else {
            format!("{}/", prefix)
        };

        for e in entries {
            if prefix.is_empty() {
                // Check if entry is in root or subdir
                if let Some(slash_idx) = e.path.find('/') {
                    let dir_name = e.path[..slash_idx].to_string();
                    subdirs.entry(dir_name).or_default().push(*e);
                } else {
                    direct_files.push(*e);
                }
            } else {
                if !e.path.starts_with(&prefix_with_slash) {
                    continue;
                }
                let remainder = &e.path[prefix_with_slash.len()..];
                if let Some(slash_idx) = remainder.find('/') {
                    let dir_name = remainder[..slash_idx].to_string();
                    subdirs.entry(dir_name).or_default().push(*e);
                } else {
                    direct_files.push(*e);
                }
            }
        }

        let mut tree_entries: Vec<TreeEntry> = Vec::new();

        // Add files
        for f in direct_files {
            // Path inside this dir: just filename (after prefix)
            let name = if prefix.is_empty() {
                f.path.clone()
            } else {
                f.path[prefix_with_slash.len()..].to_string()
            };
            // Name should not contain '/' now
            let hash = f.hash_as(hasher.algo())?;
            let entry = TreeEntry::new(f.mode, name, hash)?;
            tree_entries.push(entry);
        }

        // Add subdirs (recursively build)
        for (dir_name, sub_entries) in subdirs {
            let sub_prefix = if prefix.is_empty() {
                dir_name.clone()
            } else {
                format!("{}/{}", prefix, dir_name)
            };
            let sub_hash = build_dir(repo, &sub_entries, &sub_prefix, hasher, depth + 1)?;
            let entry = TreeEntry::new(0o040000, dir_name, sub_hash)?;
            tree_entries.push(entry);
        }

        // S6: tree entries limit
        if tree_entries.len() > 10000 {
            return Err(crate::error::ItehaasError::InvalidObject(format!("tree too large: {}", tree_entries.len())));
        }

        // Now build tree for this directory
        let tree = Tree::new(tree_entries)?;
        let obj = crate::object::Object::Tree(tree);
        let hash = crate::object::store::write_object(repo, &obj, hasher)?;
        Ok(hash)
    }

    if entries.is_empty() {
        // Empty tree
        let tree = Tree::new(vec![])?;
        let obj = crate::object::Object::Tree(tree);
        let hash = crate::object::store::write_object(repo, &obj, hasher)?;
        return Ok(hash);
    }

    build_dir(repo, entries, "", hasher, 0)
}

/// Flatten a tree recursively into path -> hash map.
/// Used for status (HEAD tree vs index).
pub fn flatten_tree(
    repo: &Path,
    tree_hash: &Hash,
    hasher: &dyn Hasher,
    prefix: &str,
    out: &mut BTreeMap<String, (Hash, u32)>,
    depth: usize,
) -> Result<()> {
    let mut active = std::collections::BTreeSet::new();
    flatten_tree_with_ancestors(repo, tree_hash, hasher, prefix, out, depth, &mut active)
}

pub fn flatten_tree_with_ancestors(
    repo: &Path,
    tree_hash: &Hash,
    hasher: &dyn Hasher,
    prefix: &str,
    out: &mut BTreeMap<String, (Hash, u32)>,
    depth: usize,
    active_ancestors: &mut std::collections::BTreeSet<String>,
) -> Result<()> {
    // S6: depth limit
    if depth > 100 {
        return Err(crate::error::ItehaasError::InvalidObject(format!("tree depth too deep: {}", depth)));
    }
    // SEC-014: bound total flattened entries to prevent DAG expansion bomb
    if out.len() > 100_000 {
        return Err(crate::error::ItehaasError::InvalidObject("flattened tree too large (exceeded 100,000 entries)".into()));
    }
    // Cycle detection
    let hex = tree_hash.hex();
    if active_ancestors.contains(&hex) {
        return Err(crate::error::ItehaasError::InvalidObject(format!("cycle detected in tree: {}", hex)));
    }
    active_ancestors.insert(hex.clone());

    let obj = crate::object::store::read_object(repo, tree_hash, hasher)?;
    let tree = match obj {
        crate::object::Object::Tree(t) => t,
        _ => {
            active_ancestors.remove(&hex);
            return Err(crate::error::ItehaasError::InvalidObject(format!(
                "expected tree, got {}",
                obj.object_type()
            )))
        }
    };
    for e in tree.entries {
        let full_path = if prefix.is_empty() {
            e.name.clone()
        } else {
            format!("{}/{}", prefix, e.name)
        };
        if e.mode == 0o040000 {
            // Subdirectory — recurse
            flatten_tree_with_ancestors(repo, &e.hash, hasher, &full_path, out, depth + 1, active_ancestors)?;
        } else {
            if out.len() >= 100_000 {
                active_ancestors.remove(&hex);
                return Err(crate::error::ItehaasError::InvalidObject("flattened tree too large (exceeded 100,000 entries)".into()));
            }
            out.insert(full_path, (e.hash, e.mode));
        }
    }
    active_ancestors.remove(&hex);
    Ok(())
}

/// Convenience: flatten entire tree from root
pub fn flatten_tree_root(
    repo: &Path,
    tree_hash: &Hash,
    hasher: &dyn Hasher,
) -> Result<BTreeMap<String, (Hash, u32)>> {
    let mut map = BTreeMap::new();
    flatten_tree(repo, tree_hash, hasher, "", &mut map, 0)?;
    Ok(map)
}
