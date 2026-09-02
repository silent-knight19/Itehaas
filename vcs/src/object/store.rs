use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use flate2::read::ZlibDecoder;
use flate2::write::ZlibEncoder;
use flate2::Compression;

use crate::error::{ItehaasError, Result};
use crate::hash::{Hash, Hasher};
use crate::object::Object;

const OBJECT_SIZE_LIMIT: usize = 64 * 1024 * 1024; // 64 MiB Phase 1

/// Hash on uncompressed canonical bytes.
pub fn hash_object(obj: &Object, hasher: &dyn Hasher) -> Hash {
    obj.hash(hasher)
}

/// Write object to repo. Returns hash. Atomic, deduplicated.
pub fn write_object(repo: &Path, obj: &Object, hasher: &dyn Hasher) -> Result<Hash> {
    let canonical = obj.canonical_bytes();
    if canonical.len() > OBJECT_SIZE_LIMIT {
        return Err(ItehaasError::ObjectTooLarge {
            size: canonical.len(),
            limit: OBJECT_SIZE_LIMIT,
        });
    }
    let hash = hasher.hash(&canonical);
    let path = object_path(repo, &hash);
    if path.exists() {
        return Ok(hash);
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    // compress
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(&canonical)?;
    let compressed = encoder.finish()?;

    // atomic write via tempfile in same dir
    let dir = path.parent().unwrap();
    let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
    tmp.write_all(&compressed)?;
    tmp.flush()?;
    tmp.persist(&path).map_err(|e| ItehaasError::Io(e.error))?;
    Ok(hash)
}

/// Read object by hash. Verifies integrity (header, len, re-hash).
pub fn read_object(repo: &Path, hash: &Hash, hasher: &dyn Hasher) -> Result<Object> {
    // Validate hash length matches repo algo
    if hash.bytes.len() != hasher.hash_len() {
        return Err(ItehaasError::HashAlgoMismatch {
            expected: hasher.name().to_string(),
            got: format!("len {}", hash.bytes.len()),
        });
    }
    let path = object_path(repo, hash);
    if !path.exists() {
        return Err(ItehaasError::NotFound(hash.hex()));
    }
    let compressed = fs::read(&path)?;
    let mut decoder = ZlibDecoder::new(&compressed[..]);
    let mut canonical = Vec::new();
    // S6: bomb guard — limit decompressed to 64M+1 before allocating huge Vec
    {
        let mut limited = (&mut decoder).take((OBJECT_SIZE_LIMIT + 1) as u64);
        limited.read_to_end(&mut canonical)?;
    }
    if canonical.len() > OBJECT_SIZE_LIMIT {
        return Err(ItehaasError::ObjectTooLarge {
            size: canonical.len(),
            limit: OBJECT_SIZE_LIMIT,
        });
    }

    // Split at first \0
    let nul_pos = canonical
        .iter()
        .position(|&b| b == 0x00)
        .ok_or_else(|| ItehaasError::CorruptObject {
            hash: hash.hex(),
            reason: "missing null separator".into(),
        })?;
    let header = &canonical[..nul_pos];
    let body = &canonical[nul_pos + 1..];
    let header_str = std::str::from_utf8(header).map_err(|_| ItehaasError::CorruptObject {
        hash: hash.hex(),
        reason: "invalid header utf8".into(),
    })?;
    let mut parts = header_str.splitn(2, ' ');
    let obj_type = parts.next().ok_or_else(|| ItehaasError::CorruptObject {
        hash: hash.hex(),
        reason: "missing type in header".into(),
    })?;
    let len_str = parts.next().ok_or_else(|| ItehaasError::CorruptObject {
        hash: hash.hex(),
        reason: "missing len in header".into(),
    })?;
    let len: usize = len_str.parse().map_err(|_| ItehaasError::CorruptObject {
        hash: hash.hex(),
        reason: format!("invalid len: {len_str}"),
    })?;
    if len != body.len() {
        return Err(ItehaasError::CorruptObject {
            hash: hash.hex(),
            reason: format!("len mismatch: header {len} != body {}", body.len()),
        });
    }

    // Re-hash and compare
    let computed = hasher.hash(&canonical);
    if computed.bytes != hash.bytes {
        return Err(ItehaasError::CorruptObject {
            hash: hash.hex(),
            reason: format!("hash mismatch: expected {} got {}", hash.hex(), computed.hex()),
        });
    }

    let obj = Object::parse(hasher.algo(), obj_type, body.to_vec())?;
    // For tree, ensure each entry hash len matches hasher
    if let Object::Tree(tree) = &obj {
        for e in &tree.entries {
            if e.hash.bytes.len() != hasher.hash_len() {
                return Err(ItehaasError::HashAlgoMismatch {
                    expected: hasher.name().to_string(),
                    got: format!("tree entry {} len {}", e.name, e.hash.bytes.len()),
                });
            }
            if e.hash.algo != hash.algo {
                return Err(ItehaasError::HashAlgoMismatch {
                    expected: hash.algo.as_str().to_string(),
                    got: e.hash.algo.as_str().to_string(),
                });
            }
        }
    }
    Ok(obj)
}

/// Verify object integrity. Reuses read path.
pub fn verify_object(repo: &Path, hash: &Hash, hasher: &dyn Hasher) -> Result<bool> {
    read_object(repo, hash, hasher)?;
    Ok(true)
}

/// Fanout path: objects/ab/cdef...
pub fn object_path(repo: &Path, hash: &Hash) -> PathBuf {
    let hex = hash.hex();
    let (dir, file) = hex.split_at(2);
    repo.join(".itehaas").join("objects").join(dir).join(file)
}
