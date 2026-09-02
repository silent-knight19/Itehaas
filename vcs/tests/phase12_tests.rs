use std::fs;
use tempfile::TempDir;
use itehaas_lib::hash::HashAlgo;
use itehaas_lib::remote::http::{validate_http_base, fetch_refs_http};

fn init_repo(dir: &std::path::Path, algo: &str) -> std::path::PathBuf {
    let a = HashAlgo::from_str(algo).unwrap();
    let repo = itehaas_lib::init(dir, a).unwrap();
    itehaas_lib::config::write_user(&repo, "Tester", "tester@example.com").unwrap();
    repo
}

#[test]
fn test_sha1_repo_init_and_commit() {
    let td = TempDir::new().unwrap();
    let repo = init_repo(td.path(), "sha1");
    // Check hasher is sha1
    let algo = itehaas_lib::config::read_hasher(&repo).unwrap();
    assert_eq!(algo, HashAlgo::Sha1);
    // Create commit
    fs::write(repo.join("a.txt"), "hello sha1").unwrap();
    let algo = itehaas_lib::config::read_hasher(&repo).unwrap();
    let hasher = itehaas_lib::hash::new_hasher(algo).unwrap();
    let mut idx = itehaas_lib::index::Index::load(&repo).unwrap();
    let data = fs::read(repo.join("a.txt")).unwrap();
    let blob = itehaas_lib::object::Blob::new(data);
    let hash = itehaas_lib::object::store::write_object(&repo, &itehaas_lib::object::Object::Blob(blob), hasher.as_ref()).unwrap();
    assert_eq!(hash.hex().len(), 40);
    assert_eq!(hash.algo, HashAlgo::Sha1);
    idx.add_or_update(itehaas_lib::index::IndexEntry::new("a.txt".into(), hash, 0o100644));
    idx.save(&repo).unwrap();
    let entries = idx.entries_sorted();
    let tree = itehaas_lib::tree_builder::build_tree_from_index(&repo, &entries, hasher.as_ref()).unwrap();
    assert_eq!(tree.hex().len(), 40);
    let sig = itehaas_lib::object::Signature::new("Tester".into(), "tester@example.com".into(), 1000, "+0000".into()).unwrap();
    let commit = itehaas_lib::object::Commit::new(tree.clone(), vec![], sig.clone(), sig, "sha1 commit".into());
    let chash = itehaas_lib::object::store::write_object(&repo, &itehaas_lib::object::Object::Commit(commit), hasher.as_ref()).unwrap();
    assert_eq!(chash.hex().len(), 40);
    // Verify read back
    let obj = itehaas_lib::object::store::read_object(&repo, &chash, hasher.as_ref()).unwrap();
    match obj {
        itehaas_lib::object::Object::Commit(c) => {
            assert_eq!(c.tree.hex(), tree.hex());
            assert_eq!(c.message, "sha1 commit");
        }
        _ => panic!("not commit"),
    }
    // Check object path fanout 2/38 for sha1
    let path = itehaas_lib::object::store::object_path(&repo, &chash);
    let hex = chash.hex();
    assert!(path.to_string_lossy().ends_with(&format!("{}/{}", &hex[0..2], &hex[2..])));
    // Verify via itehaas binary cat-file would work, but we just verify read
}

#[test]
fn test_http_base_validation() {
    std::env::set_var("ALLOW_LOCALHOST_REMOTE", "true");
    assert!(validate_http_base("http://localhost:3001/api/repos/alice/repo").is_ok());
    assert!(validate_http_base("https://example.com/api/repos/alice/repo").is_ok());
    assert!(validate_http_base("http://localhost:3101/api/repos/a/b/").is_ok());
    assert!(validate_http_base("http://evil.com/steal").is_err());
    assert!(validate_http_base("http://localhost:3001/api/repos/../etc/passwd").is_err());
    assert!(validate_http_base("http://localhost:3001/api/repos/a/.").is_err());
    assert!(validate_http_base("ftp://localhost/api/repos/a/b").is_err());
    assert!(validate_http_base("http://localhost:3001/api/repos/a").is_err()); // missing repo
}

