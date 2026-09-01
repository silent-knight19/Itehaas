use crate::error::{ItehaasError, Result};
use crate::hash::Hash;
use crate::object::commit::Signature;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Tag {
    pub object: Hash,
    pub object_type: String,
    pub name: String,
    pub tagger: Signature,
    pub message: String,
}

impl Tag {
    pub fn new(
        object: Hash,
        object_type: String,
        name: String,
        tagger: Signature,
        message: String,
    ) -> Result<Self> {
        if !["blob", "tree", "commit", "tag"].contains(&object_type.as_str()) {
            return Err(ItehaasError::InvalidObject(format!(
                "invalid tag target type: {object_type}"
            )));
        }
        if name.is_empty() || name.contains('\n') {
            return Err(ItehaasError::InvalidObject(format!("invalid tag name: {name:?}")));
        }
        Ok(Self {
            object,
            object_type,
            name,
            tagger,
            message,
        })
    }

    pub fn canonical_body(&self) -> Vec<u8> {
        let mut out = String::new();
        out.push_str(&format!("object {}\n", self.object.hex()));
        out.push_str(&format!("type {}\n", self.object_type));
        out.push_str(&format!("tag {}\n", self.name));
        out.push_str(&format!("tagger {}\n", self.tagger.to_canonical()));
        out.push('\n');
        out.push_str(&self.message);
        out.into_bytes()
    }
}
