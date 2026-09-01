use std::fs;
use std::path::Path;

use crate::error::{ItehaasError, Result};
use crate::hash::HashAlgo;

const DEFAULT_HASHER: &str = "sha256";

pub fn read_hasher(repo: &Path) -> Result<HashAlgo> {
    let config_path = repo.join(".itehaas").join("config");
    if !config_path.exists() {
        return Ok(HashAlgo::Sha256);
    }
    let content = fs::read_to_string(&config_path)?;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("hasher") {
            if let Some(val) = trimmed.split('=').nth(1) {
                let v = val.trim().trim_matches('"').trim_matches('\'');
                return HashAlgo::from_str(v);
            }
        }
    }
    Ok(HashAlgo::Sha256)
}

pub fn write_config(repo: &Path, hasher: HashAlgo) -> Result<()> {
    let config_path = repo.join(".itehaas").join("config");
    let content = format!(
        "[core]\n\thasher = {}\n\trepositoryformatversion = 1\n",
        hasher.as_str()
    );
    fs::write(config_path, content)?;
    Ok(())
}

pub fn init_config(repo: &Path, hasher: HashAlgo) -> Result<()> {
    write_config(repo, hasher)
}
