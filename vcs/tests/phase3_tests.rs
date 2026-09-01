use std::fs;
use std::path::Path;
use itehaas_lib::config;
use itehaas_lib::hash::HashAlgo;
use itehaas_lib::refs;
use itehaas_lib::index::Index;
use tempfile::TempDir;

fn setup_repo() -> (TempDir, std::path::PathBuf) {
    let dir = TempDir::new().unwrap();
    let repo = dir.path().to_path_buf();
    itehaas_lib::init(&repo, HashAlgo::Sha256).unwrap();
    config::write_user(&repo, "Tester", "tester@example.com").unwrap();
    (dir, repo)
}

fn write_file(repo: &Path, path: &str, content: &[u8]) {
    let abs = repo.join(path);
    if let Some(parent) = abs.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(abs, content).unwrap();
}

fn add_and_commit(repo: &Path, path: &str, content: &[u8], msg: &str) -> itehaas_lib::hash::Hash {
    write_file(repo, path, content);
    // Use CLI via library: add to index and commit
    // Simulate add: hash blob, write, update index
    let algo = config::read_hasher(repo).unwrap();
    let hasher = itehaas_lib::hash::new_hasher(algo).unwrap();
    let mut index = Index::load(repo).unwrap();
    let abs = repo.join(path);
    let data = fs::read(&abs).unwrap();
    let blob = itehaas_lib::object::Blob::new(data);
    let obj = itehaas_lib::object::Object::Blob(blob);
    let hash = itehaas_lib::object::store::write_object(repo, &obj, hasher.as_ref()).unwrap();
    let mode = itehaas_lib::index::file_mode(&fs::metadata(&abs).unwrap());
    let entry = itehaas_lib::index::IndexEntry::new(path.to_string(), hash, mode);
    index.add_or_update(entry);
    index.save(repo).unwrap();

    // Commit via tree builder
    let index2 = Index::load(repo).unwrap();
    let entries = index2.entries_sorted();
    let tree_hash = itehaas_lib::tree_builder::build_tree_from_index(repo, &entries, hasher.as_ref()).unwrap();
    let parent = refs::resolve_head(repo).unwrap();
    let parents = if let Some(p) = parent { vec![p] } else { vec![] };
    let sig = itehaas_lib::object::Signature::new("Tester".into(), "tester@example.com".into(), 1000, "+0000".into()).unwrap();
    let commit = itehaas_lib::object::Commit::new(tree_hash, parents, sig.clone(), sig, msg.into());
    let obj = itehaas_lib::object::Object::Commit(commit);
    let hash = itehaas_lib::object::store::write_object(repo, &obj, hasher.as_ref()).unwrap();
    let head = refs::read_head(repo).unwrap();
    match head {
        refs::Head::Ref(r) | refs::Head::Unborn(r) => refs::write_ref(repo, &r, &hash).unwrap(),
        refs::Head::Detached(_) => refs::write_head_detached(repo, &hash).unwrap(),
    }
    hash
}

#[test]
fn test_branch_create_and_list() {
    let (_dir, repo) = setup_repo();
    add_and_commit(&repo, "a.txt", b"a", "init");
    let branches = refs::list_branches(&repo).unwrap();
    assert_eq!(branches, vec!["main"]);
    let head = refs::read_head(&repo).unwrap();
    assert_eq!(head.branch_name().unwrap(), "main");

    // Create feature branch at HEAD
    let head_hash = refs::resolve_head(&repo).unwrap().unwrap();
    refs::create_branch(&repo, "feature", &head_hash).unwrap();
    let branches = refs::list_branches(&repo).unwrap();
    assert_eq!(branches, vec!["feature", "main"]);
    // Duplicate should fail
    assert!(refs::create_branch(&repo, "feature", &head_hash).is_err());
    // Invalid name
    assert!(refs::validate_branch_name("bad..name").is_err());
    assert!(refs::validate_branch_name("bad name").is_err());
}

