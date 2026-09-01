use itehaas_lib::config;
use itehaas_lib::hash::{Hash, HashAlgo, Sha256Hasher};
use itehaas_lib::hash::{new_hasher, Hasher};
use itehaas_lib::object::commit::{Commit, Signature};
use itehaas_lib::object::store;
use itehaas_lib::object::{Blob, Object, Tree, TreeEntry};
use std::fs;
use tempfile::TempDir;

fn setup_repo() -> (TempDir, std::path::PathBuf) {
    let dir = TempDir::new().unwrap();
    let repo = dir.path().to_path_buf();
    itehaas_lib::init(&repo, HashAlgo::Sha256).unwrap();
    (dir, repo)
}

fn hasher() -> Box<dyn Hasher> {
    new_hasher(HashAlgo::Sha256).unwrap()
}

#[test]
fn test_empty_blob_hash() {
    // empty blob: header "blob 0\0" -> sha256("blob 0\0") = 473a...
    // Note: SHA256("") = e3b0... is NOT the empty blob hash; blob hash includes header.
    let blob = Blob::new(vec![]);
    let obj = Object::Blob(blob);
    let h = obj.hash(&Sha256Hasher);
    // Compute expected: sha256("blob 0\0")
    let expected_hex = {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(b"blob 0\0");
        hex::encode(hasher.finalize())
    };
    assert_eq!(h.hex(), expected_hex);
    assert_eq!(h.hex(), "473a0f4c3be8a93681a267e3b1e9a7dcda1185436fe141f7749120a303721813");
}

#[test]
fn test_blob_roundtrip() {
    let (_dir, repo) = setup_repo();
    let hsr = hasher();
    let blob = Blob::new(b"hello world".to_vec());
    let obj = Object::Blob(blob);
    let hash = store::write_object(&repo, &obj, hsr.as_ref()).unwrap();
    let read = store::read_object(&repo, &hash, hsr.as_ref()).unwrap();
    match read {
        Object::Blob(b) => assert_eq!(b.content, b"hello world"),
        _ => panic!("expected blob"),
    }
}

#[test]
fn test_blob_binary_roundtrip() {
    let (_dir, repo) = setup_repo();
    let hsr = hasher();
    let data = vec![0u8, 255, 0, 1, 2, 3, b'\n', b'\0'];
    let obj = Object::Blob(Blob::new(data.clone()));
    let hash = store::write_object(&repo, &obj, hsr.as_ref()).unwrap();
    let read = store::read_object(&repo, &hash, hsr.as_ref()).unwrap();
    match read {
        Object::Blob(b) => assert_eq!(b.content, data),
        _ => panic!("expected blob"),
    }
}

#[test]
fn test_same_content_same_hash_dedup() {
    let (_dir, repo) = setup_repo();
    let hsr = hasher();
    let obj1 = Object::Blob(Blob::new(b"dedup".to_vec()));
    let obj2 = Object::Blob(Blob::new(b"dedup".to_vec()));
    let h1 = store::write_object(&repo, &obj1, hsr.as_ref()).unwrap();
    let h2 = store::write_object(&repo, &obj2, hsr.as_ref()).unwrap();
    assert_eq!(h1.hex(), h2.hex());
    // Second write should be dedup — file exists, no error
    let path = store::object_path(&repo, &h1);
    assert!(path.exists());
}

#[test]
fn test_tree_sorted_dedup() {
    let (_dir, repo) = setup_repo();
    let hsr = hasher();
    // Create two blobs for hashes
    let b1 = Object::Blob(Blob::new(b"hello".to_vec()));
    let h1 = store::write_object(&repo, &b1, hsr.as_ref()).unwrap();
    let b2 = Object::Blob(Blob::new(b"world".to_vec()));
    let h2 = store::write_object(&repo, &b2, hsr.as_ref()).unwrap();

    // Create tree with entries shuffled — should sort deterministically
    let e1 = TreeEntry::new(0o100644, "a.txt".into(), h1.clone()).unwrap();
    let e2 = TreeEntry::new(0o100644, "b.txt".into(), h2.clone()).unwrap();
    let tree_shuffled = Tree::new(vec![e2.clone(), e1.clone()]).unwrap();
    let tree_sorted = Tree::new(vec![e1, e2]).unwrap();
    assert_eq!(tree_shuffled.entries, tree_sorted.entries);
    let obj1 = Object::Tree(tree_shuffled);
    let obj2 = Object::Tree(tree_sorted);
    assert_eq!(obj1.hash(hsr.as_ref()).hex(), obj2.hash(hsr.as_ref()).hex());

    // Write and read
    let th = store::write_object(&repo, &obj1, hsr.as_ref()).unwrap();
    let read = store::read_object(&repo, &th, hsr.as_ref()).unwrap();
    match read {
        Object::Tree(t) => {
            assert_eq!(t.entries.len(), 2);
            assert_eq!(t.entries[0].name, "a.txt");
            assert_eq!(t.entries[1].name, "b.txt");
        }
        _ => panic!("expected tree"),
    }
}

