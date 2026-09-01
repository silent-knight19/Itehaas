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

pub fn read_user(repo: &Path) -> Result<(Option<String>, Option<String>)> {
    let config_path = repo.join(".itehaas").join("config");
    if !config_path.exists() {
        return Ok((None, None));
    }
    let content = fs::read_to_string(&config_path)?;
    let mut in_user = false;
    let mut name: Option<String> = None;
    let mut email: Option<String> = None;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            in_user = trimmed == "[user]";
            continue;
        }
        if in_user {
            if trimmed.starts_with("name") {
                if let Some(val) = trimmed.split('=').nth(1) {
                    name = Some(val.trim().trim_matches('"').trim_matches('\'').to_string());
                }
            } else if trimmed.starts_with("email") {
                if let Some(val) = trimmed.split('=').nth(1) {
                    email = Some(val.trim().trim_matches('"').trim_matches('\'').to_string());
                }
            }
        }
    }
    Ok((name, email))
}

pub fn write_user(repo: &Path, name: &str, email: &str) -> Result<()> {
    let config_path = repo.join(".itehaas").join("config");
    let hasher = read_hasher(repo)?;
    let mut content = if config_path.exists() {
        fs::read_to_string(&config_path)?
    } else {
        format!("[core]\n\thasher = {}\n\trepositoryformatversion = 1\n", hasher.as_str())
    };
    // Ensure [user] section exists; simple append/replace
    if content.contains("[user]") {
        // Replace existing name/email if present — simple rewrite by lines
        let mut out = String::new();
        let mut in_user = false;
        let mut has_name = false;
        let mut has_email = false;
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with('[') {
                if in_user {
                    if !has_name {
                        out.push_str(&format!("\tname = {}\n", name));
                    }
                    if !has_email {
                        out.push_str(&format!("\temail = {}\n", email));
                    }
                }
                in_user = trimmed == "[user]";
                has_name = false;
                has_email = false;
            }
            if in_user {
                if trimmed.starts_with("name") {
                    out.push_str(&format!("\tname = {}\n", name));
                    has_name = true;
                    continue;
                } else if trimmed.starts_with("email") {
                    out.push_str(&format!("\temail = {}\n", email));
                    has_email = true;
                    continue;
                }
            }
            out.push_str(line);
            out.push('\n');
        }
        // Handle trailing
        if in_user {
            if !has_name {
                out.push_str(&format!("\tname = {}\n", name));
            }
            if !has_email {
                out.push_str(&format!("\temail = {}\n", email));
            }
        }
        content = out;
    } else {
        if !content.ends_with('\n') {
            content.push('\n');
        }
        content.push_str(&format!("[user]\n\tname = {}\n\temail = {}\n", name, email));
    }
    fs::write(config_path, content)?;
    Ok(())
}