#[test]
fn test_hash_algo_factory() {
    let sha256 = HashAlgo::from_str("sha256").unwrap();
    let sha1 = HashAlgo::from_str("sha1").unwrap();
    assert_eq!(sha256.hash_len(), 32);
    assert_eq!(sha1.hash_len(), 20);
    assert_eq!(sha256.hex_len(), 64);
    assert_eq!(sha1.hex_len(), 40);
    let h256 = itehaas_lib::hash::new_hasher(sha256).unwrap();
    let h1 = itehaas_lib::hash::new_hasher(sha1).unwrap();
    assert_eq!(h256.algo(), HashAlgo::Sha256);
    assert_eq!(h1.algo(), HashAlgo::Sha1);
    let b3 = HashAlgo::Blake3;
    assert!(itehaas_lib::hash::new_hasher(b3).is_err());
}

#[test]
fn test_incremental_fetch_logic() {
    // Test that http_fetch would only fetch missing objects
    // Simulate two repos file-based but using http_fetch logic via local reachable diff
    // We test collect_reachable logic for push missing detection
    let td1 = TempDir::new().unwrap();
    let repo1 = init_repo(td1.path(), "sha256");
    fs::write(repo1.join("a.txt"), "base").unwrap();
    // add & commit base
    let algo = itehaas_lib::config::read_hasher(&repo1).unwrap();
    let hasher = itehaas_lib::hash::new_hasher(algo).unwrap();
    let mut idx = itehaas_lib::index::Index::load(&repo1).unwrap();
    let data = fs::read(repo1.join("a.txt")).unwrap();
    let blob = itehaas_lib::object::Blob::new(data);
    let hash = itehaas_lib::object::store::write_object(&repo1, &itehaas_lib::object::Object::Blob(blob), hasher.as_ref()).unwrap();
    idx.add_or_update(itehaas_lib::index::IndexEntry::new("a.txt".into(), hash, 0o100644));
    idx.save(&repo1).unwrap();
    let entries = idx.entries_sorted();
    let tree = itehaas_lib::tree_builder::build_tree_from_index(&repo1, &entries, hasher.as_ref()).unwrap();
    let sig = itehaas_lib::object::Signature::new("Tester".into(), "tester@example.com".into(), 1000, "+0000".into()).unwrap();
    let commit = itehaas_lib::object::Commit::new(tree, vec![], sig.clone(), sig.clone(), "base".into());
    let base_hash = itehaas_lib::object::store::write_object(&repo1, &itehaas_lib::object::Object::Commit(commit), hasher.as_ref()).unwrap();
    itehaas_lib::refs::write_ref(&repo1, "refs/heads/main", &base_hash).unwrap();
    itehaas_lib::refs::write_head_ref(&repo1, "refs/heads/main").unwrap();

    // second commit
    fs::write(repo1.join("a.txt"), "second").unwrap();
    let mut idx2 = itehaas_lib::index::Index::load(&repo1).unwrap();
    let data2 = fs::read(repo1.join("a.txt")).unwrap();
    let blob2 = itehaas_lib::object::Blob::new(data2);
    let hash2 = itehaas_lib::object::store::write_object(&repo1, &itehaas_lib::object::Object::Blob(blob2), hasher.as_ref()).unwrap();
    idx2.add_or_update(itehaas_lib::index::IndexEntry::new("a.txt".into(), hash2, 0o100644));
    idx2.save(&repo1).unwrap();
    let entries2 = idx2.entries_sorted();
    let tree2 = itehaas_lib::tree_builder::build_tree_from_index(&repo1, &entries2, hasher.as_ref()).unwrap();
    let sig2 = itehaas_lib::object::Signature::new("Tester".into(), "tester@example.com".into(), 1001, "+0000".into()).unwrap();
    let commit2 = itehaas_lib::object::Commit::new(tree2, vec![base_hash.clone()], sig2.clone(), sig2, "second".into());
    let second_hash = itehaas_lib::object::store::write_object(&repo1, &itehaas_lib::object::Object::Commit(commit2), hasher.as_ref()).unwrap();

    // collect reachable for base vs second
    use std::collections::HashSet;
    let mut visited_base = HashSet::new();
    let mut objs_base = Vec::new();
    itehaas_lib::remote::collect_reachable_objects(&repo1, &base_hash, hasher.as_ref(), &mut visited_base, &mut objs_base).unwrap();
    let mut visited_second = HashSet::new();
    let mut objs_second = Vec::new();
    itehaas_lib::remote::collect_reachable_objects(&repo1, &second_hash, hasher.as_ref(), &mut visited_second, &mut objs_second).unwrap();
    // second should have more objects than base (at least 2: new commit + blob)
    assert!(objs_second.len() > objs_base.len());
    // missing = second - base should be 2 or 3
    let missing: Vec<_> = objs_second.iter().filter(|h| !visited_base.contains(&h.hex())).collect();
    assert!(missing.len() >= 2);
}