#[test]
fn test_tree_duplicate_reject() {
    let h = Hash::from_hex(HashAlgo::Sha256, &"a".repeat(64)).unwrap();
    let e1 = TreeEntry::new(0o100644, "dup.txt".into(), h.clone()).unwrap();
    let e2 = TreeEntry::new(0o100644, "dup.txt".into(), h).unwrap();
    let res = Tree::new(vec![e1, e2]);
    assert!(res.is_err());
}

#[test]
fn test_tree_invalid_name() {
    let h = Hash::from_hex(HashAlgo::Sha256, &"b".repeat(64)).unwrap();
    assert!(TreeEntry::new(0o100644, "a/b".into(), h.clone()).is_err());
    assert!(TreeEntry::new(0o100644, "".into(), h.clone()).is_err());
    assert!(TreeEntry::new(0o100644, "a\0b".into(), h).is_err());
}

#[test]
fn test_tree_invalid_mode() {
    let h = Hash::from_hex(HashAlgo::Sha256, &"c".repeat(64)).unwrap();
    assert!(TreeEntry::new(0o777, "file.txt".into(), h).is_err());
}

#[test]
fn test_commit_roundtrip() {
    let (_dir, repo) = setup_repo();
    let hsr = hasher();
    let blob = Object::Blob(Blob::new(b"content".to_vec()));
    let tree_hash = store::write_object(&repo, &blob, hsr.as_ref()).unwrap();
    // For commit we need a tree object; use a real tree containing blob
    let entry = TreeEntry::new(0o100644, "file.txt".into(), tree_hash.clone()).unwrap();
    let tree = Object::Tree(Tree::new(vec![entry]).unwrap());
    let tree_h = store::write_object(&repo, &tree, hsr.as_ref()).unwrap();

    let sig = Signature::new("Alice".into(), "alice@example.com".into(), 1000000, "+0000".into()).unwrap();
    let commit = Commit::new(tree_h.clone(), vec![], sig.clone(), sig.clone(), "initial\n\nbody".into());
    let obj = Object::Commit(commit);
    let ch = store::write_object(&repo, &obj, hsr.as_ref()).unwrap();
    let read = store::read_object(&repo, &ch, hsr.as_ref()).unwrap();
    match read {
        Object::Commit(c) => {
            assert_eq!(c.tree.hex(), tree_h.hex());
            assert_eq!(c.parents.len(), 0);
            assert_eq!(c.author.name, "Alice");
            assert_eq!(c.message, "initial\n\nbody");
        }
        _ => panic!("expected commit"),
    }
}

#[test]
fn test_commit_with_parents() {
    let (_dir, repo) = setup_repo();
    let hsr = hasher();
    let blob = Object::Blob(Blob::new(b"x".to_vec()));
    let bh = store::write_object(&repo, &blob, hsr.as_ref()).unwrap();
    let entry = TreeEntry::new(0o100644, "x".into(), bh).unwrap();
    let tree = Object::Tree(Tree::new(vec![entry]).unwrap());
    let th = store::write_object(&repo, &tree, hsr.as_ref()).unwrap();
    let sig = Signature::new("Bob".into(), "bob@example.com".into(), 2000, "+0530".into()).unwrap();
    let c1 = Commit::new(th.clone(), vec![], sig.clone(), sig.clone(), "first".into());
    let c1h = store::write_object(&repo, &Object::Commit(c1), hsr.as_ref()).unwrap();
    let c2 = Commit::new(th.clone(), vec![c1h.clone()], sig.clone(), sig.clone(), "second".into());
    let c2h = store::write_object(&repo, &Object::Commit(c2), hsr.as_ref()).unwrap();
    let read = store::read_object(&repo, &c2h, hsr.as_ref()).unwrap();
    match read {
        Object::Commit(c) => {
            assert_eq!(c.parents.len(), 1);
            assert_eq!(c.parents[0].hex(), c1h.hex());
        }
        _ => panic!("expected commit"),
    }
}

#[test]
fn test_corrupt_flip_fails() {
    let (_dir, repo) = setup_repo();
    let hsr = hasher();
    let obj = Object::Blob(Blob::new(b"hello".to_vec()));
    let hash = store::write_object(&repo, &obj, hsr.as_ref()).unwrap();
    let path = store::object_path(&repo, &hash);
    // Flip a byte in compressed file
    let mut data = fs::read(&path).unwrap();
    let mid = data.len() / 2;
    data[mid] ^= 0xFF;
    fs::write(&path, data).unwrap();
    let res = store::read_object(&repo, &hash, hsr.as_ref());
    assert!(res.is_err());
    // Also verify should fail
    let v = store::verify_object(&repo, &hash, hsr.as_ref());
    assert!(v.is_err());
}

#[test]
fn test_missing_object() {
    let (_dir, repo) = setup_repo();
    let hsr = hasher();
    let fake = Hash::from_hex(HashAlgo::Sha256, &"f".repeat(64)).unwrap();
    let res = store::read_object(&repo, &fake, hsr.as_ref());
    assert!(res.is_err());
}

