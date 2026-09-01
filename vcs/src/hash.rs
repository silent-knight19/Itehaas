use crate::error::{ItehaasError, Result};
use sha2::{Digest, Sha256};

/// Hash algorithm. One repo = one algo (format invariant).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HashAlgo {
    Sha256,
    Sha1,
    Blake3,
}

impl HashAlgo {
    pub fn from_str(s: &str) -> Result<Self> {
        match s.to_ascii_lowercase().as_str() {
            "sha256" => Ok(Self::Sha256),
            "sha1" => Ok(Self::Sha1),
            "blake3" => Ok(Self::Blake3),
            other => Err(ItehaasError::InvalidObject(format!(
                "unknown hash algo: {other}"
            ))),
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Sha256 => "sha256",
            Self::Sha1 => "sha1",
            Self::Blake3 => "blake3",
        }
    }

    pub fn hash_len(&self) -> usize {
        match self {
            Self::Sha256 => 32,
            Self::Sha1 => 20,
            Self::Blake3 => 32,
        }
    }

    pub fn hex_len(&self) -> usize {
        self.hash_len() * 2
    }
}

impl std::fmt::Display for HashAlgo {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Content hash. Always tied to an algo.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Hash {
    pub algo: HashAlgo,
    pub bytes: Vec<u8>,
}

impl Hash {
    pub fn new(algo: HashAlgo, bytes: Vec<u8>) -> Result<Self> {
        if bytes.len() != algo.hash_len() {
            return Err(ItehaasError::InvalidHash(format!(
                "hash length {} != expected {} for {}",
                bytes.len(),
                algo.hash_len(),
                algo.as_str()
            )));
        }
        Ok(Self { algo, bytes })
    }

    pub fn hex(&self) -> String {
        hex::encode(&self.bytes)
    }

    pub fn from_hex(algo: HashAlgo, s: &str) -> Result<Self> {
        if s.len() != algo.hex_len() {
            return Err(ItehaasError::InvalidHash(format!(
                "hex length {} != {} for {}",
                s.len(),
                algo.hex_len(),
                algo.as_str()
            )));
        }
        let bytes = hex::decode(s).map_err(|e| ItehaasError::InvalidHash(e.to_string()))?;
        Self::new(algo, bytes)
    }
}

impl std::fmt::Display for Hash {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.hex())
    }
}

/// Abstraction trait — future SHA-1/BLAKE3/Git compat behind same interface.
pub trait Hasher: Send + Sync {
    fn algo(&self) -> HashAlgo;
    fn hash_len(&self) -> usize;
    fn hash(&self, data: &[u8]) -> Hash;
    fn name(&self) -> &'static str;
}

pub struct Sha256Hasher;

impl Hasher for Sha256Hasher {
    fn algo(&self) -> HashAlgo {
        HashAlgo::Sha256
    }
    fn hash_len(&self) -> usize {
        32
    }
    fn hash(&self, data: &[u8]) -> Hash {
        let mut h = Sha256::new();
        h.update(data);
        let out = h.finalize();
        // SAFETY: sha256 is 32 bytes
        Hash::new(HashAlgo::Sha256, out.to_vec()).expect("sha256 len")
    }
    fn name(&self) -> &'static str {
        "sha256"
    }
}

/// Factory — Phase 1 SHA-256 only; others return UnsupportedAlgo.
pub fn new_hasher(algo: HashAlgo) -> Result<Box<dyn Hasher>> {
    match algo {
        HashAlgo::Sha256 => Ok(Box::new(Sha256Hasher)),
        other => Err(ItehaasError::UnsupportedAlgo(other.as_str().to_string())),
    }
}
