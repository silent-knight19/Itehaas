use std::fs;
use std::io::Write;
use flate2::write::ZlibEncoder;
use flate2::Compression;
use tempfile::TempDir;
use itehaas_lib::{init, hash::HashAlgo, object::{Blob, Object, Tree, TreeEntry}, hash::Hash};

#[test]
fn test_bomb_64m_decompression_guard() {
    let tmp = TempDir::new().unwrap();
    let repo = tmp.path().join("repo");
    fs::create_dir_all(&repo).unwrap();
    init(&repo, HashAlgo::Sha256).unwrap();
    let algo = itehaas_lib::config::read_hasher(&repo).unwrap();
    let hasher = itehaas_lib::hash::new_hasher(algo).unwrap();
    // Create a bomb: header "blob 67108865" (64M+1) + body of 64M+1 zeros, compressed small
    let size = 64 * 1024 * 1024 + 1;
    let header = format!("blob {}", size);
    let mut canonical = Vec::new();
    canonical.extend_from_slice(header.as_bytes());
    canonical.push(0);
    canonical.extend_from_slice(&vec![b'a'; size]);
    assert!(canonical.len() > 64 * 1024 * 1024);
    let hash = hasher.hash(&canonical);
    // Compress
    let mut enc = ZlibEncoder::new(Vec::new(), Compression::default());
    enc.write_all(&canonical).unwrap();
    let compressed = enc.finish().unwrap();
    // Write directly to object path (bypass write_object size check)
    let path = itehaas_lib::object::store::object_path(&repo, &hash);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, &compressed).unwrap();
    // Now read should fail with ObjectTooLarge, not OOM or panic
    let res = itehaas_lib::object::store::read_object(&repo, &hash, hasher.as_ref());
    assert!(res.is_err());
    let err = format!("{:?}", res.unwrap_err());
    assert!(err.contains("too large") || err.contains("ObjectTooLarge") || err.contains("64"), "expected ObjectTooLarge, got {}", err);
}

#[test]
fn test_truncated_zlib_corrupt() {
    let tmp = TempDir::new().unwrap();
    let repo = tmp.path().join("repo2");
    fs::create_dir_all(&repo).unwrap();
    init(&repo, HashAlgo::Sha256).unwrap();
    let algo = itehaas_lib::config::read_hasher(&repo).unwrap();
    let hasher = itehaas_lib::hash::new_hasher(algo).unwrap();
    let blob = Blob::new(b"hello".to_vec());
    let obj = Object::Blob(blob);
    let hash = itehaas_lib::object::store::write_object(&repo, &obj, hasher.as_ref()).unwrap();
    let path = itehaas_lib::object::store::object_path(&repo, &hash);
    let mut data = fs::read(&path).unwrap();
    data.truncate(10); // truncate
    fs::write(&path, &data).unwrap();
    let res = itehaas_lib::object::store::read_object(&repo, &hash, hasher.as_ref());
    assert!(res.is_err());
}

#[test]
fn test_duplicate_tree_rejected() {
    let algo = HashAlgo::Sha256;
    let h1 = Hash::from_hex(algo, &"a".repeat(64)).unwrap();
    let h2 = Hash::from_hex(algo, &"b".repeat(64)).unwrap();
    let body = {
        let mut v = Vec::new();
        v.extend_from_slice(b"100644 a\0");
        v.extend_from_slice(&h1.bytes);
        v.extend_from_slice(b"100644 a\0");
        v.extend_from_slice(&h2.bytes);
        v
    };
    let res = Object::parse(algo, "tree", body);
    assert!(res.is_err());
    assert!(format!("{:?}", res.unwrap_err()).contains("duplicate"));
}

