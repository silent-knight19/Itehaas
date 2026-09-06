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

#[test]
fn test_pack_entry_declared_length_limit() {
    let tmp = TempDir::new().unwrap();
    let repo = tmp.path().join("repo5");
    fs::create_dir_all(&repo).unwrap();
    init(&repo, HashAlgo::Sha256).unwrap();
    let pack_dir = repo.join(".itehaas/objects/pack");
    fs::create_dir_all(&pack_dir).unwrap();
    let pack_path = pack_dir.join("pack-len-bomb.pack");
    let mut f = fs::File::create(&pack_path).unwrap();
    f.write_all(b"ITEHAAS PACK v1\n").unwrap();
    f.write_all(&(1u32.to_be_bytes())).unwrap(); // count = 1
    f.write_all(&[b'0'; 64]).unwrap(); // 64 hex bytes
    f.write_all(&(0xFFFFFFFFu32.to_be_bytes())).unwrap(); // declared len = 4GB
    let res = itehaas_lib::pack::verify_pack(&repo, &pack_path);
    assert!(res.is_err());
    let err = format!("{:?}", res.unwrap_err());
    assert!(err.contains("too large"));
}

#[test]
fn test_tree_cycle_detection() {
    let tmp = TempDir::new().unwrap();
    let repo = tmp.path().join("repo_cycle");
    fs::create_dir_all(&repo).unwrap();
    init(&repo, HashAlgo::Sha256).unwrap();
    let algo = itehaas_lib::config::read_hasher(&repo).unwrap();
    let hasher = itehaas_lib::hash::new_hasher(algo).unwrap();

    let dummy_hash = Hash { algo: HashAlgo::Sha256, bytes: vec![1u8; 32] };
    let entry_a = TreeEntry::new(0o100644, "file.txt".into(), dummy_hash).unwrap();
    let tree_a = Tree::new(vec![entry_a]).unwrap();
    let hash_a = itehaas_lib::object::store::write_object(&repo, &Object::Tree(tree_a), hasher.as_ref()).unwrap();

    // Verify normal flatten works
    let normal_map = itehaas_lib::tree_builder::flatten_tree_root(&repo, &hash_a, hasher.as_ref()).unwrap();
    assert_eq!(normal_map.len(), 1);

    // Now test cycle detection: if hash_a is already in active ancestors, it must reject immediately with cycle detected
    let mut active = std::collections::BTreeSet::new();
    active.insert(hash_a.hex());
    let mut memo = std::collections::HashMap::new();
    let mut out = std::collections::BTreeMap::new();
    let res = itehaas_lib::tree_builder::flatten_tree_with_ancestors(&repo, &hash_a, hasher.as_ref(), "", &mut out, 0, &mut active, &mut memo);
    assert!(res.is_err());
    let err = format!("{:?}", res.unwrap_err());
    assert!(err.contains("cycle detected"), "expected cycle error, got: {}", err);
}

#[test]
fn test_signature_rejection_crlf_null() {
    use itehaas_lib::object::commit::Signature;

    // CRLF in name or email must be rejected
    assert!(Signature::new("User\r\nInjected".into(), "user@example.com".into(), 0, "+0000".into()).is_err());
    assert!(Signature::new("User".into(), "user@example.com\r\ninjected".into(), 0, "+0000".into()).is_err());

    // Null bytes must be rejected
    assert!(Signature::new("User\0bad".into(), "user@example.com".into(), 0, "+0000".into()).is_err());
    assert!(Signature::new("User".into(), "user@example.com\0bad".into(), 0, "+0000".into()).is_err());

    // Valid signature must succeed
    assert!(Signature::new("Alice User".into(), "alice@example.com".into(), 1600000000, "+0530".into()).is_ok());
}

// ---- S6-fresh: adversarial parser corpus ----

fn s6_test_commit_body(tree_hex: &str, msg: &str) -> Vec<u8> {
    format!(
        "tree {}\nparent {}\nauthor T <t@e.c> 0 +0000\ncommitter T <t@e.c> 0 +0000\n\n{}",
        tree_hex,
        "b".repeat(64),
        msg
    )
    .into_bytes()
}

#[test]
fn test_tree_forbidden_names_rejected_at_parse() {
    let algo = HashAlgo::Sha256;
    let h = Hash::from_hex(algo, &"a".repeat(64)).unwrap();
    for bad in [".itehaas", ".Itehaas", ".GIT", "CON", "nul.txt", "a\x00b", "a\x07b", "a\u{200e}b", "itehaa~1", ".."] {
        let mut body = Vec::new();
        body.extend_from_slice(format!("100644 {}\0", bad).as_bytes());
        body.extend_from_slice(&h.bytes);
        let res = Object::parse(algo, "tree", body);
        assert!(res.is_err(), "name {:?} must be rejected at parse", bad);
    }
    // i18n names still parse
    for good in ["café.txt", "日本語.md", ".gitignore", "my_itehaas_doc.txt"] {
        let mut body = Vec::new();
        body.extend_from_slice(format!("100644 {}\0", good).as_bytes());
        body.extend_from_slice(&h.bytes);
        assert!(Object::parse(algo, "tree", body).is_ok(), "name {:?} must parse", good);
    }
}

