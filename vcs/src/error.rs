use thiserror::Error;

#[derive(Debug, Error)]
pub enum ItehaasError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("unsupported hash algorithm: {0}")]
    UnsupportedAlgo(String),

    #[error("hash algorithm mismatch: expected {expected}, got {got}")]
    HashAlgoMismatch { expected: String, got: String },

    #[error("hash mismatch: expected {expected}, got {got}")]
    HashMismatch { expected: String, got: String },

    #[error("corrupt object {hash}: {reason}")]
    CorruptObject { hash: String, reason: String },

    #[error("invalid object: {0}")]
    InvalidObject(String),

    #[error("object not found: {0}")]
    NotFound(String),

    #[error("object too large: {size} > {limit}")]
    ObjectTooLarge { size: usize, limit: usize },

    #[error("repository not found at {0}")]
    RepoNotFound(String),

    #[error("not a valid hash: {0}")]
    InvalidHash(String),

    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, ItehaasError>;