#[test]
fn test_invalid_mode_rejected() {
    let algo = HashAlgo::Sha256;
    let h = Hash::from_hex(algo, &"a".repeat(64)).unwrap();
    let mut body = Vec::new();
    body.extend_from_slice(b"100600 bad\0");
    body.extend_from_slice(&h.bytes);
    let res = Object::parse(algo, "tree", body);
    // TreeEntry::new should reject invalid mode, but parse_tree may not check mode until Tree::new?
    // Our parse_tree currently doesn't validate mode, only checks via TreeEntry::new later? Actually it does via Tree::new
    // But parse_tree directly pushes entries without mode validation, then Tree::new will check
    // For this test, we expect error
    assert!(res.is_err());
}

#[test]
fn test_huge_commit_message_rejected() {
    let algo = HashAlgo::Sha256;
    let tree = Hash::from_hex(algo, &"a".repeat(64)).unwrap();
    let sig = "Test <test@example.com> 0 +0000";
    let huge_msg = "a".repeat(1_000_001);
    let body = format!("tree {}\nauthor {}\ncommitter {}\n\n{}", tree.hex(), sig, sig, huge_msg);
    let res = Object::parse(algo, "commit", body.into_bytes());
    assert!(res.is_err());
    assert!(format!("{:?}", res.unwrap_err()).contains("too large"));
}

#[test]
fn test_tree_too_many_entries() {
    let algo = HashAlgo::Sha256;
    let mut body = Vec::new();
    for i in 0..10001 {
        let name = format!("f{:05}", i);
        let h = Hash::from_hex(algo, &format!("{:064x}", i)).unwrap();
        body.extend_from_slice(format!("100644 {}\0", name).as_bytes());
        body.extend_from_slice(&h.bytes);
    }
    let res = Object::parse(algo, "tree", body);
    assert!(res.is_err());
    assert!(format!("{:?}", res.unwrap_err()).contains("too large"));
}

#[test]
fn test_deep_tree_build_limit() {
    let tmp = TempDir::new().unwrap();
    let repo = tmp.path().join("repo3");
    fs::create_dir_all(&repo).unwrap();
    init(&repo, HashAlgo::Sha256).unwrap();
    let algo = itehaas_lib::config::read_hasher(&repo).unwrap();
    let hasher = itehaas_lib::hash::new_hasher(algo).unwrap();
    // Create 150 nested dirs via index entries: a/b/c/.../file
    let mut entries = Vec::new();
    // Build a path with 150 components
    let deep_path: String = (0..150).map(|i| format!("d{}", i)).collect::<Vec<_>>().join("/") + "/file.txt";
    let blob = Blob::new(b"hi".to_vec());
    let hash = itehaas_lib::object::store::write_object(&repo, &Object::Blob(blob), hasher.as_ref()).unwrap();
    let entry = itehaas_lib::index::IndexEntry::new(deep_path, hash, 0o100644);
    entries.push(&entry);
    // This should hit depth limit 100
    let res = itehaas_lib::tree_builder::build_tree_from_index(&repo, &entries, hasher.as_ref());
    assert!(res.is_err());
    assert!(format!("{:?}", res.unwrap_err()).contains("too deep"));
}

#[test]
fn test_pack_bomb_count_limit() {
    let tmp = TempDir::new().unwrap();
    let repo = tmp.path().join("repo4");
    fs::create_dir_all(&repo).unwrap();
    init(&repo, HashAlgo::Sha256).unwrap();
    // Create a fake pack with count 20000 > 10000
    let pack_dir = repo.join(".itehaas/objects/pack");
    fs::create_dir_all(&pack_dir).unwrap();
    let pack_path = pack_dir.join("pack-bomb.pack");
    let mut f = fs::File::create(&pack_path).unwrap();
    f.write_all(b"ITEHAAS PACK v1\n").unwrap();
    f.write_all(&(20000u32.to_be_bytes())).unwrap();
    // Don't need to write entries, just verify that verify_pack rejects count
    let res = itehaas_lib::pack::verify_pack(&repo, &pack_path);
    assert!(res.is_err());
    assert!(format!("{:?}", res.unwrap_err()).contains("too many"));
}
