use std::collections::HashSet;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use crate::config;
use crate::hash::{Hash, HashAlgo};
use crate::object::store;

/// Max object size for HTTP download — mirrors store limit (64 MiB)
const HTTP_OBJECT_LIMIT: usize = 64 * 1024 * 1024;
/// Max number of objects to avoid DoS via huge history
const MAX_OBJECTS: usize = 100_000;
/// Max recursion depth
const MAX_DEPTH: usize = 2048;
/// HTTP timeout seconds
const HTTP_TIMEOUT_SECS: u64 = 30;

/// Result of fetching remote refs via HTTP
#[derive(Debug, Clone)]
pub struct HttpRefs {
    pub refs: Vec<(String, String)>, // (ref_name, hex_hash)
    pub head: String,
    pub hasher: String,
}

/// Build an ureq agent with sane timeouts and TLS verification on.
fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_read(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
        .timeout_write(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
        .timeout_connect(std::time::Duration::from_secs(10))
        .build()
}

/// Get credential token from environment (ITEHAAS_TOKEN or ITEHAAS_SESSION)
fn token_from_env() -> Option<String> {
    if let Ok(v) = std::env::var("ITEHAAS_TOKEN") {
        if !v.trim().is_empty() {
            return Some(v.trim().to_string());
        }
    }
    if let Ok(v) = std::env::var("ITEHAAS_SESSION") {
        if !v.trim().is_empty() {
            return Some(v.trim().to_string());
        }
    }
    None
}

/// Validate base HTTP URL shape: must be http(s)://host/api/repos/owner/repo (strict)
pub fn validate_http_base(base: &str) -> Result<String> {
    let trimmed = base.trim_end_matches('/');
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        anyhow::bail!("http url must start with http:// or https://");
    }
    if trimmed.contains('\0') || trimmed.contains(' ') {
        anyhow::bail!("invalid http url");
    }
    // Must contain /api/repos/ somewhere to avoid open-ended SSRF to arbitrary hosts
    // Allow localhost for tests but still require api/repos
    if !trimmed.contains("/api/repos/") {
        // Also allow /api/repos/<owner>/<repo> strict check later
        anyhow::bail!("http url must be of form http(s)://host/api/repos/<owner>/<repo>");
    }
    // Validate that we have owner and repo segments after /api/repos/
    let idx = trimmed
        .find("/api/repos/")
        .ok_or_else(|| anyhow::anyhow!("invalid http url"))?;
    let suffix = &trimmed[idx + "/api/repos/".len()..];
    let parts: Vec<&str> = suffix.split('/').collect();
    if parts.len() < 2 || parts[0].is_empty() || parts[1].is_empty() {
        anyhow::bail!("http url must be of form http(s)://host/api/repos/<owner>/<repo>");
    }
    // owner/repo validation mirrors repoPathFor regex + traversal guard
    for p in &parts[0..2] {
        if *p == "." || *p == ".." {
            anyhow::bail!("invalid owner/repo in http url: traversal");
        }
        if !p.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-') {
            anyhow::bail!("invalid owner/repo in http url");
        }
        if p.len() > 100 {
            anyhow::bail!("owner/repo too long in http url");
        }
        // Extra: reject embedded ".." already blocked exact case; keep permissive for "a..b"
        if p.contains("..") && *p != ".." {
            // Allow names like "a..b" — Git permits, so we permit
        }
    }
    Ok(trimmed.to_string())
}

/// Apply auth headers if token available.
fn apply_auth(req: ureq::Request, token: &Option<String>) -> ureq::Request {
    if let Some(t) = token {
        // Send both styles for compatibility: Bearer + Cookie
        // Do NOT log token.
        req.set("Authorization", &format!("Bearer {}", t))
            .set("Cookie", &format!("itehaas_session={}", t))
    } else {
        req
    }
}

