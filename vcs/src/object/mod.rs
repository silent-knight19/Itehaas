pub mod blob;
pub mod commit;
pub mod store;
pub mod tag;
pub mod tree;

use crate::error::{ItehaasError, Result};
use crate::hash::{Hash, Hasher};

pub use blob::Blob;
pub use commit::{Commit, Signature};
pub use tag::Tag;
pub use tree::{Tree, TreeEntry};

/// Object enum — all types.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Object {
    Blob(Blob),
    Tree(Tree),
    Commit(Commit),
    Tag(Tag),
}

impl Object {
    pub fn object_type(&self) -> &'static str {
        match self {
            Self::Blob(_) => "blob",
            Self::Tree(_) => "tree",
            Self::Commit(_) => "commit",
            Self::Tag(_) => "tag",
        }
    }

    pub fn canonical_body(&self) -> Vec<u8> {
        match self {
            Self::Blob(b) => b.canonical_body(),
            Self::Tree(t) => t.canonical_body(),
            Self::Commit(c) => c.canonical_body(),
            Self::Tag(t) => t.canonical_body(),
        }
    }

    /// canonical_header + "\0" + canonical_body
    pub fn canonical_bytes(&self) -> Vec<u8> {
        let body = self.canonical_body();
        let header = format!("{} {}", self.object_type(), body.len());
        let mut out = Vec::with_capacity(header.len() + 1 + body.len());
        out.extend_from_slice(header.as_bytes());
        out.push(0x00);
        out.extend_from_slice(&body);
        out
    }

    /// Hash on uncompressed canonical bytes.
    pub fn hash(&self, hasher: &dyn Hasher) -> Hash {
        hasher.hash(&self.canonical_bytes())
    }

    /// Parse body for a given type. Used on read.
    pub fn parse(object_type: &str, body: Vec<u8>) -> Result<Self> {
        match object_type {
            "blob" => Ok(Self::Blob(Blob::new(body))),
            "tree" => parse_tree(body),
            "commit" => parse_commit(body),
            "tag" => parse_tag(body),
            other => Err(ItehaasError::InvalidObject(format!(
                "unknown object type: {other}"
            ))),
        }
    }
}

fn parse_tree(body: Vec<u8>) -> Result<Object> {
    let mut entries = Vec::new();
    let mut pos = 0usize;
    while pos < body.len() {
        // Find space (mode end)
        let space = body[pos..]
            .iter()
            .position(|&b| b == b' ')
            .ok_or_else(|| ItehaasError::InvalidObject("tree: missing space".into()))?;
        let mode_str = std::str::from_utf8(&body[pos..pos + space])
            .map_err(|_| ItehaasError::InvalidObject("tree: invalid mode utf8".into()))?;
        let mode = u32::from_str_radix(mode_str, 8)
            .map_err(|_| ItehaasError::InvalidObject(format!("tree: invalid mode {mode_str}")))?;
        pos += space + 1;
        // Find null (name end)
        let nul = body[pos..]
            .iter()
            .position(|&b| b == 0x00)
            .ok_or_else(|| ItehaasError::InvalidObject("tree: missing null".into()))?;
        let name = std::str::from_utf8(&body[pos..pos + nul])
            .map_err(|_| ItehaasError::InvalidObject("tree: invalid name utf8".into()))?
            .to_string();
        if name.is_empty() || name.contains('/') || name.contains('\0') {
            return Err(ItehaasError::InvalidObject(format!(
                "tree: invalid name {name:?}"
            )));
        }
        pos += nul + 1;
        // Hash raw bytes: we don't know algo yet. For Phase 1 we infer from remaining.
        // Actual hash length will be validated by store against repo algo.
        // Here we take 32 bytes if at least 32 remain, else error.
        // We need algo info; store will re-validate length. For now assume 32.
        // To allow algo-agnostic parsing, we store bytes and algo will be injected by store.
        // As a compromise, parse as 32B and store will replace algo if needed.
        // For correctness, we require at least 32 bytes remain.
        if body.len() - pos < 32 {
            return Err(ItehaasError::InvalidObject(
                "tree: truncated hash".into(),
            ));
        }
        // We don't know HashAlgo at this layer; create with Sha256 placeholder.
        // Store layer will validate and re-tag if needed (but Phase 1 is SHA-256 only, so ok).
        let hash_bytes = body[pos..pos + 32].to_vec();
        let hash = Hash::new(crate::hash::HashAlgo::Sha256, hash_bytes)?;
        pos += 32;
        entries.push(TreeEntry { mode, name, hash });
    }
    // Validate sorted & dedup? Tree::new does it. But we need to allow unsorted input to detect?
    // We check that entries are sorted; if not, error per determinism spec.
    for w in entries.windows(2) {
        if w[0].name.as_bytes() >= w[1].name.as_bytes() {
            if w[0].name == w[1].name {
                return Err(ItehaasError::InvalidObject(format!(
                    "tree: duplicate entry {}",
                    w[0].name
                )));
            } else {
                return Err(ItehaasError::InvalidObject(format!(
                    "tree: entries not sorted: {} before {}",
                    w[0].name, w[1].name
                )));
            }
        }
    }
    Ok(Object::Tree(Tree { entries }))
}

