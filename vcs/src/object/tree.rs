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

pub fn is_forbidden_component(name: &str) -> bool {
    if name.is_empty() || name == "." || name == ".." {
        return true;
    }
    if name.contains('/') || name.contains('\\') || name.contains('\0') {
        return true;
    }
    if name.ends_with('.') || name.ends_with(' ') {
        return true;
    }
    let lower = name.to_ascii_lowercase();
    if lower == ".itehaas" || lower == ".git" || lower == ".hg" || lower == ".svn" {
        return true;
    }
    if lower.starts_with("itehaa~") || lower.starts_with("git~") {
        return true;
    }
    let base = lower.split('.').next().unwrap_or(&lower);
    matches!(
        base,
        "con" | "prn" | "aux" | "nul"
            | "com1" | "com2" | "com3" | "com4" | "com5" | "com6" | "com7" | "com8" | "com9"
            | "lpt1" | "lpt2" | "lpt3" | "lpt4" | "lpt5" | "lpt6" | "lpt7" | "lpt8" | "lpt9"
    )
}

fn validate_name(name: &str) -> Result<()> {
    if is_forbidden_component(name) {
        return Err(ItehaasError::InvalidObject(format!(
            "invalid or forbidden tree entry name: {name:?}"
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