#[test]
fn test_branch_delete() {
    let (_dir, repo) = setup_repo();
    add_and_commit(&repo, "a.txt", b"a", "init");
    let h = refs::resolve_head(&repo).unwrap().unwrap();
    refs::create_branch(&repo, "feature", &h).unwrap();
    // Delete feature
    refs::delete_branch(&repo, "feature").unwrap();
    let branches = refs::list_branches(&repo).unwrap();
    assert_eq!(branches, vec!["main"]);
    // Delete non-existent
    assert!(refs::delete_branch(&repo, "nonexistent").is_err());
    // Cannot delete current branch
    assert!(refs::delete_branch(&repo, "main").is_err());
}

#[test]
fn test_checkout_branch_switches_working_tree() {
    let (_dir, repo) = setup_repo();
    add_and_commit(&repo, "a.txt", b"a", "init");
    let h_main = refs::resolve_head(&repo).unwrap().unwrap();
    refs::create_branch(&repo, "feature", &h_main).unwrap();

    // Checkout feature
    itehaas_lib::checkout::checkout_branch(&repo, "feature").unwrap();
    assert_eq!(refs::current_branch(&repo).unwrap().unwrap(), "feature");
    assert_eq!(refs::read_head(&repo).unwrap().branch_name().unwrap(), "feature");

    // Modify on feature
    write_file(&repo, "feature.txt", b"feature");
    add_and_commit(&repo, "feature.txt", b"feature", "feature commit");
    assert!(repo.join("feature.txt").exists());

    // Checkout main — feature.txt should disappear
    itehaas_lib::checkout::checkout_branch(&repo, "main").unwrap();
    assert_eq!(refs::current_branch(&repo).unwrap().unwrap(), "main");
    assert!(!repo.join("feature.txt").exists());
    assert!(repo.join("a.txt").exists());

    // Checkout feature again — feature.txt should reappear
    itehaas_lib::checkout::checkout_branch(&repo, "feature").unwrap();
    assert!(repo.join("feature.txt").exists());
    let content = fs::read_to_string(repo.join("feature.txt")).unwrap();
    assert_eq!(content, "feature");
}

#[test]
fn test_checkout_detached() {
    let (_dir, repo) = setup_repo();
    add_and_commit(&repo, "a.txt", b"a", "init");
    let h = refs::resolve_head(&repo).unwrap().unwrap();
    // Checkout detached
    itehaas_lib::checkout::checkout_detached(&repo, &h).unwrap();
    let head = refs::read_head(&repo).unwrap();
    assert!(matches!(head, refs::Head::Detached(_)));
    assert_eq!(refs::current_branch(&repo).unwrap(), None);
    assert!(refs::resolve_head(&repo).unwrap().is_some());
}

#[test]
fn test_checkout_fails_on_dirty() {
    let (_dir, repo) = setup_repo();
    add_and_commit(&repo, "a.txt", b"a", "init");
    let h = refs::resolve_head(&repo).unwrap().unwrap();
    refs::create_branch(&repo, "feature", &h).unwrap();
    // Modify tracked file without committing
    write_file(&repo, "a.txt", b"modified");
    // Checkout should fail due to not_staged
    let res = itehaas_lib::checkout::checkout_branch(&repo, "feature");
    assert!(res.is_err());
    assert!(res.unwrap_err().to_string().contains("working tree has modifications"));
    // Even staged should fail
    // Stage the modification
    let algo = config::read_hasher(&repo).unwrap();
    let hasher = itehaas_lib::hash::new_hasher(algo).unwrap();
    let mut index = Index::load(&repo).unwrap();
    let abs = repo.join("a.txt");
    let data = fs::read(&abs).unwrap();
    let blob = itehaas_lib::object::Blob::new(data);
    let obj = itehaas_lib::object::Object::Blob(blob);
    let hash = itehaas_lib::object::store::write_object(&repo, &obj, hasher.as_ref()).unwrap();
    let mode = itehaas_lib::index::file_mode(&fs::metadata(&abs).unwrap());
    let entry = itehaas_lib::index::IndexEntry::new("a.txt".to_string(), hash, mode);
    index.add_or_update(entry);
    index.save(&repo).unwrap();
    let res2 = itehaas_lib::checkout::checkout_branch(&repo, "feature");
    assert!(res2.is_err());
}