/// Fetch remote refs via HTTP GET {base}/refs
pub fn fetch_refs_http(base_url: &str) -> Result<HttpRefs> {
    let base = validate_http_base(base_url)?;
    let url = format!("{}/refs", base);
    let token = token_from_env();
    let ag = agent();

    let req = ag.get(&url);
    let req = apply_auth(req, &token);
    // Avoid logging URL with potential query token; base is sanitized.

    let resp = req.call().map_err(|e| match e {
        ureq::Error::Status(401, _) | ureq::Error::Status(403, _) => {
            anyhow::anyhow!("authentication required for private repository; set ITEHAAS_TOKEN env var (401/403)")
        }
        ureq::Error::Status(404, _) => anyhow::anyhow!("remote repository not found (404): {}", redact_url(&base)),
        ureq::Error::Status(code, _) => anyhow::anyhow!("http error {} fetching refs from {}", code, redact_url(&base)),
        ureq::Error::Transport(t) => anyhow::anyhow!("network error fetching refs: {}", t),
    })?;

    if resp.status() != 200 {
        anyhow::bail!("unexpected status {} from {}", resp.status(), redact_url(&base));
    }

    // Parse JSON: { refs: [{name, hash}], head, hasher }
    let v: serde_json::Value = resp
        .into_json()
        .context("parsing refs json; server may not support http clone")?;

    let hasher = v
        .get("hasher")
        .and_then(|x| x.as_str())
        .unwrap_or("sha256")
        .to_string();

    let head = v
        .get("head")
        .and_then(|x| x.as_str())
        .unwrap_or("refs/heads/main")
        .to_string();

    let refs_arr = v
        .get("refs")
        .and_then(|x| x.as_array())
        .ok_or_else(|| anyhow::anyhow!("invalid refs response: missing refs array"))?;

    let mut refs = Vec::new();
    for entry in refs_arr {
        let name = entry
            .get("name")
            .and_then(|x| x.as_str())
            .ok_or_else(|| anyhow::anyhow!("invalid refs entry: missing name"))?
            .to_string();
        let hash = entry
            .get("hash")
            .and_then(|x| x.as_str())
            .ok_or_else(|| anyhow::anyhow!("invalid refs entry: missing hash"))?
            .to_string();
        // Validate shape
        if !name.starts_with("refs/heads/") {
            anyhow::bail!("invalid ref name: {}", name);
        }
        if !hash.chars().all(|c| c.is_ascii_hexdigit()) || hash.len() != 64 {
            anyhow::bail!("invalid hash in refs: {}", &hash[..8.min(hash.len())]);
        }
        // Branch name validation
        let branch = &name["refs/heads/".len()..];
        if !is_valid_branch_name(branch) {
            anyhow::bail!("invalid branch name in refs: {}", branch);
        }
        refs.push((name, hash));
    }
    refs.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(HttpRefs { refs, head, hasher })
}

fn is_valid_branch_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 100 {
        return false;
    }
    // Mirrors refs::validate_branch_name but cheap
    if name.contains("..")
        || name.contains(' ')
        || name.contains('~')
        || name.contains('^')
        || name.contains(':')
        || name.contains('?')
        || name.contains('*')
        || name.contains('[')
        || name.contains('\0')
    {
        return false;
    }
    true
}

/// Redact URL for error messages — strip query, keep host + path prefix
fn redact_url(url: &str) -> String {
    // Keep scheme://host/api/repos/owner/repo form, drop any trailing ?query
    url.split('?').next().unwrap_or(url).to_string()
}