#[test]
fn test_commit_many_newlines_no_alloc_blowup() {
    let algo = HashAlgo::Sha256;
    // 500k newlines (500KB message, under the 1M limit) must parse correctly and fast.
    let msg = "\n".repeat(500_000);
    let body = s6_test_commit_body(&"a".repeat(64), &msg);
    let start = std::time::Instant::now();
    let res = Object::parse(algo, "commit", body);
    assert!(res.is_ok(), "500k-newline message must parse");
    if let Object::Commit(c) = res.unwrap() {
        assert_eq!(c.message, msg, "message must round-trip byte-identically");
    } else {
        panic!("expected commit");
    }
    assert!(start.elapsed().as_secs() < 10, "parse must not blow up");
}

#[test]
fn test_commit_overlong_message_still_rejected() {
    let algo = HashAlgo::Sha256;
    let body = s6_test_commit_body(&"a".repeat(64), &"z".repeat(1_000_001));
    let res = Object::parse(algo, "commit", body);
    assert!(res.is_err());
    assert!(format!("{:?}", res.unwrap_err()).contains("too large"));
}

#[test]
fn test_commit_header_line_count_capped() {
    let algo = HashAlgo::Sha256;
    // 150 parents exceeds both the 100-parent limit and the 128 header-line cap.
    let mut body = format!("tree {}\n", "a".repeat(64));
    for _ in 0..150 {
        body.push_str(&format!("parent {}\n", "b".repeat(64)));
    }
    body.push_str("author T <t@e.c> 0 +0000\ncommitter T <t@e.c> 0 +0000\n\nmsg");
    assert!(Object::parse(algo, "commit", body.into_bytes()).is_err());
}

#[test]
fn test_commit_trailing_garbage_after_committer_rejected() {
    let algo = HashAlgo::Sha256;
    let body = format!(
        "tree {}\nauthor T <t@e.c> 0 +0000\ncommitter T <t@e.c> 0 +0000\nextra: smuggled\n\nmsg",
        "a".repeat(64)
    );
    assert!(Object::parse(algo, "commit", body.into_bytes()).is_err());
}

#[test]
fn test_tag_many_newlines_no_alloc_blowup() {
    let algo = HashAlgo::Sha256;
    let msg = "\n".repeat(200_000);
    let body = format!(
        "object {}\ntype commit\ntag v1\ntagger T <t@e.c> 0 +0000\n\n{}",
        "a".repeat(64),
        msg
    );
    let res = Object::parse(algo, "tag", body.into_bytes());
    assert!(res.is_ok());
    if let Object::Tag(t) = res.unwrap() {
        assert_eq!(t.message, msg);
    } else {
        panic!("expected tag");
    }
}

#[test]
fn test_diamond_dag_flatten_stays_linear() {
    // Shared-subtree doubling DAG: level k = {a: T_{k-1}, b: T_{k-1}}. The memo must
    // compute each unique tree once; a naive walk visits 2^depth nodes.
    let tmp = TempDir::new().unwrap();
    let repo = tmp.path().join("repo_diamond");
    fs::create_dir_all(&repo).unwrap();
    init(&repo, HashAlgo::Sha256).unwrap();
    let algo = itehaas_lib::config::read_hasher(&repo).unwrap();
    let hasher = itehaas_lib::hash::new_hasher(algo).unwrap();
    let blob = Blob::new(b"x".to_vec());
    let blob_h = itehaas_lib::object::store::write_object(&repo, &Object::Blob(blob), hasher.as_ref()).unwrap();
    let mut level = {
        let t = Tree::new(vec![TreeEntry::new(0o100644, "f".into(), blob_h).unwrap()]).unwrap();
        itehaas_lib::object::store::write_object(&repo, &Object::Tree(t), hasher.as_ref()).unwrap()
    };
    for _ in 1..=12u32 {
        let t = Tree::new(vec![
            TreeEntry::new(0o040000, "a".into(), level.clone()).unwrap(),
            TreeEntry::new(0o040000, "b".into(), level.clone()).unwrap(),
        ])
        .unwrap();
        level = itehaas_lib::object::store::write_object(&repo, &Object::Tree(t), hasher.as_ref()).unwrap();
    }
    let start = std::time::Instant::now();
    let map = itehaas_lib::tree_builder::flatten_tree_root(&repo, &level, hasher.as_ref()).unwrap();
    // 2^12 distinct leaf paths, computed from 13 unique trees.
    assert_eq!(map.len(), 4096);
    assert!(start.elapsed().as_secs() < 15, "diamond DAG must flatten in linear time");
}

