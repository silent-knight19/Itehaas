use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{ItehaasError, Result};
use crate::hash::{Hash, HashAlgo};
use crate::reflog;

/// HEAD can be symbolic ref or detached hash or unborn
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Head {
    /// Symbolic: ref: refs/heads/<branch>
    Ref(String),
    /// Detached: direct hash
    Detached(Hash),
    /// Unborn: points to ref that doesn't exist yet
    Unborn(String),
}

impl Head {
    pub fn is_unborn(&self) -> bool {
        matches!(self, Head::Unborn(_))
    }
    pub fn branch_name(&self) -> Option<String> {
        match self {
            Head::Ref(r) | Head::Unborn(r) => {
                if let Some(stripped) = r.strip_prefix("refs/heads/") {
                    Some(stripped.to_string())
                } else {
                    Some(r.clone())
                }
            }
            Head::Detached(_) => None,
        }
    }
}

/// Read HEAD file
pub fn read_head(repo: &Path) -> Result<Head> {
    let head_path = repo.join(".itehaas").join("HEAD");
    if !head_path.exists() {
        return Err(ItehaasError::RepoNotFound(
            repo.join(".itehaas").display().to_string(),
        ));
    }
    let content = fs::read_to_string(&head_path)?.trim().to_string();
    if content.starts_with("ref: ") {
        let target = content["ref: ".len()..].trim().to_string();
        // Check if ref exists
        let ref_path = repo.join(".itehaas").join(&target);
        if ref_path.exists() {
            Ok(Head::Ref(target))
        } else {
            Ok(Head::Unborn(target))
        }
    } else if content.is_empty() {
        Err(ItehaasError::InvalidObject("empty HEAD".into()))
    } else {
        // Try parse as hash (detached)
        // Need algo to validate length — infer from config length
        let algo = crate::config::read_hasher(repo)?;
        let hash = Hash::from_hex(algo, content.trim())?;
        Ok(Head::Detached(hash))
    }
}

/// Write HEAD as symbolic ref
pub fn write_head_ref(repo: &Path, ref_name: &str) -> Result<()> {
    let head_path = repo.join(".itehaas").join("HEAD");
    let content = format!("ref: {}\n", ref_name);
    // Atomic
    let dir = head_path.parent().unwrap();
    let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
    use std::io::Write;
    tmp.write_all(content.as_bytes())?;
    tmp.flush()?;
    tmp.persist(&head_path).map_err(|e| ItehaasError::Io(e.error))?;
    Ok(())
}

/// Write HEAD as symbolic ref with reflog log for HEAD
pub fn write_head_ref_with_log(repo: &Path, ref_name: &str, message: &str) -> Result<()> {
    // Capture old HEAD resolved hash for log
    let old = resolve_head(repo).unwrap_or(None);
    let new = read_ref(repo, ref_name).unwrap_or(None);
    write_head_ref(repo, ref_name)?;
    // For HEAD reflog when moving symbolic pointer, log with new hash (branch tip)
    if let Some(new_hash) = new {
        let _ = reflog::append_reflog(repo, "HEAD", old.as_ref(), Some(&new_hash), message);
    } else {
        // unborn -> just log with zero new
        let _ = reflog::append_reflog(repo, "HEAD", old.as_ref(), None, message);
    }
    Ok(())
}

/// Write HEAD detached
pub fn write_head_detached(repo: &Path, hash: &Hash) -> Result<()> {
    let head_path = repo.join(".itehaas").join("HEAD");
    let content = format!("{}\n", hash.hex());
    let dir = head_path.parent().unwrap();
    let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
    use std::io::Write;
    tmp.write_all(content.as_bytes())?;
    tmp.flush()?;
    tmp.persist(&head_path).map_err(|e| ItehaasError::Io(e.error))?;
    Ok(())
}

/// Write HEAD detached with reflog
pub fn write_head_detached_with_log(
    repo: &Path,
    hash: &Hash,
    message: &str,
) -> Result<()> {
    let old = resolve_head(repo).unwrap_or(None);
    write_head_detached(repo, hash)?;
    let _ = reflog::append_reflog(repo, "HEAD", old.as_ref(), Some(hash), message);
    Ok(())
}

/// Read ref file (e.g., refs/heads/main) -> Option<Hash>
pub fn read_ref(repo: &Path, ref_name: &str) -> Result<Option<Hash>> {
    let algo = crate::config::read_hasher(repo)?;
    let ref_path = repo.join(".itehaas").join(ref_name);
    if !ref_path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&ref_path)?.trim().to_string();
    if content.is_empty() {
        return Ok(None);
    }
    let hash = Hash::from_hex(algo, &content)?;
    Ok(Some(hash))
}

