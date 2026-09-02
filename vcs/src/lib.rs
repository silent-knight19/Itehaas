pub mod checkout;
pub mod config;
pub mod diff;
pub mod error;
pub mod fsck;
pub mod gc;
pub mod hash;
pub mod ignore;
pub mod index;
pub mod merge;
pub mod object;
pub mod pack;
pub mod reflog;
pub mod refs;
pub mod remote;
pub mod reset;
pub mod restore;
pub mod stash;
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
    fs::create_dir_all(itehaas_dir.join("logs").join("refs").join("heads"))?;

    config::init_config(&repo, algo)?;

    // HEAD
    fs::write(itehaas_dir.join("HEAD"), "ref: refs/heads/main\n")?;
    // index empty
    fs::write(itehaas_dir.join("index"), b"")?;
    // init reflog for HEAD (zeros)
    {
        let algo = config::read_hasher(&repo).unwrap_or(HashAlgo::Sha256);
        let zero = "0".repeat(algo.hex_len());
        let _ = fs::create_dir_all(itehaas_dir.join("logs").join("refs").join("heads"));
        // No initial log entry needed until first commit; HEAD points to unborn.
        // We do not write entry to avoid noisy reflog.
        let _ = zero;
    }

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
