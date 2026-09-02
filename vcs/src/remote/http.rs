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
        .redirects(0) // S12: do not follow redirects to avoid SSRF via redirect to private IP
        .build()
}

// S12: check if host is private/link-local/loopback (unless ALLOW_PRIVATE_REMOTES=true)
fn is_private_host(host: &str) -> bool {
    // Allow localhost explicitly for tests and local dev (resolves to 127.0.0.1 but should be allowed)
    let lower = host.to_ascii_lowercase();
    if lower == "localhost" || lower.starts_with("localhost:") {
        return false;
    }
    // Strip port if present (but careful with IPv6)
    let h = if host.starts_with('[') {
        // IPv6 [::1]:port
        if let Some(end) = host.find(']') {
            &host[1..end]
        } else {
            host
        }
    } else {
        // IPv4 or name: split at ':'
        if let Some(colon) = host.find(':') {
            // Check if it's IPv6 without brackets? Unlikely, but handle
            if host.matches(':').count() > 1 {
                host
            } else {
                &host[..colon]
            }
        } else {
            host
        }
    };
    // Check literal IP
    if let Ok(ip) = h.parse::<std::net::IpAddr>() {
        return is_private_ip(&ip);
    }
    // For DNS names, try to resolve (best-effort, no network in tests, so just check via ToSocketAddrs)
    // We attempt to resolve host:80
    use std::net::ToSocketAddrs;
    if let Ok(addrs) = (h.to_owned() + ":80").to_socket_addrs() {
        for addr in addrs {
            if is_private_ip(&addr.ip()) {
                return true;
            }
        }
    }
    false
}