/// Download a single object via HTTP GET {base}/objects/{hash} and write atomically.
/// Verifies integrity by reading back via store::read_object.
pub fn fetch_object_http(
    base_url: &str,
    repo: &Path,
    hash: &Hash,
) -> Result<()> {
    let base = validate_http_base(base_url)?;
    let hex = hash.hex();
    // Hash already validated via Hash type, but double-check
    if !hex.chars().all(|c| c.is_ascii_hexdigit()) || hex.len() != 64 {
        anyhow::bail!("invalid hash for http fetch");
    }
    let dest_path = store::object_path(repo, hash);
    if dest_path.exists() {
        return Ok(());
    }
    if let Some(parent) = dest_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let url = format!("{}/objects/{}", base, hex);
    let token = token_from_env();
    let ag = agent();
    let req = ag.get(&url);
    let req = apply_auth(req, &token);

    let resp = req.call().map_err(|e| match e {
        ureq::Error::Status(401, _) | ureq::Error::Status(403, _) => {
            anyhow::anyhow!("authentication required to fetch object {} (private repo); set ITEHAAS_TOKEN", &hex[..7])
        }
        ureq::Error::Status(404, _) => anyhow::anyhow!("object not found on remote: {}", &hex[..12]),
        ureq::Error::Status(code, _) => anyhow::anyhow!("http {} fetching object {}", code, &hex[..7]),
        ureq::Error::Transport(t) => anyhow::anyhow!("network error fetching object {}: {}", &hex[..7], t),
    })?;

    if resp.status() != 200 {
        anyhow::bail!("unexpected status {} for object {}", resp.status(), &hex[..7]);
    }
    // Defense: check Content-Length before downloading
    if let Some(cl) = resp.header("Content-Length") {
        if let Ok(n) = cl.parse::<usize>() {
            if n > HTTP_OBJECT_LIMIT {
                anyhow::bail!("object {} too large ({} bytes)", &hex[..7], n);
            }
        }
    }
    if resp.header("Content-Type").map(|v| v.contains("application/octet-stream")).unwrap_or(false) == false {
        // Allow but warn? Strict.
        // Some proxies may add charset; we permit if contains octet-stream
        // If missing, still proceed — server should set it.
    }

    let mut reader = resp.into_reader();
    let mut buf = Vec::new();
    // Cap total bytes to avoid OOM / DoS
    let mut total = 0usize;
    let mut chunk = [0u8; 8192];
    loop {
        let n = reader.read(&mut chunk).context("reading http object body")?;
        if n == 0 {
            break;
        }
        total += n;
        if total > HTTP_OBJECT_LIMIT {
            anyhow::bail!("object {} exceeds 64 MiB limit", &hex[..7]);
        }
        buf.extend_from_slice(&chunk[..n]);
    }

    // buf now holds zlib-compressed bytes (Stored = zlib(header\0body))
    // Write atomically to dest_path via tempfile, then verify via store::read_object
    // We write raw compressed bytes directly (avoid recompress)
    let dir = dest_path.parent().unwrap();
    let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
    tmp.write_all(&buf)?;
    tmp.flush()?;
    // Persist; if destination already created due to race, skip
    match tmp.persist(&dest_path) {
        Ok(_) => {}
        Err(e) if e.error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(anyhow::anyhow!("persisting object {}: {}", &hex[..7], e.error)),
    }

    // Verify integrity immediately — decompress, check header/len/re-hash
    let algo = crate::config::read_hasher(repo)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let hasher = crate::hash::new_hasher(algo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    // store::read_object does full verification including hash == expected
    crate::object::store::read_object(repo, hash, hasher.as_ref())
        .map_err(|e| anyhow::anyhow!("object {} failed verification after http download: {}", &hex[..7], e))?;

    Ok(())
}

/// Recursively download object and its children over HTTP, using visited dedup and depth limit.
pub fn download_recursive_http(
    base_url: &str,
    repo: &Path,
    hash: &Hash,
    visited: &mut HashSet<String>,
    depth: usize,
) -> Result<()> {
    if depth > MAX_DEPTH {
        anyhow::bail!("depth exceeded fetching {}", &hash.hex()[..7]);
    }
    if visited.len() > MAX_OBJECTS {
        anyhow::bail!("too many objects (>{}) fetching {}", MAX_OBJECTS, &hash.hex()[..7]);
    }
    let hex = hash.hex();
    if visited.contains(&hex) {
        return Ok(());
    }
    visited.insert(hex.clone());

    // If object already exists locally, we still need to parse it to discover children
    // So ensure object is present (fetch if missing)
    let need_fetch = !store::object_path(repo, hash).exists();
    if need_fetch {
        fetch_object_http(base_url, repo, hash)?;
    }

    // Now parse to discover referenced objects
    let algo = crate::config::read_hasher(repo)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let hasher = crate::hash::new_hasher(algo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let obj = store::read_object(repo, hash, hasher.as_ref())
        .map_err(|e| anyhow::anyhow!("reading downloaded object {}: {}", &hex[..7], e))?;

    match obj {
        crate::object::Object::Commit(c) => {
            // Tree + parents
            download_recursive_http(base_url, repo, &c.tree, visited, depth + 1)?;
            for p in c.parents {
                download_recursive_http(base_url, repo, &p, visited, depth + 1)?;
            }
        }
        crate::object::Object::Tree(t) => {
            for e in t.entries {
                // Tree entries already validated hash len; recurse
                // Check if child exists locally before fetch
                if !store::object_path(repo, &e.hash).exists() {
                    // For subtrees we will recurse and fetch; for blobs just fetch
                    if e.mode == 0o040000 {
                        download_recursive_http(base_url, repo, &e.hash, visited, depth + 1)?;
                    } else {
                        // Blob: just fetch + verify, no further recursion
                        let hex_child = e.hash.hex();
                        if !visited.contains(&hex_child) {
                            visited.insert(hex_child.clone());
                            fetch_object_http(base_url, repo, &e.hash)?;
                        }
                    }
                } else {
                    // Exists locally — but if subtree, still need to traverse its children
                    // in case some descendants missing (if object was present but children not)
                    if e.mode == 0o040000 && !visited.contains(&e.hash.hex()) {
                        download_recursive_http(base_url, repo, &e.hash, visited, depth + 1)?;
                    } else if !visited.contains(&e.hash.hex()) {
                        visited.insert(e.hash.hex());
                    }
                }
            }
        }
        crate::object::Object::Blob(_) => {
            // leaf
        }
        crate::object::Object::Tag(tag) => {
            download_recursive_http(base_url, repo, &tag.object, visited, depth + 1)?;
        }
    }
    Ok(())
}

/// Helper to write transfer stats for UI
pub fn path_for_hash(repo: &Path, hash: &Hash) -> PathBuf {
    store::object_path(repo, hash)
}
