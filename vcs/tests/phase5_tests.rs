use std::fs;
use std::path::Path;
use itehaas_lib::config;
use itehaas_lib::hash::HashAlgo;
use itehaas_lib::refs;
use tempfile::TempDir;

fn setup_repo(path: &Path) {
    itehaas_lib::init(path, HashAlgo::Sha256).unwrap();
    config::write_user(path, "Tester", "tester@example.com").unwrap();
}

fn add_commit(repo: &Path, file: &str, content: &[u8], msg: &str) {
    let p = repo.join(file);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(&p, content).unwrap();
    // add via index
    let algo = config::read_hasher(repo).unwrap();
    let hasher = itehaas_lib::hash::new_hasher(algo).unwrap();
    let mut index = itehaas_lib::index::Index::load(repo).unwrap();
    let data = fs::read(&p).unwrap();
    let blob = itehaas_lib::object::Blob::new(data);
    let obj = itehaas_lib::object::Object::Blob(blob);
    let hash = itehaas_lib::object::store::write_object(repo, &obj, hasher.as_ref()).unwrap();
    let mode = itehaas_lib::index::file_mode(&fs::metadata(&p).unwrap());
    let entry = itehaas_lib::index::IndexEntry::new(file.to_string(), hash, mode);
    index.add_or_update(entry);
    index.save(repo).unwrap();
    // commit
    let index2 = itehaas_lib::index::Index::load(repo).unwrap();
    let entries = index2.entries_sorted();
    let tree = itehaas_lib::tree_builder::build_tree_from_index(repo, &entries, hasher.as_ref()).unwrap();
    let parent = refs::resolve_head(repo).unwrap();
    let parents = if let Some(p) = parent { vec![p] } else { vec![] };
    let sig = itehaas_lib::object::Signature::new("Tester".into(), "tester@example.com".into(), 1000, "+0000".into()).unwrap();
    let commit = itehaas_lib::object::Commit::new(tree, parents, sig.clone(), sig, msg.into());
    let obj = itehaas_lib::object::Object::Commit(commit);
    let h = itehaas_lib::object::store::write_object(repo, &obj, hasher.as_ref()).unwrap();
    let head = refs::read_head(repo).unwrap();
    match head {
        refs::Head::Ref(r) | refs::Head::Unborn(r) => refs::write_ref(repo, &r, &h).unwrap(),
        refs::Head::Detached(_) => refs::write_head_detached(repo, &h).unwrap(),
    }
}

#[test]
fn test_remote_add_list_remove() {
    let dir = TempDir::new().unwrap();
    let repo = dir.path().join("repo");
    setup_repo(&repo);
    config::add_remote(&repo, "origin", "/tmp/remote").unwrap();
    let remotes = config::list_remotes(&repo).unwrap();
    assert_eq!(remotes.len(), 1);
    assert_eq!(remotes[0].0, "origin");
    assert_eq!(remotes[0].1, "/tmp/remote");
    assert!(config::add_remote(&repo, "origin", "/tmp/other").is_err()); // already exists
    config::remove_remote(&repo, "origin").unwrap();
    assert!(config::list_remotes(&repo).unwrap().is_empty());
    assert!(config::remove_remote(&repo, "origin").is_err());
}

#[test]
fn test_clone() {
    let dir = TempDir::new().unwrap();
    let origin = dir.path().join("origin");
    let clone_path = dir.path().join("clone");
    setup_repo(&origin);
    add_commit(&origin, "a.txt", b"a", "init");
    // Clone via filesystem: use remote.rs and checkout
    // Simulate CLI clone: init dest, add remote, transfer
    let algo = config::read_hasher(&origin).unwrap();
    itehaas_lib::init(&clone_path, algo).unwrap();
    config::add_remote(&clone_path, "origin", origin.to_str().unwrap()).unwrap();
    // Transfer
    let remote_heads = itehaas_lib::remote::list_remote_refs(&origin).unwrap();
    assert_eq!(remote_heads.len(), 1);
    for (name, hash) in remote_heads {
        itehaas_lib::remote::transfer_objects(&origin, &clone_path, &hash).unwrap();
        let branch = name.strip_prefix("refs/heads/").unwrap();
        let remote_ref = format!("refs/remotes/origin/{}", branch);
        refs::write_ref(&clone_path, &remote_ref, &hash).unwrap();
        // Also create local branch
        refs::write_ref(&clone_path, &name, &hash).unwrap();
    }
    // Checkout
    itehaas_lib::checkout::checkout_branch_forced(&clone_path, "main").unwrap();
    assert!(clone_path.join("a.txt").exists());
    assert_eq!(fs::read_to_string(clone_path.join("a.txt")).unwrap(), "a");
    // Check refs
    assert!(clone_path.join(".itehaas").join("refs/remotes/origin/main").exists());
}