#[test]
fn test_hash_algo_mismatch() {
    let (_dir, repo) = setup_repo();
    let obj = Object::Blob(Blob::new(b"hi".to_vec()));
    // hash with sha256, but try to read with fake sha1 hasher? We simulate by passing sha256 hash but hasher expects sha1 length.
    // For Phase 1, new_hasher(Sha1) returns error, but we can manually test mismatch via Hash length.
    let fake_sha1 = Hash::new(HashAlgo::Sha1, vec![0u8; 20]).unwrap();
    let hsr = hasher();
    let res = store::read_object(&repo, &fake_sha1, hsr.as_ref());
    // hash len 20 vs hasher 32 => HashAlgoMismatch
    assert!(res.is_err());

    // Also write should store correctly; ensure Hash::from_hex validates length
    assert!(Hash::from_hex(HashAlgo::Sha256, &"abc".repeat(3)).is_err());
}

#[test]
fn test_unsupported_algo() {
    let res = new_hasher(HashAlgo::Sha1);
    assert!(res.is_err());
    let res2 = new_hasher(HashAlgo::Blake3);
    assert!(res2.is_err());
}

#[test]
fn test_invalid_hex() {
    assert!(Hash::from_hex(HashAlgo::Sha256, "zzzz").is_err());
    assert!(Hash::from_hex(HashAlgo::Sha256, &"a".repeat(63)).is_err());
    assert!(Hash::from_hex(HashAlgo::Sha256, &"a".repeat(65)).is_err());
}

#[test]
fn test_hex_roundtrip() {
    let h = Hash::from_hex(HashAlgo::Sha256, &"deadbeef".repeat(8)).unwrap();
    assert_eq!(h.hex(), "deadbeef".repeat(8));
}

#[test]
fn test_object_size_limit() {
    let (_dir, repo) = setup_repo();
    let hsr = hasher();
    // Create a blob just over limit (64 MiB + 1)
    let big = vec![b'a'; 64 * 1024 * 1024 + 1];
    let obj = Object::Blob(Blob::new(big));
    let res = store::write_object(&repo, &obj, hsr.as_ref());
    assert!(res.is_err());
}

#[test]
fn test_init_creates_structure() {
    let dir = TempDir::new().unwrap();
    let repo = dir.path().join("myrepo");
    itehaas_lib::init(&repo, HashAlgo::Sha256).unwrap();
    assert!(repo.join(".itehaas").join("HEAD").exists());
    assert!(repo.join(".itehaas").join("config").exists());
    assert!(repo.join(".itehaas").join("objects").exists());
    assert!(repo.join(".itehaas").join("objects").join("pack").exists());
    assert!(repo.join(".itehaas").join("refs").join("heads").exists());
    let head = fs::read_to_string(repo.join(".itehaas/HEAD")).unwrap();
    assert_eq!(head, "ref: refs/heads/main\n");
    let cfg = fs::read_to_string(repo.join(".itehaas/config")).unwrap();
    assert!(cfg.contains("hasher = sha256"));
    // re-init should fail
    assert!(itehaas_lib::init(&repo, HashAlgo::Sha256).is_err());
    // force re-init should succeed
    assert!(itehaas_lib::init_force(&repo, HashAlgo::Sha256).is_ok());
}

#[test]
fn test_verify_success() {
    let (_dir, repo) = setup_repo();
    let hsr = hasher();
    let obj = Object::Blob(Blob::new(b"verify me".to_vec()));
    let h = store::write_object(&repo, &obj, hsr.as_ref()).unwrap();
    assert!(store::verify_object(&repo, &h, hsr.as_ref()).unwrap());
}

#[test]
fn test_tree_raw_bytes_not_hex() {
    // Ensure tree body uses raw 32B, not hex 64 chars
    let h1 = Hash::from_hex(HashAlgo::Sha256, &"11".repeat(32)).unwrap();
    let e = TreeEntry::new(0o100644, "file".into(), h1.clone()).unwrap();
    let tree = Tree::new(vec![e]).unwrap();
    let body = tree.canonical_body();
    // Body should contain raw bytes of hash at end
    assert!(body.ends_with(&h1.bytes));
    assert_eq!(body.len(), "100644 ".len() + "file".len() + 1 + 32);
}

#[test]
fn test_signature_tz_validation() {
    assert!(Signature::new("A".into(), "a@b.com".into(), 0, "+0000".into()).is_ok());
    assert!(Signature::new("A".into(), "a@b.com".into(), 0, "+0530".into()).is_ok());
    assert!(Signature::new("A".into(), "a@b.com".into(), 0, "-0800".into()).is_ok());
    assert!(Signature::new("A".into(), "a@b.com".into(), 0, "0000".into()).is_err());
    assert!(Signature::new("A".into(), "a@b.com".into(), 0, "+2400".into()).is_err());
    assert!(Signature::new("A".into(), "a@b.com".into(), 0, "+0060".into()).is_err());
}
