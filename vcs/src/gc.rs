use std::collections::HashSet;
use std::fs;
use std::path::Path;

use crate::error::Result;
use crate::hash::Hash;
use crate::object::store;

/// Garbage collect unreachable loose objects.
/// Returns number of pruned objects.
pub fn gc(repo: &Path, prune: bool) -> Result<usize> {
    let algo = crate::config::read_hasher(repo)?;
    let hasher = crate::hash::new_hasher(algo)?;
    let objects_dir = repo.join(".itehaas").join("objects");

    // Collect reachable
    let mut reachable: HashSet<String> = HashSet::new();
    let refs_dir = repo.join(".itehaas").join("refs");
    let mut to_visit: Vec<Hash> = Vec::new();

    if refs_dir.exists() {
        for entry in walkdir::WalkDir::new(&refs_dir) {
            let e = match entry { Ok(v)=>v, Err(_)=>continue };
            if !e.path().is_file() { continue; }
            let content = fs::read_to_string(e.path()).unwrap_or_default();
            let hex = content.trim().to_string();
            if hex.is_empty() { continue; }
            if let Ok(h) = Hash::from_hex(algo, &hex) {
                to_visit.push(h);
            }
        }
    }
    if let Ok(Some(h)) = crate::refs::resolve_head(repo) {
        to_visit.push(h);
    }

    let mut visited = HashSet::new();
    let mut out = Vec::new();
    for h in to_visit {
        let _ = crate::remote::collect_reachable_objects(repo, &h, hasher.as_ref(), &mut visited, &mut out);
    }
    for h in out {
        reachable.insert(h.hex());
    }

    // Also protect HEAD's reflog? Not needed.

    // Scan loose objects and delete unreachable if prune
    let mut pruned = 0;
    let mut to_delete: Vec<std::path::PathBuf> = Vec::new();
    for entry in walkdir::WalkDir::new(&objects_dir) {
        let e = match entry { Ok(v)=>v, Err(_)=>continue };
        let path = e.path();
        if !path.is_file() { continue; }
        if path.components().any(|c| c.as_os_str()=="pack") { continue; }
        let parent = path.parent().and_then(|p| p.file_name()).map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let file = path.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        if parent.len()!=2 || file.len()!=62 { continue; }
        let hex = format!("{}{}", parent, file);
        if !reachable.contains(&hex) {
            if prune {
                to_delete.push(path.to_path_buf());
            }
            pruned += 1;
        }
    }

    if prune {
        for p in to_delete {
            let _ = fs::remove_file(&p);
            // Try to remove empty fanout dir
            if let Some(parent) = p.parent() {
                let _ = fs::remove_dir(parent);
            }
        }
    }

    Ok(pruned)
}

pub fn list_unreachable(repo: &Path) -> Result<Vec<String>> {
    let algo = crate::config::read_hasher(repo)?;
    let hasher = crate::hash::new_hasher(algo)?;
    let objects_dir = repo.join(".itehaas").join("objects");
    let mut reachable = HashSet::new();
    let refs_dir = repo.join(".itehaas").join("refs");
    let mut to_visit = Vec::new();
    if refs_dir.exists() {
        for entry in walkdir::WalkDir::new(&refs_dir) {
            let e = match entry { Ok(v)=>v, Err(_)=>continue };
            if !e.path().is_file() { continue; }
            let content = fs::read_to_string(e.path()).unwrap_or_default();
            let hex = content.trim().to_string();
            if let Ok(h)=Hash::from_hex(algo, &hex) { to_visit.push(h); }
        }
    }
    if let Ok(Some(h))=crate::refs::resolve_head(repo) { to_visit.push(h); }
    let mut visited=HashSet::new();
    let mut out=Vec::new();
    for h in to_visit { let _=crate::remote::collect_reachable_objects(repo,&h,hasher.as_ref(),&mut visited,&mut out); }
    for h in out { reachable.insert(h.hex()); }
    let mut unreachable=Vec::new();
    for entry in walkdir::WalkDir::new(&objects_dir) {
        let e = match entry { Ok(v)=>v, Err(_)=>continue };
        let path=e.path();
        if !path.is_file() || path.components().any(|c| c.as_os_str()=="pack") { continue; }
        let parent = path.parent().and_then(|p| p.file_name()).map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let file = path.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        if parent.len()!=2 || file.len()!=62 { continue; }
        let hex=format!("{}{}",parent,file);
        if !reachable.contains(&hex) { unreachable.push(hex); }
    }
    Ok(unreachable)
}