#[test]
fn test_checkout_preserves_untracked() {
    let (_dir, repo) = setup_repo();
    add_and_commit(&repo, "a.txt", b"a", "init");
    let h = refs::resolve_head(&repo).unwrap().unwrap();
    refs::create_branch(&repo, "feature", &h).unwrap();
    write_file(&repo, "untracked.txt", b"untracked");
    // Checkout should succeed even with untracked
    itehaas_lib::checkout::checkout_branch(&repo, "feature").unwrap();
    assert!(repo.join("untracked.txt").exists());
}

#[test]
fn test_branch_with_start_point() {
    let (_dir, repo) = setup_repo();
    add_and_commit(&repo, "a.txt", b"a", "init");
    let h1 = refs::resolve_head(&repo).unwrap().unwrap();
    add_and_commit(&repo, "b.txt", b"b", "second");
    let h2 = refs::resolve_head(&repo).unwrap().unwrap();
    // Create branch at h1
    refs::create_branch(&repo, "at-h1", &h1).unwrap();
    let read = refs::read_ref(&repo, "refs/heads/at-h1").unwrap().unwrap();
    assert_eq!(read.hex(), h1.hex());
    // Create branch at HEAD (h2)
    refs::create_branch(&repo, "at-h2", &h2).unwrap();
    // Checkout at-h1 should have only a.txt
    itehaas_lib::checkout::checkout_branch(&repo, "at-h1").unwrap();
    assert!(repo.join("a.txt").exists());
    assert!(!repo.join("b.txt").exists());
}

#[test]
fn test_dag_branch_histories_independent() {
    let (_dir, repo) = setup_repo();
    add_and_commit(&repo, "base.txt", b"base", "base");
    let base_hash = refs::resolve_head(&repo).unwrap().unwrap();
    refs::create_branch(&repo, "feature", &base_hash).unwrap();

    // Commit on feature
    itehaas_lib::checkout::checkout_branch(&repo, "feature").unwrap();
    add_and_commit(&repo, "feature.txt", b"feature", "feature commit");

    // Commit on main
    itehaas_lib::checkout::checkout_branch(&repo, "main").unwrap();
    add_and_commit(&repo, "main.txt", b"main", "main commit");

    // Check histories
    let main_hash = refs::read_ref(&repo, "refs/heads/main").unwrap().unwrap();
    let feature_hash = refs::read_ref(&repo, "refs/heads/feature").unwrap().unwrap();

    // Walk main
    let algo = config::read_hasher(&repo).unwrap();
    let hasher = itehaas_lib::hash::new_hasher(algo).unwrap();
    let mut cur = main_hash;
    let mut main_commits = Vec::new();
    loop {
        main_commits.push(cur.hex());
        let obj = itehaas_lib::object::store::read_object(&repo, &cur, hasher.as_ref()).unwrap();
        if let itehaas_lib::object::Object::Commit(c) = obj {
            if c.parents.is_empty() { break; }
            cur = c.parents[0].clone();
        } else { break; }
    }
    assert_eq!(main_commits.len(), 2); // base + main commit

    let mut cur = feature_hash;
    let mut feat_commits = Vec::new();
    loop {
        feat_commits.push(cur.hex());
        let obj = itehaas_lib::object::store::read_object(&repo, &cur, hasher.as_ref()).unwrap();
        if let itehaas_lib::object::Object::Commit(c) = obj {
            if c.parents.is_empty() { break; }
            cur = c.parents[0].clone();
        } else { break; }
    }
    assert_eq!(feat_commits.len(), 2); // base + feature commit
    assert_eq!(main_commits[1], feat_commits[1]); // base same
    assert_ne!(main_commits[0], feat_commits[0]);
}

