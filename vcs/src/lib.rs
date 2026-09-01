pub mod config;
pub mod error;
pub mod hash;
pub mod index;
pub mod object;
pub mod refs;
pub mod status;
pub mod tree_builder;

use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{ItehaasError, Result};
use crate::hash::HashAlgo;

/// Find .itehaas directory upwards from path.
pub fn find_repo(start: &Path) -> Option<PathBuf> {
    let mut cur = start.canonicalize().ok()?;
    loop {
        if cur.join(".itehaas").exists() {
            return Some(cur);
        }
        if let Some(parent) = cur.parent() {
            cur = parent.to_path_buf();
        } else {
            return None;
        }
    }
}

/// Initialize repository at path with given algo.
pub fn init(repo_path: &Path, algo: HashAlgo) -> Result<PathBuf> {
    let repo = if repo_path.as_os_str().is_empty() {
        std::env::current_dir()?
    } else {
        repo_path.to_path_buf()
    };
    // Ensure directory exists
    fs::create_dir_all(&repo)?;
    let itehaas_dir = repo.join(".itehaas");
    if itehaas_dir.exists() {
        return Err(ItehaasError::Other(format!(
            "already a repository at {}",
            itehaas_dir.display()
        )));
    }
    fs::create_dir_all(itehaas_dir.join("objects").join("pack"))?;
    fs::create_dir_all(itehaas_dir.join("refs").join("heads"))?;
    fs::create_dir_all(itehaas_dir.join("refs").join("tags"))?;
    fs::create_dir_all(itehaas_dir.join("refs").join("remotes"))?;

    config::init_config(&repo, algo)?;

    // HEAD
    fs::write(itehaas_dir.join("HEAD"), "ref: refs/heads/main\n")?;
    // index empty
    fs::write(itehaas_dir.join("index"), b"")?;

    Ok(repo.canonicalize().unwrap_or(repo))
}

/// Force init if exists: remove and re-init (used only if --force)
pub fn init_force(repo_path: &Path, algo: HashAlgo) -> Result<PathBuf> {
    let repo = if repo_path.as_os_str().is_empty() {
        std::env::current_dir()?
    } else {
        repo_path.to_path_buf()
    };
    let itehaas_dir = repo.join(".itehaas");
    if itehaas_dir.exists() {
        fs::remove_dir_all(&itehaas_dir)?;
    }
    init(repo_path, algo)
}
