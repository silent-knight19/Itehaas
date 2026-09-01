use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{ItehaasError, Result};
use crate::hash::{Hash, HashAlgo};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct IndexEntry {
    /// Repo-relative path with '/' separators, no leading slash.
    pub path: String,
    /// Hex-encoded hash (always for repo's algo)
    pub hash: String,
    /// File mode (e.g., 0o100644, 0o100755)
    pub mode: u32,
}

impl IndexEntry {
    pub fn new(path: String, hash: Hash, mode: u32) -> Self {
        Self {
            path,
            hash: hash.hex(),
            mode,
        }
    }

    pub fn hash_as(&self, algo: HashAlgo) -> Result<Hash> {
        Hash::from_hex(algo, &self.hash)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Index {
    pub version: u32,
    pub entries: BTreeMap<String, IndexEntry>, // sorted by path
}

impl Index {
    pub fn new() -> Self {
        Self {
            version: 1,
            entries: BTreeMap::new(),
        }
    }

    /// Load from .itehaas/index. If missing or empty, return empty index.
    pub fn load(repo: &Path) -> Result<Self> {
        let path = repo.join(".itehaas").join("index");
        if !path.exists() {
            return Ok(Self::new());
        }
        let data = fs::read(&path)?;
        if data.is_empty() {
            return Ok(Self::new());
        }
        // Try JSON first; fallback: old empty handling
        let idx: Self = serde_json::from_slice(&data).map_err(|e| {
            ItehaasError::InvalidObject(format!("index corrupted: {}", e))
        })?;
        if idx.version != 1 {
            return Err(ItehaasError::InvalidObject(format!(
                "unsupported index version: {}",
                idx.version
            )));
        }
        Ok(idx)
    }

    /// Save atomically.
    pub fn save(&self, repo: &Path) -> Result<()> {
        let index_path = repo.join(".itehaas").join("index");
        let dir = index_path.parent().unwrap();
        // Ensure sorted serialization: BTreeMap already sorted.
        let data = serde_json::to_string_pretty(self).map_err(|e| ItehaasError::Other(e.to_string()))?;
        // Atomic write via tempfile in same directory
        let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
        use std::io::Write;
        tmp.write_all(data.as_bytes())?;
        tmp.flush()?;
        tmp.persist(&index_path).map_err(|e| ItehaasError::Io(e.error))?;
        Ok(())
    }

    pub fn add_or_update(&mut self, entry: IndexEntry) {
        self.entries.insert(entry.path.clone(), entry);
    }

    pub fn remove(&mut self, path: &str) -> bool {
        self.entries.remove(path).is_some()
    }

    pub fn get(&self, path: &str) -> Option<&IndexEntry> {
        self.entries.get(path)
    }

    pub fn contains(&self, path: &str) -> bool {
        self.entries.contains_key(path)
    }

    /// Sorted list of entries.
    pub fn entries_sorted(&self) -> Vec<&IndexEntry> {
        self.entries.values().collect()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }
}

impl Default for Index {
    fn default() -> Self {
        Self::new()
    }
}

/// Convert repo-relative path (Path) to slash-separated string.
pub fn path_to_string(relative: &Path) -> String {
    // Use forward slashes regardless of OS
    let mut s = String::new();
    for (i, comp) in relative.components().enumerate() {
        if i > 0 {
            s.push('/');
        }
        s.push_str(&comp.as_os_str().to_string_lossy());
    }
    s
}

/// Check if path should be ignored (inside .itehaas or absolute beyond repo)
pub fn should_ignore(relative: &Path) -> bool {
    if relative.components().any(|c| c.as_os_str() == ".itehaas") {
        return true;
    }
    // Ignore .git for safety if user has both
    if relative.components().any(|c| c.as_os_str() == ".git") {
        return true;
    }
    false
}

/// Get file mode: 100755 if executable bit set, else 100644
pub fn file_mode(metadata: &fs::Metadata) -> u32 {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = metadata.permissions().mode();
        if mode & 0o111 != 0 {
            0o100755
        } else {
            0o100644
        }
    }
    #[cfg(not(unix))]
    {
        let _ = metadata;
        0o100644
    }
}
