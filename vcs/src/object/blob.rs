/// Blob — raw file content.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Blob {
    pub content: Vec<u8>,
}

impl Blob {
    pub fn new(content: Vec<u8>) -> Self {
        Self { content }
    }

    pub fn canonical_body(&self) -> Vec<u8> {
        self.content.clone()
    }
}
