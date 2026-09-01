use std::collections::{BTreeSet, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{ItehaasError, Result};
use crate::hash::Hash;
use crate::object::store;

/// Resolve remote URL (filesystem path) to repo root PathBuf
pub fn resolve_remote_path(repo: &Path, url: &str) -> Result<PathBuf> {
    // For now, only filesystem paths. If url starts with http://, error.
    if url.starts_with("http://") || url.starts_with("https://") {
        return Err(ItehaasError::Other(format!(
            "http remote not yet supported: {}",
            url
        )));
    }
    // Handle file://
    let path_str = if url.starts_with("file://") {
        &url[7..]
    } else {
        url
    };
    let p = PathBuf::from(path_str);
    let abs = if p.is_absolute() {
        p
    } else {
        repo.join(&p)
    };
    // If path is the .itehaas dir itself, get parent
    let repo_root = if abs.ends_with(".itehaas") {
        abs.parent().unwrap().to_path_buf()
    } else {
        abs
    };
    // Canonicalize if exists to verify it's a repo
    let canonical = repo_root.canonicalize().map_err(|_| {
        ItehaasError::Other(format!("remote path not found: {}", url))
    })?;
    if !canonical.join(".itehaas").exists() {
        return Err(ItehaasError::Other(format!(
            "remote '{}' is not a repository (no .itehaas)",
            url
        )));
    }
    Ok(canonical)
}

/// Collect all objects reachable from a commit (including trees, blobs, and parent commits)
pub fn collect_reachable_objects(
    repo: &Path,
    start_hash: &Hash,
    hasher: &dyn crate::hash::Hasher,
    visited: &mut HashSet<String>,
    out: &mut Vec<Hash>,
) -> Result<()> {
    let key = start_hash.hex();
    if visited.contains(&key) {
        return Ok(());
    }
    visited.insert(key.clone());
    out.push(start_hash.clone());

    let obj = store::read_object(repo, start_hash, hasher)?;
    match obj {
        crate::object::Object::Commit(c) => {
            // Collect tree
            collect_tree_objects(repo, &c.tree, hasher, visited, out)?;
            // Collect parents
            for p in c.parents {
                collect_reachable_objects(repo, &p, hasher, visited, out)?;
            }
        }
        crate::object::Object::Tree(t) => {
            for e in t.entries {
                if e.mode == 0o040000 {
                    // Subtree
                    collect_tree_objects(repo, &e.hash, hasher, visited, out)?;
                } else {
                    let k = e.hash.hex();
                    if !visited.contains(&k) {
                        visited.insert(k.clone());
                        out.push(e.hash.clone());
                    }
                }
            }
        }
        crate::object::Object::Blob(_) => {
            // Already added
        }
        crate::object::Object::Tag(t) => {
            // Tag points to an object
            collect_reachable_objects(repo, &t.object, hasher, visited, out)?;
        }
    }
    Ok(())
}

fn collect_tree_objects(
    repo: &Path,
    tree_hash: &Hash,
    hasher: &dyn crate::hash::Hasher,
    visited: &mut HashSet<String>,
    out: &mut Vec<Hash>,
) -> Result<()> {
    let key = tree_hash.hex();
    if visited.contains(&key) {
        return Ok(());
    }
    visited.insert(key.clone());
    out.push(tree_hash.clone());

    let obj = store::read_object(repo, tree_hash, hasher)?;
    let tree = match obj {
        crate::object::Object::Tree(t) => t,
        _ => return Err(ItehaasError::InvalidObject(format!("{} is not a tree", tree_hash.hex()))),
    };
    for e in tree.entries {
        if e.mode == 0o040000 {
            collect_tree_objects(repo, &e.hash, hasher, visited, out)?;
        } else {
            let k = e.hash.hex();
            if !visited.contains(&k) {
                visited.insert(k.clone());
                out.push(e.hash.clone());
            }
        }
    }
    Ok(())
}

/// Transfer objects from src repo to dst repo that are reachable from start_hash but missing in dst
pub fn transfer_objects(
    src_repo: &Path,
    dst_repo: &Path,
    start_hash: &Hash,
) -> Result<usize> {
    let algo = crate::config::read_hasher(src_repo)?;
    let hasher = crate::hash::new_hasher(algo)?;
    let dst_algo = crate::config::read_hasher(dst_repo)?;
    if algo != dst_algo {
        return Err(ItehaasError::HashAlgoMismatch {
            expected: algo.as_str().to_string(),
            got: dst_algo.as_str().to_string(),
        });
    }
    let mut visited = HashSet::new();
    let mut reachable = Vec::new();
    collect_reachable_objects(src_repo, start_hash, hasher.as_ref(), &mut visited, &mut reachable)?;

    let mut transferred = 0;
    for h in reachable {
        let dst_path = store::object_path(dst_repo, &h);
        if dst_path.exists() {
            continue;
        }
        let src_path = store::object_path(src_repo, &h);
        if !src_path.exists() {
            return Err(ItehaasError::NotFound(h.hex()));
        }
        // Copy file
        if let Some(parent) = dst_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(&src_path, &dst_path)?;
        transferred += 1;
    }
    Ok(transferred)
}

/// Transfer all objects reachable from a set of refs (e.g., all heads)
pub fn transfer_all_heads(src_repo: &Path, dst_repo: &Path) -> Result<usize> {
    let heads_dir = src_repo.join(".itehaas").join("refs").join("heads");
    if !heads_dir.exists() {
        return Ok(0);
    }
    let mut total = 0;
    for entry in walkdir::WalkDir::new(&heads_dir).min_depth(1) {
        let entry = entry.map_err(|e| ItehaasError::Other(e.to_string()))?;
        let path = entry.path();
        if path.is_file() {
            let content = fs::read_to_string(path)?.trim().to_string();
            if content.is_empty() {
                continue;
            }
            let algo = crate::config::read_hasher(src_repo)?;
            let hash = Hash::from_hex(algo, &content)?;
            total += transfer_objects(src_repo, dst_repo, &hash)?;
        }
    }
    Ok(total)
}

/// List remote refs (refs/heads/*)
pub fn list_remote_refs(remote_repo: &Path) -> Result<Vec<(String, Hash)>> {
    let algo = crate::config::read_hasher(remote_repo)?;
    let heads_dir = remote_repo.join(".itehaas").join("refs").join("heads");
    if !heads_dir.exists() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    for entry in walkdir::WalkDir::new(&heads_dir).min_depth(1) {
        let entry = entry.map_err(|e| ItehaasError::Other(e.to_string()))?;
        let path = entry.path();
        if path.is_file() {
            let rel = path.strip_prefix(&heads_dir).unwrap();
            let name = rel.to_string_lossy().replace(std::path::MAIN_SEPARATOR, "/");
            let content = fs::read_to_string(path)?.trim().to_string();
            if content.is_empty() {
                continue;
            }
            let hash = Hash::from_hex(algo, &content)?;
            out.push((format!("refs/heads/{}", name), hash));
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(out)
}