#[test]
fn test_diamond_dag_beyond_cap_fails_fast() {
    // Depth-20 doubling = 1M leaf paths (>100k cap). Must fail with "too large"
    // quickly (memoized walk trips the cap after ~100k inserts), never hang.
    let tmp = TempDir::new().unwrap();
    let repo = tmp.path().join("repo_diamond_big");
    fs::create_dir_all(&repo).unwrap();
    init(&repo, HashAlgo::Sha256).unwrap();
    let algo = itehaas_lib::config::read_hasher(&repo).unwrap();
    let hasher = itehaas_lib::hash::new_hasher(algo).unwrap();
    let blob = Blob::new(b"x".to_vec());
    let blob_h = itehaas_lib::object::store::write_object(&repo, &Object::Blob(blob), hasher.as_ref()).unwrap();
    let mut level = {
        let t = Tree::new(vec![TreeEntry::new(0o100644, "f".into(), blob_h).unwrap()]).unwrap();
        itehaas_lib::object::store::write_object(&repo, &Object::Tree(t), hasher.as_ref()).unwrap()
    };
    for _ in 1..=20u32 {
        let t = Tree::new(vec![
            TreeEntry::new(0o040000, "a".into(), level.clone()).unwrap(),
            TreeEntry::new(0o040000, "b".into(), level.clone()).unwrap(),
        ])
        .unwrap();
        level = itehaas_lib::object::store::write_object(&repo, &Object::Tree(t), hasher.as_ref()).unwrap();
    }
    let start = std::time::Instant::now();
    let res = itehaas_lib::tree_builder::flatten_tree_root(&repo, &level, hasher.as_ref());
    assert!(res.is_err());
    assert!(format!("{:?}", res.unwrap_err()).contains("too large"));
    assert!(start.elapsed().as_secs() < 30, "oversized DAG must fail fast, not hang");
}

#[test]
fn test_reachability_long_chain_no_overflow() {
    // 3000-commit linear chain: iterative walk must succeed (no stack overflow,
    // no depth trip — only the 100k object budget applies).
    use itehaas_lib::object::Commit;
    use itehaas_lib::object::commit::Signature;
    let tmp = TempDir::new().unwrap();
    let repo = tmp.path().join("repo_chain");
    fs::create_dir_all(&repo).unwrap();
    init(&repo, HashAlgo::Sha256).unwrap();
    let algo = itehaas_lib::config::read_hasher(&repo).unwrap();
    let hasher = itehaas_lib::hash::new_hasher(algo).unwrap();
    let empty_tree = Tree::new(vec![]).unwrap();
    let tree_h = itehaas_lib::object::store::write_object(&repo, &Object::Tree(empty_tree), hasher.as_ref()).unwrap();
    let sig = Signature::new("T".into(), "t@e.c".into(), 0, "+0000".into()).unwrap();
    let mut parent: Option<Hash> = None;
    let mut tip = None;
    for i in 0..3000 {
        let parents = parent.clone().into_iter().collect();
        let c = Commit::new(tree_h.clone(), parents, sig.clone(), sig.clone(), format!("c{}", i));
        let h = itehaas_lib::object::store::write_object(&repo, &Object::Commit(c), hasher.as_ref()).unwrap();
        parent = Some(h.clone());
        tip = Some(h);
    }
    let mut visited = std::collections::HashSet::new();
    let mut out = Vec::new();
    let res = itehaas_lib::remote::collect_reachable_objects(&repo, &tip.unwrap(), hasher.as_ref(), &mut visited, &mut out);
    assert!(res.is_ok(), "3000-chain walk must succeed: {:?}", res.err());
    assert!(out.len() >= 3000);
}

#[test]
fn test_index_size_cap_rejects_giant_file() {
    let tmp = TempDir::new().unwrap();
    let repo = tmp.path().join("repo_idx");
    fs::create_dir_all(&repo).unwrap();
    init(&repo, HashAlgo::Sha256).unwrap();
    // 33MB file (>32MB cap) must fail before serde parsing.
    let big = vec![b'x'; 33 * 1024 * 1024];
    fs::write(repo.join(".itehaas/index"), &big).unwrap();
    let res = itehaas_lib::index::Index::load(&repo);
    assert!(res.is_err());
    assert!(format!("{:?}", res.unwrap_err()).contains("too large"));
}

#[test]
fn test_pack_streaming_roundtrip_small_repo() {
    // create_pack must succeed without buffering everything (regression for the
    // two-pass rewrite) and verify_pack must accept its output.
    let tmp = TempDir::new().unwrap();
    let repo = tmp.path().join("repo_pack");
    fs::create_dir_all(&repo).unwrap();
    init(&repo, HashAlgo::Sha256).unwrap();
    let algo = itehaas_lib::config::read_hasher(&repo).unwrap();
    let hasher = itehaas_lib::hash::new_hasher(algo).unwrap();
    for i in 0..5 {
        let blob = Blob::new(format!("content-{}", i).into_bytes());
        itehaas_lib::object::store::write_object(&repo, &Object::Blob(blob), hasher.as_ref()).unwrap();
    }
    let (pack_path, count, _orig, _packed) = itehaas_lib::pack::create_pack(&repo).unwrap();
    assert_eq!(count, 5);
    let verified = itehaas_lib::pack::verify_pack(&repo, &pack_path).unwrap();
    assert_eq!(verified, 5);
}