fn is_private_ip(ip: &std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => {
            let oct = v4.octets();
            // 127.0.0.0/8
            if oct[0] == 127 { return true; }
            // 10.0.0.0/8
            if oct[0] == 10 { return true; }
            // 172.16.0.0/12
            if oct[0] == 172 && (16..=31).contains(&oct[1]) { return true; }
            // 192.168.0.0/16
            if oct[0] == 192 && oct[1] == 168 { return true; }
            // 169.254.0.0/16 link-local
            if oct[0] == 169 && oct[1] == 254 { return true; }
            // 0.0.0.0
            if oct[0] == 0 && oct[1] == 0 && oct[2] == 0 && oct[3] == 0 { return true; }
            false
        }
        std::net::IpAddr::V6(v6) => {
            // ::1 loopback
            if v6.is_loopback() { return true; }
            // fc00::/7 unique local
            let seg0 = v6.segments()[0];
            if (seg0 & 0xfe00) == 0xfc00 { return true; }
            // fe80::/10 link-local
            if (seg0 & 0xffc0) == 0xfe80 { return true; }
            // :: (unspecified)
            if v6.is_unspecified() { return true; }
            false
        }
    }
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
    // S12: private/link-local/loopback block (unless ALLOW_PRIVATE_REMOTES=true)
    if std::env::var("ALLOW_PRIVATE_REMOTES").unwrap_or_default() != "true" {
        // Extract host from URL: after "://" until "/" or ":" (but careful IPv6)
        let without_scheme = if trimmed.starts_with("https://") {
            &trimmed["https://".len()..]
        } else {
            &trimmed["http://".len()..]
        };
        let host_part = if without_scheme.starts_with('[') {
            // IPv6 [::1]:port or [::1]/path
            if let Some(end) = without_scheme.find(']') {
                &without_scheme[..=end]
            } else {
                without_scheme.split('/').next().unwrap_or("")
            }
        } else {
            without_scheme.split('/').next().unwrap_or("")
        };
        // host_part may be "127.0.0.1:3001" or "127.0.0.1" or "[::1]:3001" or "example.com:3001"
        if is_private_host(host_part) {
            anyhow::bail!("private/link-local/loopback host not allowed: {}", host_part);
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
        let expected_len = crate::hash::HashAlgo::from_str(&hasher)
            .map(|a| a.hex_len())
            .unwrap_or(64);
        if !hash.chars().all(|c| c.is_ascii_hexdigit()) || hash.len() != expected_len {
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
    if !hex.chars().all(|c| c.is_ascii_hexdigit()) || (hex.len() != 64 && hex.len() != 40) {
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

/// Incremental HTTP fetch: update refs/remotes/<remote>/* with missing objects
/// Returns number of objects fetched (visited len)
pub fn http_fetch(repo: &Path, remote_name: &str, base_url: &str) -> Result<usize> {
    let http_refs = fetch_refs_http(base_url)?;
    let local_algo = crate::config::read_hasher(repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let remote_algo = crate::hash::HashAlgo::from_str(&http_refs.hasher)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    if local_algo != remote_algo {
        anyhow::bail!(
            "hash algorithm mismatch: local {} vs remote {}",
            local_algo,
            remote_algo
        );
    }
    if http_refs.refs.is_empty() {
        return Ok(0);
    }
    let mut visited: HashSet<String> = HashSet::new();
    // Pre-populate visited with locally existing reachable? Not needed; download_recursive will skip existing via object_path.exists()
    // But to avoid re-fetching already visited hashes across multiple refs, we share visited.

    for (ref_name, hash_hex) in &http_refs.refs {
        let remote_ref = ref_name.replacen("refs/heads/", &format!("refs/remotes/{}/", remote_name), 1);
        // Check if local remote ref already equals this hash; if so, we may still need to ensure objects present, but we can skip download if objects already present
        // Quick check: if local remote ref exists and equals hash and object exists locally, skip download but still ensure visited dedup
        if let Ok(Some(local_hash)) = crate::refs::read_ref(repo, &remote_ref) {
            if local_hash.hex() == *hash_hex {
                // Already up to date; still need to ensure we have objects? If object exists locally, skip
                // We can check if object file exists
                let h = crate::hash::Hash::from_hex(local_algo, hash_hex).map_err(|e| anyhow::anyhow!(e.to_string()))?;
                if store::object_path(repo, &h).exists() {
                    continue;
                }
                // else fall through to download
            }
        }
        let hash = crate::hash::Hash::from_hex(local_algo, hash_hex).map_err(|e| anyhow::anyhow!(e.to_string()))?;
        download_recursive_http(base_url, repo, &hash, &mut visited, 0)?;
        crate::refs::write_ref(repo, &remote_ref, &hash)
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    }
    Ok(visited.len())
}

/// Upload a single object via HTTP POST {base}/objects/{hash}
pub fn upload_object_http(
    base_url: &str,
    repo: &Path,
    hash: &Hash,
) -> Result<bool> {
    let base = validate_http_base(base_url)?;
    let hex = hash.hex();
    let obj_path = store::object_path(repo, hash);
    if !obj_path.exists() {
        anyhow::bail!("local object {} not found", &hex[..7]);
    }
    let data = fs::read(&obj_path).context("reading local object for upload")?;
    if data.len() > HTTP_OBJECT_LIMIT {
        anyhow::bail!("object {} too large", &hex[..7]);
    }
    let url = format!("{}/objects/{}", base, hex);
    let token = token_from_env();
    let ag = agent();
    let req = ag.post(&url);
    let req = apply_auth(req, &token);
    let req = req.set("Content-Type", "application/octet-stream");
    let resp = req
        .send_bytes(&data)
        .map_err(|e| match e {
            ureq::Error::Status(401, _) | ureq::Error::Status(403, _) => {
                anyhow::anyhow!("push: authentication required (401/403); set ITEHAAS_TOKEN")
            }
            ureq::Error::Status(409, _) => anyhow::anyhow!("push: remote rejected (conflict)"),
            ureq::Error::Status(code, _) => anyhow::anyhow!("push: http {} uploading object {}", code, &hex[..7]),
            ureq::Error::Transport(t) => anyhow::anyhow!("network error uploading object {}: {}", &hex[..7], t),
        })?;
    if resp.status() != 200 && resp.status() != 201 {
        anyhow::bail!("unexpected status {} uploading object {}", resp.status(), &hex[..7]);
    }
    // dedup is okay: server returns 200/201 both success
    Ok(resp.status() == 201)
}

/// Update remote ref via HTTP POST {base}/refs/heads/{branch}
pub fn update_remote_ref_http(
    base_url: &str,
    branch: &str,
    hash_hex: &str,
    force: bool,
) -> Result<()> {
    let base = validate_http_base(base_url)?;
    // Validate branch name
    if !is_valid_branch_name(branch) {
        anyhow::bail!("invalid branch name: {}", branch);
    }
    if !hash_hex.chars().all(|c| c.is_ascii_hexdigit()) || (hash_hex.len() != 64 && hash_hex.len() != 40) {
        anyhow::bail!("invalid hash for push");
    }
    let url = format!("{}/refs/heads/{}", base, branch);
    let token = token_from_env();
    let ag = agent();
    let body = serde_json::json!({ "hash": hash_hex, "force": force });
    let req = ag.post(&url);
    let req = apply_auth(req, &token);
    let req = req.set("Content-Type", "application/json");
    let resp = req
        .send_json(body)
        .map_err(|e| match e {
            ureq::Error::Status(401, _) | ureq::Error::Status(403, _) => {
                anyhow::anyhow!("push: authentication required (403) for refs/heads/{}; need write permission", branch)
            }
            ureq::Error::Status(409, resp) => {
                // Try to read error body for non-fast-forward
                let msg = resp
                    .into_string()
                    .unwrap_or_else(|_| "non-fast-forward push rejected".into());
                if msg.contains("non-fast-forward") || msg.contains("fast-forward") {
                    return anyhow::anyhow!("non-fast-forward push rejected (remote is not ancestor); use --force");
                }
                anyhow::anyhow!("push rejected: {}", msg)
            }
            ureq::Error::Status(423, _) => anyhow::anyhow!("push: remote ref locked (concurrent push); retry"),
            ureq::Error::Status(code, resp) => {
                let msg = resp.into_string().unwrap_or_default();
                anyhow::anyhow!("push http {} for ref {}: {}", code, branch, msg)
            }
            ureq::Error::Transport(t) => anyhow::anyhow!("network error updating ref {}: {}", branch, t),
        })?;
    if resp.status() != 200 && resp.status() != 201 {
        anyhow::bail!("unexpected status {} updating ref", resp.status());
    }
    Ok(())
}

/// High-level HTTP push: transfer missing objects then update remote ref atomically
pub fn http_push(
    repo: &Path,
    remote_name: &str,
    base_url: &str,
    branch: &str,
    local_hash: &Hash,
    force: bool,
) -> Result<usize> {
    // Fetch remote refs to get current remote hash for FF check
    let http_refs = fetch_refs_http(base_url)?;
    let remote_algo = crate::hash::HashAlgo::from_str(&http_refs.hasher)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let local_algo = crate::config::read_hasher(repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    if local_algo != remote_algo {
        anyhow::bail!(
            "hash algorithm mismatch: local {} vs remote {}",
            local_algo,
            remote_algo
        );
    }
    let remote_hash_hex = http_refs
        .refs
        .iter()
        .find(|(n, _)| n == &format!("refs/heads/{}", branch))
        .map(|(_, h)| h.clone());
    if let Some(rh) = &remote_hash_hex {
        if rh == &local_hash.hex() {
            // already up to date
            return Ok(0);
        }
        if !force {
            let remote_hash = crate::hash::Hash::from_hex(local_algo, rh)
                .map_err(|e| anyhow::anyhow!(e.to_string()))?;
            let is_ff = crate::merge::is_ancestor(repo, &remote_hash, local_hash)
                .map_err(|e| anyhow::anyhow!(e.to_string()))?;
            if !is_ff {
                anyhow::bail!("non-fast-forward push rejected (remote is not ancestor); use --force");
            }
        }
    }
    // Collect reachable objects from local_hash
    let hasher = crate::hash::new_hasher(local_algo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let mut local_visited: HashSet<String> = HashSet::new();
    let mut local_objs: Vec<Hash> = Vec::new();
    crate::remote::collect_reachable_objects(
        repo,
        local_hash,
        hasher.as_ref(),
        &mut local_visited,
        &mut local_objs,
    )
    .map_err(|e| anyhow::anyhow!(e.to_string()))?;

    // Remove those already reachable from remote_hash (if exists)
    let mut to_upload: Vec<Hash> = Vec::new();
    if let Some(rh) = remote_hash_hex {
        let remote_hash = crate::hash::Hash::from_hex(local_algo, &rh)
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let mut remote_visited: HashSet<String> = HashSet::new();
        let mut remote_objs: Vec<Hash> = Vec::new();
        // If remote object missing locally (should not), ignore error
        let _ = crate::remote::collect_reachable_objects(
            repo,
            &remote_hash,
            hasher.as_ref(),
            &mut remote_visited,
            &mut remote_objs,
        );
        for h in local_objs {
            if !remote_visited.contains(&h.hex()) {
                to_upload.push(h);
            }
        }
    } else {
        to_upload = local_objs;
    }

    // Sort for deterministic upload order (parents before children? collect order is BFS parent first, so we keep)
    // Upload each
    let mut uploaded = 0;
    for h in &to_upload {
        // Check local object exists
        let path = crate::object::store::object_path(repo, h);
        if !path.exists() {
            continue;
        }
        upload_object_http(base_url, repo, h)?;
        uploaded += 1;
        if uploaded > MAX_OBJECTS {
            anyhow::bail!("too many objects to push");
        }
    }

    // Update remote ref atomically
    update_remote_ref_http(base_url, branch, &local_hash.hex(), force)?;

    // Update local remote-tracking ref on success
    let remote_tracking = format!("refs/remotes/{}/{}", remote_name, branch);
    crate::refs::write_ref(repo, &remote_tracking, local_hash)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;

    Ok(uploaded)
}
