use std::fs;
use itehaas_lib::hash::{HashAlgo, Hasher};
use itehaas_lib::object::{Blob, Commit, Signature, Tree, TreeEntry};
use itehaas_lib::object::store::{read_object, write_object};
use tempfile::TempDir;

// Simple deterministic PRNG (xorshift64)
struct XorShift64(u64);
impl XorShift64 {
    fn new(seed: u64) -> Self { Self(seed) }
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
    fn next_bytes(&mut self, len: usize) -> Vec<u8> {
        let mut v = Vec::with_capacity(len);
        while v.len() < len {
            let n = self.next();
            v.extend_from_slice(&n.to_le_bytes());
        }
        v.truncate(len);
        v
    }
    fn next_string(&mut self, len: usize) -> String {
        let bytes = self.next_bytes(len);
        bytes.iter().map(|b| (b % 26 + b'a') as char).collect()
    }
}

fn init_tmp(algo: HashAlgo) -> (TempDir, std::path::PathBuf, Box<dyn Hasher>) {
    let td = TempDir::new().unwrap();
    let repo = itehaas_lib::init(td.path(), algo).unwrap();
    let hasher = itehaas_lib::hash::new_hasher(algo).unwrap();
    (td, repo, hasher)
}

#[test]
fn prop_blob_roundtrip_random() {
    let mut rng = XorShift64::new(0x12345678);
    for i in 0..50 {
        let size = (rng.next() % 2048) as usize;
        let data = rng.next_bytes(size);
        let (_td, repo, hasher) = init_tmp(HashAlgo::Sha256);
        let blob = Blob::new(data.clone());
        let hash = write_object(&repo, &itehaas_lib::object::Object::Blob(blob), hasher.as_ref()).unwrap();
        let read = read_object(&repo, &hash, hasher.as_ref()).unwrap();
        match read {
            itehaas_lib::object::Object::Blob(b) => assert_eq!(b.content, data, "blob mismatch iter {}", i),
            _ => panic!("expected blob"),
        }
        // Verify determinism: same content -> same hash
        let blob2 = Blob::new(data);
        let hash2 = write_object(&repo, &itehaas_lib::object::Object::Blob(blob2), hasher.as_ref()).unwrap();
        assert_eq!(hash, hash2);
    }
}

#[test]
fn prop_tree_sorted_determinism() {
    let mut rng = XorShift64::new(0xdeadbeef);
    for _ in 0..30 {
        let n = 2 + (rng.next() % 8) as usize;
        let (_td, repo, hasher) = init_tmp(HashAlgo::Sha256);
        let mut entries: Vec<TreeEntry> = Vec::new();
        for i in 0..n {
            let name = format!("file_{}_{}.txt", i, rng.next_string(3));
            let sz = rng.next() % 50;
            let content = rng.next_bytes(10 + sz as usize);
            let blob = Blob::new(content);
            let hash = write_object(&repo, &itehaas_lib::object::Object::Blob(blob), hasher.as_ref()).unwrap();
            let mode = if rng.next() % 2 == 0 { 0o100644 } else { 0o100755 };
            entries.push(TreeEntry::new(mode, name, hash).unwrap());
        }
        // Create tree with shuffled order vs sorted order -> same hash
        let mut shuffled = entries.clone();
        // simple shuffle: reverse
        shuffled.reverse();
        let tree_shuffled = Tree::new(shuffled).unwrap();
        let tree_sorted = Tree::new(entries).unwrap();
        let hash_shuffled = write_object(&repo, &itehaas_lib::object::Object::Tree(tree_shuffled), hasher.as_ref()).unwrap();
        let hash_sorted = write_object(&repo, &itehaas_lib::object::Object::Tree(tree_sorted), hasher.as_ref()).unwrap();
        assert_eq!(hash_shuffled, hash_sorted, "tree sorting determinism failed");

        // Round-trip read
        let read = read_object(&repo, &hash_sorted, hasher.as_ref()).unwrap();
        match read {
            itehaas_lib::object::Object::Tree(t) => {
                // entries should be sorted
                let names: Vec<_> = t.entries.iter().map(|e| &e.name).collect();
                let mut sorted = names.clone();
                sorted.sort();
                assert_eq!(names, sorted);
            },
            _ => panic!("expected tree"),
        }
    }
}

#[test]
fn prop_commit_roundtrip_random() {
    let mut rng = XorShift64::new(0xabcdef);
    for i in 0..20 {
        let (_td, repo, hasher) = init_tmp(HashAlgo::Sha256);
        // Create a tree
        let blob = Blob::new(rng.next_bytes(20));
        let bhash = write_object(&repo, &itehaas_lib::object::Object::Blob(blob), hasher.as_ref()).unwrap();
        let entry = TreeEntry::new(0o100644, format!("f{}.txt", i), bhash).unwrap();
        let tree = Tree::new(vec![entry]).unwrap();
        let thash = write_object(&repo, &itehaas_lib::object::Object::Tree(tree), hasher.as_ref()).unwrap();

        let msg = rng.next_string(20);
        let sig = Signature::new("PropTester".into(), "prop@test.com".into(), 1000000 + i as i64 * 100, "+0000".into()).unwrap();
        let commit = Commit::new(thash.clone(), vec![], sig.clone(), sig, msg.clone());
        let chash = write_object(&repo, &itehaas_lib::object::Object::Commit(commit), hasher.as_ref()).unwrap();
        let read = read_object(&repo, &chash, hasher.as_ref()).unwrap();
        match read {
            itehaas_lib::object::Object::Commit(c) => {
                assert_eq!(c.tree, thash);
                assert_eq!(c.message, msg);
            },
            _ => panic!("expected commit"),
        }
        // Verify commit hash is deterministic
        let sig2 = Signature::new("PropTester".into(), "prop@test.com".into(), 1000000 + i as i64 * 100, "+0000".into()).unwrap();
        let commit2 = Commit::new(thash, vec![], sig2.clone(), sig2, msg);
        let chash2 = write_object(&repo, &itehaas_lib::object::Object::Commit(commit2), hasher.as_ref()).unwrap();
        assert_eq!(chash, chash2);
    }
}

#[test]
fn prop_hash_determinism() {
    let mut rng = XorShift64::new(0x9999);
    for _ in 0..30 {
        let n = rng.next();
        let data = rng.next_bytes((n % 1024) as usize);
        let h1 = {
            let hasher = itehaas_lib::hash::new_hasher(HashAlgo::Sha256).unwrap();
            hasher.hash(&data).hex()
        };
        let h2 = {
            let hasher = itehaas_lib::hash::new_hasher(HashAlgo::Sha256).unwrap();
            hasher.hash(&data).hex()
        };
        assert_eq!(h1, h2);
        // hex round-trip
        let hash = itehaas_lib::hash::Hash::from_hex(HashAlgo::Sha256, &h1).unwrap();
        assert_eq!(hash.hex(), h1);
    }
}

#[test]
fn test_metrics_endpoint_exists() {
    let index = fs::read_to_string("../server/src/index.ts").unwrap();
    assert!(index.contains("/metrics"), "metrics endpoint missing");
    let metrics = fs::read_to_string("../server/src/lib/metrics.ts").unwrap();
    assert!(metrics.contains("itehaas_http_requests_total") || index.contains("itehaas_http_requests_total"), "metrics http total missing");
    assert!(metrics.contains("itehaas_uptime_seconds") || index.contains("itehaas_uptime_seconds"), "uptime metric missing");
    assert!(metrics.contains("renderMetrics") || metrics.contains("itehaas_ci_pipelines_total"), "metrics lib missing");
}
