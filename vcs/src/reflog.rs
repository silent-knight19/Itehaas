use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::error::{ItehaasError, Result};
use crate::hash::{Hash, HashAlgo};

#[derive(Debug, Clone)]
pub struct ReflogEntry {
    pub old_hash: String,
    pub new_hash: String,
    pub name: String,
    pub email: String,
    pub timestamp: i64,
    pub tz: String,
    pub message: String,
}

impl ReflogEntry {
    pub fn format_line(&self) -> String {
        format!(
            "{} {} {} <{}> {} {}\t{}\n",
            self.old_hash, self.new_hash, self.name, self.email, self.timestamp, self.tz, self.message
        )
    }
}

/// Path for reflog of given ref: logs/HEAD or logs/refs/heads/...
pub fn reflog_path(repo: &Path, ref_name: &str) -> PathBuf {
    repo.join(".itehaas").join("logs").join(ref_name)
}

fn zero_hash(algo: HashAlgo) -> String {
    "0".repeat(algo.hex_len())
}

fn current_timestamp_and_tz() -> (i64, String) {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    (ts, "+0000".to_string())
}

fn get_actor(repo: &Path) -> (String, String) {
    match crate::config::read_user(repo) {
        Ok((name, email)) => (
            name.unwrap_or_else(|| "Author".to_string()),
            email.unwrap_or_else(|| "author@example.com".to_string()),
        ),
        Err(_) => ("Author".to_string(), "author@example.com".to_string()),
    }
}

/// Append entry to reflog for `ref_name` (e.g. "HEAD" or "refs/heads/main").
/// `old` and `new` may be None for unborn/zero state.
pub fn append_reflog(
    repo: &Path,
    ref_name: &str,
    old: Option<&Hash>,
    new: Option<&Hash>,
    message: &str,
) -> Result<()> {
    let algo = crate::config::read_hasher(repo).unwrap_or(HashAlgo::Sha256);
    let old_hex = old.map(|h| h.hex()).unwrap_or_else(|| zero_hash(algo));
    let new_hex = new.map(|h| h.hex()).unwrap_or_else(|| zero_hash(algo));
    let (name, email) = get_actor(repo);
    let (ts, tz) = current_timestamp_and_tz();
    let entry = ReflogEntry {
        old_hash: old_hex,
        new_hash: new_hex,
        name,
        email,
        timestamp: ts,
        tz,
        message: message.to_string(),
    };
    let path = reflog_path(repo, ref_name);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut f = OpenOptions::new().create(true).append(true).open(&path)?;
    f.write_all(entry.format_line().as_bytes())?;
    f.flush()?;
    Ok(())
}



/// Read reflog entries for ref_name, oldest first.
pub fn read_reflog(repo: &Path, ref_name: &str) -> Result<Vec<ReflogEntry>> {
    let path = reflog_path(repo, ref_name);
    if !path.exists() {
        return Ok(vec![]);
    }
    let content = fs::read_to_string(&path)?;
    let mut out = Vec::new();
    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }
        // format: "<old> <new> <name> <email> <ts> <tz>\t<message>"
        // Split at '\t' first
        let (meta, msg) = if let Some(idx) = line.find('\t') {
            (&line[..idx], line[idx + 1..].to_string())
        } else {
            (line, String::new())
        };
        // meta split: old new name <email> ts tz
        // But name may contain spaces. Easier: find '<' and '>'
        let mut parts: Vec<&str> = Vec::new();
        // We know first two tokens are hashes without spaces
        // Then remainder contains name + <email> + ts + tz
        let mut tokens = meta.split_whitespace();
        let old = tokens.next().unwrap_or("0").to_string();
        let new_hash = tokens.next().unwrap_or("0").to_string();
        // Now reconstruct name part up to '<'
        // Instead parse by locating '<' in meta
        let lt = meta.find('<');
        let gt = meta.find('>');
        let (name, email, ts, tz) = if let (Some(l), Some(g)) = (lt, gt) {
            let name_part = meta[old.len() + new_hash.len() + 2..l].trim().to_string();
            let email_part = meta[l + 1..g].trim().to_string();
            let rest = meta[g + 1..].trim();
            let mut rest_tokens = rest.split_whitespace();
            let ts_str = rest_tokens.next().unwrap_or("0");
            let tz_str = rest_tokens.next().unwrap_or("+0000");
            let ts_parsed: i64 = ts_str.parse().unwrap_or(0);
            (name_part, email_part, ts_parsed, tz_str.to_string())
        } else {
            ("Author".to_string(), "author@example.com".to_string(), 0, "+0000".to_string())
        };
        out.push(ReflogEntry {
            old_hash: old,
            new_hash,
            name,
            email,
            timestamp: ts,
            tz: tz.to_string(),
            message: msg,
        });
    }
    Ok(out)
}

/// Show reflog for ref_name in git style: "<new_short> <reflog_selector>: <msg>  | <date>" simplified.
// Used by CLI for display.
pub fn format_reflog_entry(entry: &ReflogEntry, index: usize) -> String {
    // Use short hash 7
    let short = if entry.new_hash.len() >= 7 {
        &entry.new_hash[..7]
    } else {
        &entry.new_hash
    };
    format!("{} HEAD@{{{}}}: {} : {} <{}> {} {}", short, index, entry.message, entry.name, entry.email, entry.timestamp, entry.tz)
}
