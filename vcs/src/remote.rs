use std::collections::{BTreeSet, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{ItehaasError, Result};
use crate::hash::Hash;
use crate::object::store;

pub mod http;

/// Whether URL is HTTP(S) — used to branch to http transport.
pub fn is_http_url(url: &str) -> bool {
    url.starts_with("http://") || url.starts_with("https://")
}

/// Normalize a URL by trimming trailing slashes.
pub fn normalize_http_url(url: &str) -> String {
    url.trim_end_matches('/').to_string()
}

/// Resolve remote URL (filesystem path) to repo root PathBuf
pub fn resolve_remote_path(repo: &Path, url: &str) -> Result<PathBuf> {
    // HTTP remotes are handled by remote::http module; this helper only resolves FS.
    if is_http_url(url) {
        return Err(ItehaasError::Other(format!(
            "http remote not yet supported via filesystem resolver (use http transport): {}",
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

/// Bounds for reachability walks (FSEC-008): a malicious graph must not cause
/// stack overflow or unbounded work. The commit/tag walk below is iterative (heap
/// stack, no recursion depth issue) and bounded by object count; tree nesting keeps
/// an explicit depth cap since trees recurse.
const MAX_REACH_DEPTH: usize = 2048;
const MAX_REACH_OBJECTS: usize = 100_000;

fn check_reach_budget(visited: &HashSet<String>) -> Result<()> {
    if visited.len() >= MAX_REACH_OBJECTS {
        return Err(ItehaasError::InvalidObject("reachability walk too large (exceeded 100,000 objects)".into()));
    }
    Ok(())
}

/// Collect all objects reachable from a commit (including trees, blobs, and parent commits)
pub fn collect_reachable_objects(
    repo: &Path,
    start_hash: &Hash,
    hasher: &dyn crate::hash::Hasher,
    visited: &mut HashSet<String>,
    out: &mut Vec<Hash>,
) -> Result<()> {
    // S6-fresh: iterative work-stack instead of recursion. A malicious linear chain of
    // commits previously recursed once per commit (stack overflow); legitimate long
    // histories must keep working, so the parent chain is NOT depth-capped — total
    // work is bounded by the visited-object budget (each hash is read at most once).
    let mut stack: Vec<Hash> = vec![start_hash.clone()];
    while let Some(h) = stack.pop() {
        check_reach_budget(visited)?;
        let key = h.hex();
        if visited.contains(&key) {
            continue;
        }
        visited.insert(key);
        out.push(h.clone());

        let obj = store::read_object(repo, &h, hasher)?;
        match obj {
            crate::object::Object::Commit(c) => {
                collect_tree_objects(repo, &c.tree, hasher, visited, out, 0)?;
                for p in c.parents {
                    stack.push(p);
                }
            }
            crate::object::Object::Tree(t) => {
                for e in t.entries {
                    if e.mode == 0o040000 {
                        collect_tree_objects(repo, &e.hash, hasher, visited, out, 0)?;
                    } else {
                        let k = e.hash.hex();
                        if !visited.contains(&k) {
                            check_reach_budget(visited)?;
                            visited.insert(k);
                            out.push(e.hash.clone());
                        }
                    }
                }
            }
            crate::object::Object::Blob(_) => {
                // Already added
            }
            crate::object::Object::Tag(t) => {
                stack.push(t.object);
            }
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
    depth: usize,
) -> Result<()> {
    // S6-fresh: same bounds for the tree-only walk.
    if depth > MAX_REACH_DEPTH {
        return Err(ItehaasError::InvalidObject(format!("reachability walk too deep: {}", depth)));
    }
    if visited.len() >= MAX_REACH_OBJECTS {
        return Err(ItehaasError::InvalidObject("reachability walk too large (exceeded 100,000 objects)".into()));
    }
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
            collect_tree_objects(repo, &e.hash, hasher, visited, out, depth + 1)?;
        } else {
            let k = e.hash.hex();
            if !visited.contains(&k) {
                if visited.len() >= MAX_REACH_OBJECTS {
                    return Err(ItehaasError::InvalidObject("reachability walk too large (exceeded 100,000 objects)".into()));
                }
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
