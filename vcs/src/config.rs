use std::fs;
use std::path::{Path, PathBuf};

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

pub fn global_config_path() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("ITEHAAS_CONFIG_GLOBAL") {
        if !p.trim().is_empty() {
            return Some(PathBuf::from(p.trim()));
        }
    }
    if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
        Some(PathBuf::from(home).join(".itehaasconfig"))
    } else {
        None
    }
}

pub fn read_user_from_file(config_path: &Path) -> Result<(Option<String>, Option<String>)> {
    if !config_path.exists() {
        return Ok((None, None));
    }
    let content = fs::read_to_string(config_path)?;
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

pub fn read_global_user() -> Result<(Option<String>, Option<String>)> {
    if let Some(path) = global_config_path() {
        read_user_from_file(&path)
    } else {
        Ok((None, None))
    }
}

pub fn read_user(repo: &Path) -> Result<(Option<String>, Option<String>)> {
    let local_path = repo.join(".itehaas").join("config");
    let (local_name, local_email) = read_user_from_file(&local_path)?;
    if local_name.is_some() && local_email.is_some() {
        return Ok((local_name, local_email));
    }
    let (global_name, global_email) = read_global_user()?;
    Ok((
        local_name.or(global_name),
        local_email.or(global_email),
    ))
}

pub fn write_user_to_file(config_path: &Path, name: Option<&str>, email: Option<&str>) -> Result<()> {
    if let Some(parent) = config_path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            fs::create_dir_all(parent)?;
        }
    }
    let content = if config_path.exists() {
        fs::read_to_string(config_path)?
    } else {
        String::new()
    };

    if content.contains("[user]") {
        let mut out = String::new();
        let mut in_user = false;
        let mut has_name = false;
        let mut has_email = false;
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with('[') {
                if in_user {
                    if let Some(n) = name {
                        if !has_name {
                            out.push_str(&format!("\tname = {}\n", n));
                        }
                    }
                    if let Some(e) = email {
                        if !has_email {
                            out.push_str(&format!("\temail = {}\n", e));
                        }
                    }
                }
                in_user = trimmed == "[user]";
                has_name = false;
                has_email = false;
            }
            if in_user {
                if trimmed.starts_with("name") {
                    if let Some(n) = name {
                        out.push_str(&format!("\tname = {}\n", n));
                        has_name = true;
                        continue;
                    } else {
                        has_name = true;
                    }
                } else if trimmed.starts_with("email") {
                    if let Some(e) = email {
                        out.push_str(&format!("\temail = {}\n", e));
                        has_email = true;
                        continue;
                    } else {
                        has_email = true;
                    }
                }
            }
            out.push_str(line);
            out.push('\n');
        }
        if in_user {
            if let Some(n) = name {
                if !has_name {
                    out.push_str(&format!("\tname = {}\n", n));
                }
            }
            if let Some(e) = email {
                if !has_email {
                    out.push_str(&format!("\temail = {}\n", e));
                }
            }
        }
        fs::write(config_path, out)?;
    } else {
        let mut new_content = content;
        if !new_content.is_empty() && !new_content.ends_with('\n') {
            new_content.push('\n');
        }
        new_content.push_str("[user]\n");
        if let Some(n) = name {
            new_content.push_str(&format!("\tname = {}\n", n));
        }
        if let Some(e) = email {
            new_content.push_str(&format!("\temail = {}\n", e));
        }
        fs::write(config_path, new_content)?;
    }
    Ok(())
}

pub fn write_user(repo: &Path, name: &str, email: &str) -> Result<()> {
    let config_path = repo.join(".itehaas").join("config");
    let hasher = read_hasher(repo)?;
    if !config_path.exists() {
        let content = format!("[core]\n\thasher = {}\n\trepositoryformatversion = 1\n", hasher.as_str());
        fs::write(&config_path, content)?;
    }
    write_user_to_file(&config_path, Some(name), Some(email))
}

pub fn write_global_user(name: Option<&str>, email: Option<&str>) -> Result<PathBuf> {
    let path = global_config_path().ok_or_else(|| {
        ItehaasError::Other("could not determine home directory for global config".to_string())
    })?;
    write_user_to_file(&path, name, email)?;
    Ok(path)
}

pub fn add_remote(repo: &Path, name: &str, url: &str) -> Result<()> {
    if name.is_empty() || name.contains(' ') || name.contains('/') || name.contains('"') {
        return Err(ItehaasError::InvalidObject(format!("invalid remote name: {}", name)));
    }
    let config_path = repo.join(".itehaas").join("config");
    let mut content = if config_path.exists() {
        fs::read_to_string(&config_path)?
    } else {
        String::new()
    };
    let remote_header = format!("[remote \"{}\"]", name);
    if content.contains(&remote_header) {
        return Err(ItehaasError::Other(format!("remote '{}' already exists", name)));
    }
    if !content.is_empty() && !content.ends_with('\n') {
        content.push('\n');
    }
    content.push_str(&format!("{} \n\turl = {}\n", remote_header, url));
    fs::write(config_path, content)?;
    Ok(())
}

pub fn remove_remote(repo: &Path, name: &str) -> Result<()> {
    let config_path = repo.join(".itehaas").join("config");
    if !config_path.exists() {
        return Err(ItehaasError::Other(format!("remote '{}' not found", name)));
    }
    let content = fs::read_to_string(&config_path)?;
    let remote_header = format!("[remote \"{}\"]", name);
    if !content.contains(&remote_header) {
        return Err(ItehaasError::Other(format!("remote '{}' not found", name)));
    }
    let mut out = String::new();
    let mut skip = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed == remote_header {
            skip = true;
            continue;
        }
        if skip && trimmed.starts_with('[') {
            skip = false;
        }
        if !skip {
            out.push_str(line);
            out.push('\n');
        }
    }
    fs::write(config_path, out)?;
    Ok(())
}

pub fn list_remotes(repo: &Path) -> Result<Vec<(String, String)>> {
    let config_path = repo.join(".itehaas").join("config");
    if !config_path.exists() {
        return Ok(vec![]);
    }
    let content = fs::read_to_string(&config_path)?;
    let mut remotes = Vec::new();
    let mut current_remote: Option<String> = None;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("[remote \"") && trimmed.ends_with("\"]") {
            let name = trimmed["[remote \"".len()..trimmed.len() - 2].to_string();
            current_remote = Some(name);
        } else if trimmed.starts_with('[') {
            current_remote = None;
        } else if let Some(ref name) = current_remote {
            if trimmed.starts_with("url") {
                if let Some(val) = trimmed.split('=').nth(1) {
                    let url = val.trim().trim_matches('"').to_string();
                    remotes.push((name.clone(), url));
                }
            }
        }
    }
    Ok(remotes)
}

pub fn get_remote_url(repo: &Path, name: &str) -> Result<Option<String>> {
    let remotes = list_remotes(repo)?;
    for (n, url) in remotes {
        if n == name {
            return Ok(Some(url));
        }
    }
    Ok(None)
}