#[test]
fn test_index_reflects_checkout() {
    let (_dir, repo) = setup_repo();
    add_and_commit(&repo, "a.txt", b"a", "init");
    let h1 = refs::resolve_head(&repo).unwrap().unwrap();
    add_and_commit(&repo, "b.txt", b"b", "second");
    refs::create_branch(&repo, "branch", &h1).unwrap();
    // Checkout branch (at h1) — index should have only a.txt
    itehaas_lib::checkout::checkout_branch(&repo, "branch").unwrap();
    let index = Index::load(&repo).unwrap();
    assert_eq!(index.len(), 1);
    assert!(index.contains("a.txt"));
    assert!(!index.contains("b.txt"));
    // Checkout main — index should have a+b
    itehaas_lib::checkout::checkout_branch(&repo, "main").unwrap();
    let index2 = Index::load(&repo).unwrap();
    assert_eq!(index2.len(), 2);
}

#[test]
fn test_nested_directories_checkout() {
    let (_dir, repo) = setup_repo();
    add_and_commit(&repo, "dir/a.txt", b"a", "init");
    add_and_commit(&repo, "dir/b.txt", b"b", "second");
    let h2 = refs::resolve_head(&repo).unwrap().unwrap();
    refs::create_branch(&repo, "at1", &h2).unwrap();
    // Modify to have nested
    write_file(&repo, "dir/sub/c.txt", b"c");
    // Add via manual index
    let algo = config::read_hasher(&repo).unwrap();
    let hasher = itehaas_lib::hash::new_hasher(algo).unwrap();
    let mut index = Index::load(&repo).unwrap();
    let abs = repo.join("dir/sub/c.txt");
    let data = fs::read(&abs).unwrap();
    let blob = itehaas_lib::object::Blob::new(data);
    let obj = itehaas_lib::object::Object::Blob(blob);
    let hash = itehaas_lib::object::store::write_object(&repo, &obj, hasher.as_ref()).unwrap();
    let mode = itehaas_lib::index::file_mode(&fs::metadata(&abs).unwrap());
    let entry = itehaas_lib::index::IndexEntry::new("dir/sub/c.txt".to_string(), hash, mode);
    index.add_or_update(entry);
    index.save(&repo).unwrap();
    // Commit
    let index2 = Index::load(&repo).unwrap();
    let entries = index2.entries_sorted();
    let tree_hash = itehaas_lib::tree_builder::build_tree_from_index(&repo, &entries, hasher.as_ref()).unwrap();
    let parent = refs::resolve_head(&repo).unwrap().unwrap();
    let sig = itehaas_lib::object::Signature::new("Tester".into(), "tester@example.com".into(), 1000, "+0000".into()).unwrap();
    let commit = itehaas_lib::object::Commit::new(tree_hash, vec![parent], sig.clone(), sig, "nested".into());
    let obj = itehaas_lib::object::Object::Commit(commit);
    let hash = itehaas_lib::object::store::write_object(&repo, &obj, hasher.as_ref()).unwrap();
    let head = refs::read_head(&repo).unwrap();
    match head {
        refs::Head::Ref(r) => refs::write_ref(&repo, &r, &hash).unwrap(),
        _ => {}
    }
    // Now checkout at1 (should remove sub/c.txt and b? Actually at1 has a+b)
    itehaas_lib::checkout::checkout_branch(&repo, "at1").unwrap();
    assert!(!repo.join("dir/sub/c.txt").exists());
    assert!(repo.join("dir/a.txt").exists());
    assert!(repo.join("dir/b.txt").exists());
}