fn parse_commit(body: Vec<u8>) -> Result<Object> {
    use crate::hash::HashAlgo;
    let text = String::from_utf8(body).map_err(|_| ItehaasError::InvalidObject("commit: invalid utf8".into()))?;
    let lines: Vec<&str> = text.split('\n').collect();
    let mut idx = 0usize;
    let mut tree: Option<Hash> = None;
    let mut parents = Vec::new();
    let mut author: Option<Signature> = None;
    let mut committer: Option<Signature> = None;

    // tree line must be first
    if idx >= lines.len() || !lines[idx].starts_with("tree ") {
        return Err(ItehaasError::InvalidObject("commit: missing tree".into()));
    }
    let tree_hex = &lines[idx][5..];
    tree = Some(Hash::from_hex(HashAlgo::Sha256, tree_hex.trim())?);
    idx += 1;

    // parents
    while idx < lines.len() && lines[idx].starts_with("parent ") {
        let h = &lines[idx][7..];
        parents.push(Hash::from_hex(HashAlgo::Sha256, h.trim())?);
        idx += 1;
    }

    // author
    if idx >= lines.len() || !lines[idx].starts_with("author ") {
        return Err(ItehaasError::InvalidObject("commit: missing author".into()));
    }
    author = Some(parse_signature(&lines[idx][7..])?);
    idx += 1;

    // committer
    if idx >= lines.len() || !lines[idx].starts_with("committer ") {
        return Err(ItehaasError::InvalidObject("commit: missing committer".into()));
    }
    committer = Some(parse_signature(&lines[idx][7..])?);
    idx += 1;

    // blank line
    if idx >= lines.len() || !lines[idx].is_empty() {
        return Err(ItehaasError::InvalidObject(
            "commit: missing blank line after committer".into(),
        ));
    }
    idx += 1;

    // rest is message (may contain newlines, re-join with \n)
    let message = if idx < lines.len() {
        lines[idx..].join("\n")
    } else {
        String::new()
    };

    Ok(Object::Commit(Commit {
        tree: tree.unwrap(),
        parents,
        author: author.unwrap(),
        committer: committer.unwrap(),
        message,
    }))
}

fn parse_tag(body: Vec<u8>) -> Result<Object> {
    use crate::hash::HashAlgo;
    let text = String::from_utf8(body).map_err(|_| ItehaasError::InvalidObject("tag: invalid utf8".into()))?;
    let lines: Vec<&str> = text.split('\n').collect();
    let mut idx = 0;
    if idx >= lines.len() || !lines[idx].starts_with("object ") {
        return Err(ItehaasError::InvalidObject("tag: missing object".into()));
    }
    let object_hex = &lines[idx][7..];
    let object = Hash::from_hex(HashAlgo::Sha256, object_hex.trim())?;
    idx += 1;
    if idx >= lines.len() || !lines[idx].starts_with("type ") {
        return Err(ItehaasError::InvalidObject("tag: missing type".into()));
    }
    let object_type = lines[idx][5..].trim().to_string();
    if !["blob", "tree", "commit", "tag"].contains(&object_type.as_str()) {
        return Err(ItehaasError::InvalidObject(format!(
            "tag: invalid type {object_type}"
        )));
    }
    idx += 1;
    if idx >= lines.len() || !lines[idx].starts_with("tag ") {
        return Err(ItehaasError::InvalidObject("tag: missing tag".into()));
    }
    let name = lines[idx][4..].trim().to_string();
    idx += 1;
    if idx >= lines.len() || !lines[idx].starts_with("tagger ") {
        return Err(ItehaasError::InvalidObject("tag: missing tagger".into()));
    }
    let tagger = parse_signature(&lines[idx][7..])?;
    idx += 1;
    if idx >= lines.len() || !lines[idx].is_empty() {
        return Err(ItehaasError::InvalidObject(
            "tag: missing blank line after tagger".into(),
        ));
    }
    idx += 1;
    let message = if idx < lines.len() {
        lines[idx..].join("\n")
    } else {
        String::new()
    };
    Ok(Object::Tag(Tag {
        object,
        object_type,
        name,
        tagger,
        message,
    }))
}

fn parse_signature(s: &str) -> Result<Signature> {
    // Format: "name <email> timestamp tz"
    // Find < and >
    let lt = s.find('<').ok_or_else(|| ItehaasError::InvalidObject(format!("sig missing <: {s}")))?;
    let gt = s.find('>').ok_or_else(|| ItehaasError::InvalidObject(format!("sig missing >: {s}")))?;
    if gt <= lt {
        return Err(ItehaasError::InvalidObject(format!("sig bad brackets: {s}")));
    }
    let name = s[..lt].trim().to_string();
    let email = s[lt + 1..gt].trim().to_string();
    let rest = s[gt + 1..].trim();
    let mut parts = rest.split_whitespace();
    let ts_str = parts
        .next()
        .ok_or_else(|| ItehaasError::InvalidObject(format!("sig missing timestamp: {s}")))?;
    let tz = parts
        .next()
        .ok_or_else(|| ItehaasError::InvalidObject(format!("sig missing tz: {s}")))?;
    if parts.next().is_some() {
        return Err(ItehaasError::InvalidObject(format!("sig extra fields: {s}")));
    }
    let timestamp: i64 = ts_str
        .parse()
        .map_err(|_| ItehaasError::InvalidObject(format!("sig bad timestamp: {s}")))?;
    // Validate via Signature::new
    Signature::new(name, email, timestamp, tz.to_string()).map_err(|e| e)
}
