use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use crate::error::Result;
use crate::hash::Hash;
use crate::object::store;

/// Simple packfile: concatenates loose objects with minimal delta (none yet, placeholder for Phase 10).
/// Format: "ITEHAAS PACK v1\n" + u32 count BE + for each: hash_hex(64) + u32 len BE + zlib_bytes
/// Returns (pack_path, count, original_bytes, packed_bytes)

pub fn create_pack(repo: &Path) -> Result<(PathBuf, usize, u64, u64)> {
    let algo = crate::config::read_hasher(repo)?;
    let objects_dir = repo.join(".itehaas").join("objects");
    let pack_dir = objects_dir.join("pack");
    fs::create_dir_all(&pack_dir)?;

    // Collect reachable hashes (like gc)
    let mut hashes: Vec<String> = Vec::new();
    let mut original_bytes: u64 = 0;
    let mut entries: Vec<(String, Vec<u8>)> = Vec::new();

    for entry in walkdir::WalkDir::new(&objects_dir).min_depth(2).max_depth(3) {
        let e = match entry { Ok(v)=>v, Err(_)=>continue };
        let path = e.path();
        if !path.is_file() { continue; }
        if path.components().any(|c| c.as_os_str()=="pack") { continue; }
        let parent = path.parent().and_then(|p| p.file_name()).map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let file = path.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        if parent.len()!=2 || file.len()!=62 { continue; }
        let hex = format!("{}{}", parent, file);
        let data = fs::read(path)?;
        original_bytes += data.len() as u64;
        entries.push((hex, data));
    }

    if entries.is_empty() {
        return Err(crate::error::ItehaasError::Other("no objects to pack".into()));
    }

    // Sort for determinism
    entries.sort_by(|a,b| a.0.cmp(&b.0));

    let timestamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
    let pack_name = format!("pack-{:x}-{:x}.pack", timestamp, entries.len());
    let pack_path = pack_dir.join(pack_name);
    let mut out = fs::File::create(&pack_path)?;

    out.write_all(b"ITEHAAS PACK v1\n")?;
    out.write_all(&(entries.len() as u32).to_be_bytes())?;

    for (hex, data) in &entries {
        out.write_all(hex.as_bytes())?;
        out.write_all(&(data.len() as u32).to_be_bytes())?;
        out.write_all(data)?;
        hashes.push(hex.clone());
    }

    let packed_bytes = fs::metadata(&pack_path)?.len();

    // Optionally we could delete loose objects after pack, but leave for gc to prune.
    // For now, keep loose; pack is additive.

    Ok((pack_path, entries.len(), original_bytes, packed_bytes))
}

pub fn list_packs(repo: &Path) -> Result<Vec<PathBuf>> {
    let pack_dir = repo.join(".itehaas").join("objects").join("pack");
    if !pack_dir.exists() { return Ok(vec![]); }
    let mut packs = Vec::new();
    for entry in fs::read_dir(&pack_dir)? {
        let e = entry?;
        let p = e.path();
        if p.extension().map(|s| s=="pack").unwrap_or(false) {
            packs.push(p);
        }
    }
    packs.sort();
    Ok(packs)
}

pub fn verify_pack(repo: &Path, pack_path: &Path) -> Result<usize> {
    let mut f = fs::File::open(pack_path)?;
    let mut header = [0u8; 16];
    f.read_exact(&mut header)?;
    if &header != b"ITEHAAS PACK v1\n" {
        return Err(crate::error::ItehaasError::InvalidObject("bad pack header".into()));
    }
    let mut count_buf = [0u8; 4];
    f.read_exact(&mut count_buf)?;
    let count = u32::from_be_bytes(count_buf) as usize;
    let mut verified = 0;
    for _ in 0..count {
        let mut hex_buf = [0u8; 64];
        f.read_exact(&mut hex_buf)?;
        let hex = String::from_utf8_lossy(&hex_buf).to_string();
        let mut len_buf = [0u8;4];
        f.read_exact(&mut len_buf)?;
        let len = u32::from_be_bytes(len_buf) as usize;
        let mut data = vec![0u8; len];
        f.read_exact(&mut data)?;
        // Verify: data should be zlib bytes that when decompressed and hashed matches hex
        // We can verify by writing to temp and using store::verify? Simpler: check that hash matches by re-reading via store path if exists, else skip.
        // For pack verify, just ensure we can decompress and hash matches expected.
        // Decompress to check
        // Use store verification via hasher
        let algo = crate::config::read_hasher(repo)?;
        let hasher = crate::hash::new_hasher(algo)?;
        // Decompress data
        let decompressed = {
            use flate2::read::ZlibDecoder;
            let mut d = ZlibDecoder::new(&data[..]);
            let mut out = Vec::new();
            d.read_to_end(&mut out)?;
            out
        };
        // Split header
        if let Some(pos) = decompressed.iter().position(|&b| b==0) {
            let header = &decompressed[..pos];
            let body = &decompressed[pos+1..];
            let header_str = String::from_utf8_lossy(header);
            // Recompute hash
            let hash = {
                use crate::hash::Hasher;
                hasher.hash(&decompressed)
            };
            if hash.hex() != hex {
                return Err(crate::error::ItehaasError::InvalidObject(format!("pack entry {} hash mismatch", hex)));
            }
        }
        verified +=1;
    }
    Ok(verified)
}

pub fn gc_after_pack(repo: &Path) -> Result<usize> {
    // Create pack then gc unreachable
    let (_path, _count, _orig, _packed) = create_pack(repo)?;
    crate::gc::gc(repo, true)
}
