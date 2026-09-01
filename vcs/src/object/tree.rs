use crate::error::{ItehaasError, Result};
use crate::hash::Hash;

/// Single tree entry.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TreeEntry {
    pub mode: u32,
    pub name: String,
    pub hash: Hash,
}

impl TreeEntry {
    pub fn new(mode: u32, name: String, hash: Hash) -> Result<Self> {
        validate_mode(mode)?;
        validate_name(&name)?;
        Ok(Self { mode, name, hash })
    }
}

fn validate_mode(mode: u32) -> Result<()> {
    match mode {
        0o100644 | 0o100755 | 0o040000 => Ok(()),
        other => Err(ItehaasError::InvalidObject(format!(
            "invalid tree mode: {other:o}"
        ))),
    }
}

fn validate_name(name: &str) -> Result<()> {
    if name.is_empty() {
        return Err(ItehaasError::InvalidObject("empty tree entry name".into()));
    }
    if name.contains('/') || name.contains('\0') {
        return Err(ItehaasError::InvalidObject(format!(
            "invalid tree entry name: {name:?}"
        )));
    }
    Ok(())
}

/// Tree — sorted by name bytewise.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Tree {
    pub entries: Vec<TreeEntry>,
}

impl Tree {
    pub fn new(mut entries: Vec<TreeEntry>) -> Result<Self> {
        // Validate sorted & unique
        for w in entries.windows(2) {
            if w[0].name.as_bytes() >= w[1].name.as_bytes() {
                // Allow construction then canonical sorts; but reject duplicates here
                if w[0].name == w[1].name {
                    return Err(ItehaasError::InvalidObject(format!(
                        "duplicate tree entry: {}",
                        w[0].name
                    )));
                }
            }
        }
        // Deterministic: sort bytewise
        entries.sort_by(|a, b| a.name.as_bytes().cmp(b.name.as_bytes()));
        // Check duplicates after sort
        for w in entries.windows(2) {
            if w[0].name == w[1].name {
                return Err(ItehaasError::InvalidObject(format!(
                    "duplicate tree entry: {}",
                    w[0].name
                )));
            }
        }
        Ok(Self { entries })
    }

    /// Canonical body: concat of "<mode> <name>\0<hash_raw>" per entry.
    pub fn canonical_body(&self) -> Vec<u8> {
        let mut out = Vec::new();
        for e in &self.entries {
            let mode_str = format!("{:o}", e.mode);
            out.extend_from_slice(mode_str.as_bytes());
            out.push(b' ');
            out.extend_from_slice(e.name.as_bytes());
            out.push(0x00);
            out.extend_from_slice(&e.hash.bytes);
        }
        out
    }
}