/// Write ref file
pub fn write_ref(repo: &Path, ref_name: &str, hash: &Hash) -> Result<()> {
    let ref_path = repo.join(".itehaas").join(ref_name);
    if let Some(parent) = ref_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let content = format!("{}\n", hash.hex());
    let dir = ref_path.parent().unwrap();
    let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
    use std::io::Write;
    tmp.write_all(content.as_bytes())?;
    tmp.flush()?;
    tmp.persist(&ref_path).map_err(|e| ItehaasError::Io(e.error))?;
    Ok(())
}

/// Write ref with reflog entry (branch + HEAD if HEAD points to this ref)
pub fn write_ref_with_log(
    repo: &Path,
    ref_name: &str,
    hash: &Hash,
    message: &str,
) -> Result<()> {
    let old = read_ref(repo, ref_name)?.clone();
    write_ref(repo, ref_name, hash)?;
    // branch log
    let _ = reflog::append_reflog(repo, ref_name, old.as_ref(), Some(hash), message);
    // HEAD log if HEAD is symbolic to this ref
    if let Ok(head) = read_head(repo) {
        match head {
            Head::Ref(r) if r == ref_name => {
                let _ = reflog::append_reflog(repo, "HEAD", old.as_ref(), Some(hash), message);
            }
            Head::Unborn(r) if r == ref_name => {
                let _ = reflog::append_reflog(repo, "HEAD", old.as_ref(), Some(hash), message);
            }
            _ => {}
        }
    }
    Ok(())
}

/// Resolve HEAD to commit hash if exists, else None (unborn)
pub fn resolve_head(repo: &Path) -> Result<Option<Hash>> {
    match read_head(repo)? {
        Head::Ref(r) | Head::Unborn(r) => read_ref(repo, &r),
        Head::Detached(h) => Ok(Some(h)),
    }
}

/// Get current branch name if symbolic, else None
pub fn current_branch(repo: &Path) -> Result<Option<String>> {
    match read_head(repo)? {
        Head::Ref(r) | Head::Unborn(r) => {
            if let Some(name) = r.strip_prefix("refs/heads/") {
                Ok(Some(name.to_string()))
            } else {
                Ok(Some(r))
            }
        }
        Head::Detached(_) => Ok(None),
    }
}

/// Resolve a rev: branch name, hash, or HEAD. Phase 2 minimal: HEAD or hash.
pub fn resolve_rev(repo: &Path, rev: &str) -> Result<Option<Hash>> {
    // Handle HEAD~n suffix
    if rev.contains('~') {
        let parts: Vec<&str> = rev.splitn(2, '~').collect();
        let base = parts[0];
        let suffix = parts[1];
        let n: usize = if suffix.is_empty() {
            1
        } else {
            suffix.parse().unwrap_or(1)
        };
        let base_hash_opt = resolve_rev(repo, if base.is_empty() { "HEAD" } else { base })?;
        if let Some(mut cur) = base_hash_opt {
            let algo = crate::config::read_hasher(repo)?;
            let hasher = crate::hash::new_hasher(algo)?;
            for _ in 0..n {
                let obj = crate::object::store::read_object(repo, &cur, hasher.as_ref())?;
                match obj {
                    crate::object::Object::Commit(c) => {
                        if c.parents.is_empty() {
                            return Ok(None);
                        }
                        cur = c.parents[0].clone();
                    }
                    _ => return Ok(None),
                }
            }
            return Ok(Some(cur));
        } else {
            return Ok(None);
        }
    }
    if rev == "HEAD" {
        return resolve_head(repo);
    }
    // Try as branch name (exact)
    if let Ok(Some(h)) = read_ref(repo, &format!("refs/heads/{}", rev)) {
        return Ok(Some(h));
    }
    // Try as tag
    if let Ok(Some(h)) = read_ref(repo, &format!("refs/tags/{}", rev)) {
        // Tags may point to tag object; if tag object, try to resolve to commit?
        // For rev resolution, return tag hash as is (could be tag object or commit)
        return Ok(Some(h));
    }
    // Try as direct hash (full or short)
    let algo = crate::config::read_hasher(repo)?;
    // Full hash
    if rev.len() == algo.hex_len() && rev.chars().all(|c| c.is_ascii_hexdigit()) {
        if let Ok(h) = Hash::from_hex(algo, rev) {
            let path = crate::object::store::object_path(repo, &h);
            if path.exists() {
                return Ok(Some(h));
            }
        }
    }
    // Short hash (7 to hex_len-1)
    if rev.len() >= 4 && rev.len() < algo.hex_len() && rev.chars().all(|c| c.is_ascii_hexdigit()) {
        if let Some(h) = resolve_short_hash(repo, rev, algo)? {
            return Ok(Some(h));
        }
    }
    Ok(None)
}