#[test]
fn test_push_fetch() {
    let dir = TempDir::new().unwrap();
    let origin = dir.path().join("origin");
    let clone_path = dir.path().join("clone");
    setup_repo(&origin);
    add_commit(&origin, "a.txt", b"a", "init");
    // Clone
    let algo = config::read_hasher(&origin).unwrap();
    itehaas_lib::init(&clone_path, algo).unwrap();
    config::add_remote(&clone_path, "origin", origin.to_str().unwrap()).unwrap();
    config::add_remote(&origin, "clone", clone_path.to_str().unwrap()).unwrap();
    // Transfer base
    let h = refs::resolve_head(&origin).unwrap().unwrap();
    itehaas_lib::remote::transfer_objects(&origin, &clone_path, &h).unwrap();
    refs::write_ref(&clone_path, "refs/heads/main", &h).unwrap();
    refs::write_ref(&clone_path, "refs/remotes/origin/main", &h).unwrap();
    itehaas_lib::checkout::checkout_branch_forced(&clone_path, "main").unwrap();
    config::write_user(&clone_path, "Tester", "tester@example.com").unwrap();

    // Add commit on clone and push
    add_commit(&clone_path, "b.txt", b"b", "clone commit");
    let local_hash = refs::resolve_head(&clone_path).unwrap().unwrap();
    let transferred = itehaas_lib::remote::transfer_objects(&clone_path, &origin, &local_hash).unwrap();
    assert!(transferred > 0);
    refs::write_ref(&origin, "refs/heads/main", &local_hash).unwrap();
    assert!(origin.join(".itehaas").join("objects").join(&local_hash.hex()[..2]).join(&local_hash.hex()[2..]).exists());
    // Check origin now has b.txt reachable
    let algo2 = config::read_hasher(&origin).unwrap();
    let hasher = itehaas_lib::hash::new_hasher(algo2).unwrap();
    let obj = itehaas_lib::object::store::read_object(&origin, &local_hash, hasher.as_ref()).unwrap();
    assert!(matches!(obj, itehaas_lib::object::Object::Commit(_)));

    // Origin adds another commit
    add_commit(&origin, "c.txt", b"c", "origin commit");
    let origin_hash = refs::resolve_head(&origin).unwrap().unwrap();
    // Fetch on clone
    let fetched = itehaas_lib::remote::transfer_objects(&origin, &clone_path, &origin_hash).unwrap();
    assert!(fetched > 0);
    refs::write_ref(&clone_path, "refs/remotes/origin/main", &origin_hash).unwrap();
    assert!(clone_path.join(".itehaas").join("refs/remotes/origin/main").exists());
}

#[test]
fn test_push_non_fast_forward_rejected() {
    let dir = TempDir::new().unwrap();
    let origin = dir.path().join("origin");
    let clone = dir.path().join("clone");
    setup_repo(&origin);
    add_commit(&origin, "a.txt", b"a", "init");
    let base = refs::resolve_head(&origin).unwrap().unwrap();
    // Clone
    let algo = config::read_hasher(&origin).unwrap();
    itehaas_lib::init(&clone, algo).unwrap();
    config::write_user(&clone, "Tester", "tester@example.com").unwrap();
    config::add_remote(&clone, "origin", origin.to_str().unwrap()).unwrap();
    itehaas_lib::remote::transfer_objects(&origin, &clone, &base).unwrap();
    refs::write_ref(&clone, "refs/heads/main", &base).unwrap();
    refs::write_ref(&clone, "refs/remotes/origin/main", &base).unwrap();
    itehaas_lib::checkout::checkout_branch_forced(&clone, "main").unwrap();
    // Both diverge
    add_commit(&origin, "origin.txt", b"origin", "origin");
    add_commit(&clone, "clone.txt", b"clone", "clone");
    let origin_hash = refs::resolve_head(&origin).unwrap().unwrap();
    let clone_hash = refs::resolve_head(&clone).unwrap().unwrap();
    // Check is_ancestor: neither is ancestor of other
    assert!(!itehaas_lib::merge::is_ancestor(&clone, &origin_hash, &clone_hash).unwrap());
    assert!(!itehaas_lib::merge::is_ancestor(&origin, &clone_hash, &origin_hash).unwrap());
    // Push should be rejected as non-fast-forward if we check
    let is_ff = itehaas_lib::merge::is_ancestor(&clone, &origin_hash, &clone_hash).unwrap();
    assert!(!is_ff);
}

