use std::collections::HashSet;
use std::fs;
use std::path::Path;

use crate::error::{ItehaasError, Result};
use crate::hash::Hash;
use crate::object::store;

/// Result of fsck
#[derive(Debug)]
pub struct FsckReport {
    pub total: usize,
    pub corrupted: Vec<String>,
    pub missing_refs: Vec<String>,
    pub unreachable: usize,
}

pub fn fsck(repo: &Path) -> Result<FsckReport> {
    let algo = crate::config::read_hasher(repo)?;
    let hasher = crate::hash::new_hasher(algo)?;
    let objects_dir = repo.join(".itehaas").join("objects");

    let mut total = 0;
    let mut corrupted = Vec::new();
    let mut seen_hashes = HashSet::new();

    // Scan loose objects
    for entry in walkdir::WalkDir::new(&objects_dir).min_depth(2).max_depth(3) {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        // Skip pack directory
        if path.components().any(|c| c.as_os_str() == "pack") {
            continue;
        }
        // Reconstruct hash from path: objects/ab/cdef...
        let parent = path.parent().and_then(|p| p.file_name()).map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let file = path.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        if parent.len() != 2 || file.len() != 62 {
            continue; // not a SHA256 loose object path (2/62)
        }
        let hex = format!("{}{}", parent, file);
        total += 1;
        seen_hashes.insert(hex.clone());

        // Try verify
        match Hash::from_hex(algo, &hex) {
            Ok(hash) => {
                if let Err(e) = store::verify_object(repo, &hash, hasher.as_ref()) {
                    corrupted.push(format!("{}: {}", hex, e));
                }
            }
            Err(e) => {
                corrupted.push(format!("{}: invalid hex {}", hex, e));
            }
        }
    }

    // Check refs: each ref should point to existing object
    let mut missing_refs = Vec::new();
    let refs_dir = repo.join(".itehaas").join("refs");
    if refs_dir.exists() {
        for entry in walkdir::WalkDir::new(&refs_dir) {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let content = fs::read_to_string(path).unwrap_or_default();
            let hex = content.trim().to_string();
            if hex.is_empty() {
                continue;
            }
            let rel = path.strip_prefix(repo.join(".itehaas")).unwrap_or(path).display().to_string();
            match Hash::from_hex(algo, &hex) {
                Ok(h) => {
                    let obj_path = store::object_path(repo, &h);
                    if !obj_path.exists() {
                        missing_refs.push(format!("{} -> {} missing object", rel, hex));
                    }
                }
                Err(_) => {
                    missing_refs.push(format!("{} -> {} invalid hash", rel, hex));
                }
            }
        }
    }

    // Check HEAD
    if let Ok(head) = crate::refs::read_head(repo) {
        match head {
            crate::refs::Head::Detached(h) => {
                if !store::object_path(repo, &h).exists() {
                    missing_refs.push(format!("HEAD detached {} missing", h.hex()));
                }
            }
            crate::refs::Head::Ref(r) | crate::refs::Head::Unborn(r) => {
                // If ref exists, already checked; if unborn, ignore
                let _ = r;
            }
        }
    }

    // Unreachable: reachable via refs/HEAD vs all objects (loose)
    // For now compute unreachable as total - reachable (approx)
    let reachable = {
        let mut set = HashSet::new();
        // Collect from all refs (heads, tags, remotes, HEAD)
        // Walk refs to collect
        let mut to_visit: Vec<Hash> = Vec::new();
        for entry in walkdir::WalkDir::new(&refs_dir) {
            let entry = match entry { Ok(e)=>e, Err(_)=>continue };
            if !entry.path().is_file() { continue; }
            let content = fs::read_to_string(entry.path()).unwrap_or_default();
            let hex = content.trim();
            if let Ok(h) = Hash::from_hex(algo, hex) {
                to_visit.push(h);
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
            set.insert(h.hex());
        }
        set.len()
    };
    let unreachable = if total > reachable { total - reachable } else { 0 };

    Ok(FsckReport { total, corrupted, missing_refs, unreachable })
}

pub fn count_objects(repo: &Path) -> Result<usize> {
    let objects_dir = repo.join(".itehaas").join("objects");
    let mut count = 0;
    for entry in walkdir::WalkDir::new(&objects_dir) {
        let e = match entry { Ok(v)=>v, Err(_)=>continue };
        if e.path().is_file() && !e.path().components().any(|c| c.as_os_str()=="pack") {
            // Check fanout path valid
            let parent = e.path().parent().and_then(|p| p.file_name()).map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            if parent.len()==2 { count+=1; }
        }
    }
    Ok(count)
}