fn resolve_short_hash(repo: &Path, prefix: &str, algo: HashAlgo) -> Result<Option<Hash>> {
    let objects_dir = repo.join(".itehaas").join("objects");
    if !objects_dir.exists() {
        return Ok(None);
    }
    let lower = prefix.to_lowercase();
    let mut candidates = Vec::new();
    for entry in walkdir::WalkDir::new(&objects_dir).min_depth(2).max_depth(2) {
        let e = match entry {
            Ok(v) => v,
            Err(_) => continue,
        };
        let p = e.path();
        if p.is_file() {
            let parent = p.parent().and_then(|p| p.file_name()).map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            let file = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            let hex = format!("{}{}", parent, file);
            if hex.starts_with(&lower) && hex.len() == algo.hex_len() {
                if let Ok(h) = Hash::from_hex(algo, &hex) {
                    candidates.push(h);
                    if candidates.len() > 1 {
                        // Ambiguous
                        return Err(ItehaasError::Other(format!("ambiguous short hash: {}", prefix)));
                    }
                }
            }
        }
    }
    if candidates.len() == 1 {
        Ok(Some(candidates.into_iter().next().unwrap()))
    } else {
        Ok(None)
    }
}

/// List all branches (refs/heads/*)
pub fn list_branches(repo: &Path) -> Result<Vec<String>> {
    let heads_dir = repo.join(".itehaas").join("refs").join("heads");
    if !heads_dir.exists() {
        return Ok(vec![]);
    }
    let mut branches = Vec::new();
    for entry in walkdir::WalkDir::new(&heads_dir).min_depth(1) {
        let entry = entry.map_err(|e| ItehaasError::Other(e.to_string()))?;
        let path = entry.path();
        if path.is_file() {
            let rel = path.strip_prefix(&heads_dir).unwrap();
            let name = rel.to_string_lossy().replace(std::path::MAIN_SEPARATOR, "/");
            branches.push(name);
        }
    }
    branches.sort();
    Ok(branches)
}

/// Validate branch name
pub fn validate_branch_name(name: &str) -> Result<()> {
    if name.is_empty() {
        return Err(ItehaasError::InvalidObject("branch name cannot be empty".into()));
    }
    if name == "HEAD" {
        return Err(ItehaasError::InvalidObject("branch name cannot be HEAD".into()));
    }
    if name.starts_with('/') || name.ends_with('/') || name.contains("//") {
        return Err(ItehaasError::InvalidObject(format!("invalid branch name: {}", name)));
    }
    if name.contains(' ') || name.contains("..") || name.contains('~') || name.contains('^') || name.contains(':') || name.contains('?') || name.contains('*') || name.contains('[') || name.contains('\\') {
        return Err(ItehaasError::InvalidObject(format!("invalid branch name: {}", name)));
    }
    if name.ends_with(".lock") || name.contains("@{") {
        return Err(ItehaasError::InvalidObject(format!("invalid branch name: {}", name)));
    }
    // No component starting with .
    for part in name.split('/') {
        if part.is_empty() || part.starts_with('.') {
            return Err(ItehaasError::InvalidObject(format!("invalid branch name: {}", name)));
        }
    }
    Ok(())
}

/// Create a new branch at given hash
pub fn create_branch(repo: &Path, name: &str, hash: &Hash) -> Result<()> {
    validate_branch_name(name)?;
    let ref_name = format!("refs/heads/{}", name);
    if read_ref(repo, &ref_name)?.is_some() {
        return Err(ItehaasError::Other(format!("branch '{}' already exists", name)));
    }
    write_ref(repo, &ref_name, hash)
}

/// Delete a branch
pub fn delete_branch(repo: &Path, name: &str) -> Result<()> {
    validate_branch_name(name)?;
    let ref_name = format!("refs/heads/{}", name);
    let current = current_branch(repo)?;
    if let Some(cur) = current {
        if cur == name {
            return Err(ItehaasError::Other(format!("cannot delete branch '{}' which is currently checked out", name)));
        }
    }
    let ref_path = repo.join(".itehaas").join(&ref_name);
    if !ref_path.exists() {
        return Err(ItehaasError::Other(format!("branch '{}' not found", name)));
    }
    std::fs::remove_file(&ref_path)?;
    // Clean up empty parent dirs (e.g., refs/heads/feature)
    if let Some(parent) = ref_path.parent() {
        let _ = std::fs::remove_dir(parent); // ignore if not empty
    }
    Ok(())
}