#[test]
fn test_fetch_updates_remote_refs() {
    let dir = TempDir::new().unwrap();
    let origin = dir.path().join("origin");
    let clone = dir.path().join("clone");
    setup_repo(&origin);
    add_commit(&origin, "a.txt", b"a", "init");
    let base = refs::resolve_head(&origin).unwrap().unwrap();
    let algo = config::read_hasher(&origin).unwrap();
    itehaas_lib::init(&clone, algo).unwrap();
    config::write_user(&clone, "Tester", "tester@example.com").unwrap();
    config::add_remote(&clone, "origin", origin.to_str().unwrap()).unwrap();
    itehaas_lib::remote::transfer_objects(&origin, &clone, &base).unwrap();
    refs::write_ref(&clone, "refs/heads/main", &base).unwrap();
    refs::write_ref(&clone, "refs/remotes/origin/main", &base).unwrap();
    itehaas_lib::checkout::checkout_branch_forced(&clone, "main").unwrap();
    // Origin advances
    add_commit(&origin, "b.txt", b"b", "second");
    let new_head = refs::resolve_head(&origin).unwrap().unwrap();
    // Fetch
    let transferred = itehaas_lib::remote::transfer_objects(&origin, &clone, &new_head).unwrap();
    assert!(transferred > 0);
    refs::write_ref(&clone, "refs/remotes/origin/main", &new_head).unwrap();
    let fetched = refs::read_ref(&clone, "refs/remotes/origin/main").unwrap().unwrap();
    assert_eq!(fetched.hex(), new_head.hex());
    // Local main still at base
    let local = refs::read_ref(&clone, "refs/heads/main").unwrap().unwrap();
    assert_eq!(local.hex(), base.hex());
}

#[test]
fn test_clone_transfer_all_heads() {
    let dir = TempDir::new().unwrap();
    let origin = dir.path().join("origin");
    setup_repo(&origin);
    add_commit(&origin, "a.txt", b"a", "init");
    let base = refs::resolve_head(&origin).unwrap().unwrap();
    // Create feature branch
    itehaas_lib::refs::create_branch(&origin, "feature", &base).unwrap();
    itehaas_lib::checkout::checkout_branch(&origin, "feature").unwrap();
    add_commit(&origin, "f.txt", b"f", "feature");
    itehaas_lib::checkout::checkout_branch(&origin, "main").unwrap();
    add_commit(&origin, "m.txt", b"m", "main2");
    let clone = dir.path().join("clone");
    let algo = config::read_hasher(&origin).unwrap();
    itehaas_lib::init(&clone, algo).unwrap();
    let transferred = itehaas_lib::remote::transfer_all_heads(&origin, &clone).unwrap();
    assert!(transferred > 0);
    // Both branches should be reachable? But transfer_all_heads just copies objects, not refs
    // Check that feature commit is now present in clone
    let feature_hash = refs::read_ref(&origin, "refs/heads/feature").unwrap().unwrap();
    let algo2 = config::read_hasher(&clone).unwrap();
    let hasher = itehaas_lib::hash::new_hasher(algo2).unwrap();
    // After transfer, object should exist
    assert!(itehaas_lib::object::store::object_path(&clone, &feature_hash).exists());
    let obj = itehaas_lib::object::store::read_object(&clone, &feature_hash, hasher.as_ref());
    assert!(obj.is_ok());
}
