use crate::error::{ItehaasError, Result};
use crate::hash::Hash;

/// Signature: author / committer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Signature {
    pub name: String,
    pub email: String,
    pub timestamp: i64,
    pub tz_offset: String, // ±HHMM
}

impl Signature {
    pub fn new(name: String, email: String, timestamp: i64, tz_offset: String) -> Result<Self> {
        validate_sig_field(&name, "name")?;
        validate_sig_field(&email, "email")?;
        validate_tz(&tz_offset)?;
        Ok(Self {
            name,
            email,
            timestamp,
            tz_offset,
        })
    }

    pub fn to_canonical(&self) -> String {
        format!("{} <{}> {} {}", self.name, self.email, self.timestamp, self.tz_offset)
    }
}

fn validate_sig_field(s: &str, field: &str) -> Result<()> {
    if s.contains('<') || s.contains('>') || s.contains('\n') || s.contains('\r') || s.contains('\0') {
        return Err(ItehaasError::InvalidObject(format!(
            "invalid signature {field}: {s:?}"
        )));
    }
    if s.is_empty() {
        return Err(ItehaasError::InvalidObject(format!(
            "empty signature {field}"
        )));
    }
    Ok(())
}

fn validate_tz(tz: &str) -> Result<()> {
    if tz.len() != 5 {
        return Err(ItehaasError::InvalidObject(format!("invalid tz: {tz}")));
    }
    let bytes = tz.as_bytes();
    if bytes[0] != b'+' && bytes[0] != b'-' {
        return Err(ItehaasError::InvalidObject(format!("invalid tz: {tz}")));
    }
    for &b in &bytes[1..] {
        if !b.is_ascii_digit() {
            return Err(ItehaasError::InvalidObject(format!("invalid tz: {tz}")));
        }
    }
    let hh: u32 = tz[1..3].parse().map_err(|_| ItehaasError::InvalidObject(format!("invalid tz: {tz}")))?;
    let mm: u32 = tz[3..5].parse().map_err(|_| ItehaasError::InvalidObject(format!("invalid tz: {tz}")))?;
    if hh >= 24 || mm >= 60 {
        return Err(ItehaasError::InvalidObject(format!("invalid tz: {tz}")));
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Commit {
    pub tree: Hash,
    pub parents: Vec<Hash>,
    pub author: Signature,
    pub committer: Signature,
    pub message: String,
}

impl Commit {
    pub fn new(
        tree: Hash,
        parents: Vec<Hash>,
        author: Signature,
        committer: Signature,
        message: String,
    ) -> Self {
        Self {
            tree,
            parents,
            author,
            committer,
            message,
        }
    }

    /// Canonical body per spec — strict field order, LF only.
    pub fn canonical_body(&self) -> Vec<u8> {
        let mut out = String::new();
        out.push_str(&format!("tree {}\n", self.tree.hex()));
        for p in &self.parents {
            out.push_str(&format!("parent {}\n", p.hex()));
        }
        out.push_str(&format!("author {}\n", self.author.to_canonical()));
        out.push_str(&format!("committer {}\n", self.committer.to_canonical()));
        out.push('\n');
        out.push_str(&self.message);
        out.into_bytes()
    }
}
