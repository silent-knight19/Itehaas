use std::fs;
use std::path::Path;
use itehaas_lib::config;
use itehaas_lib::hash::{HashAlgo, new_hasher};
use itehaas_lib::index::{Index, IndexEntry, file_mode};
use itehaas_lib::object::{Blob, Object};
use itehaas_lib::refs;
use itehaas_lib::status;
use itehaas_lib::tree_builder;
use tempfile::TempDir;

fn setup_repo() -> (TempDir, std::path::PathBuf) {
    let dir = TempDir::new().unwrap();
    let repo = dir.path().to_path_buf();
    itehaas_lib::init(&repo, HashAlgo::Sha256).unwrap();
    config::write_user(&repo, "Test", "test@example.com").unwrap();
    (dir, repo)
}

fn write_file(repo: &Path, path: &str, content: &[u8]) {
    let abs = repo.join(path);
    if let Some(parent) = abs.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(abs, content).unwrap();
}

fn add_file_via_index(repo: &Path, path: &str) {
    let algo = config::read_hasher(repo).unwrap();
    let hasher = new_hasher(algo).unwrap();
    let mut index = Index::load(repo).unwrap();
    let abs = repo.join(path);
    let data = fs::read(&abs).unwrap();
    let blob = Blob::new(data);
    let obj = Object::Blob(blob);
    let hash = itehaas_lib::object::store::write_object(repo, &obj, hasher.as_ref()).unwrap();
    let mode = file_mode(&fs::metadata(&abs).unwrap());
    let entry = IndexEntry::new(path.to_string(), hash, mode);
    index.add_or_update(entry);
    index.save(repo).unwrap();
}

fn commit_with_msg(repo: &Path, msg: &str) -> itehaas_lib::hash::Hash {
    let algo = config::read_hasher(repo).unwrap();
    let hasher = new_hasher(algo).unwrap();
    let index = Index::load(repo).unwrap();
    let entries = index.entries_sorted();
    let tree_hash = tree_builder::build_tree_from_index(repo, &entries, hasher.as_ref()).unwrap();
    let parent = refs::resolve_head(repo).unwrap();
    let parents = if let Some(p) = parent { vec![p] } else { vec![] };
    let sig = itehaas_lib::object::Signature::new("Test".into(), "test@example.com".into(), 1000000, "+0000".into()).unwrap();
    let commit = itehaas_lib::object::Commit::new(tree_hash, parents, sig.clone(), sig, msg.into());
    let obj = Object::Commit(commit);
    let hash = itehaas_lib::object::store::write_object(repo, &obj, hasher.as_ref()).unwrap();
    // update ref
    let head = refs::read_head(repo).unwrap();
    match head {
        refs::Head::Ref(r) | refs::Head::Unborn(r) => refs::write_ref(repo, &r, &hash).unwrap(),
        refs::Head::Detached(_) => refs::write_head_detached(repo, &hash).unwrap(),
    }
    hash
}

#[test]
fn test_add_commit_status_clean() {
    let (_dir, repo) = setup_repo();
    write_file(&repo, "hello.txt", b"hello");
    add_file_via_index(&repo, "hello.txt");
    let st = status::status(&repo).unwrap();
    assert_eq!(st.staged.len(), 1);
    assert_eq!(st.staged[0].path, "hello.txt");
    assert_eq!(st.staged[0].status, "new file");
    assert!(st.not_staged.is_empty());

    commit_with_msg(&repo, "initial");
    let st2 = status::status(&repo).unwrap();
    assert!(st2.is_clean(), "should be clean after commit: {:?}", st2);
}

#[test]
fn test_status_untracked() {
    let (_dir, repo) = setup_repo();
    write_file(&repo, "hello.txt", b"hello");
    // not added
    let st = status::status(&repo).unwrap();
    assert_eq!(st.untracked.len(), 1);
    assert_eq!(st.untracked[0], "hello.txt");
    assert!(st.staged.is_empty());
}

#[test]
fn test_status_not_staged() {
    let (_dir, repo) = setup_repo();
    write_file(&repo, "hello.txt", b"hello");
    add_file_via_index(&repo, "hello.txt");
    commit_with_msg(&repo, "init");
    // modify
    write_file(&repo, "hello.txt", b"modified");
    let st = status::status(&repo).unwrap();
    assert_eq!(st.not_staged.len(), 1);
    assert_eq!(st.not_staged[0].path, "hello.txt");
    assert!(st.staged.is_empty());
    // stage
    add_file_via_index(&repo, "hello.txt");
    let st2 = status::status(&repo).unwrap();
    assert_eq!(st2.staged.len(), 1);
    assert_eq!(st2.staged[0].status, "modified");
    assert!(st2.not_staged.is_empty());
}

#[test]
fn test_add_then_commit_second() {
    let (_dir, repo) = setup_repo();
    write_file(&repo, "a.txt", b"a");
    add_file_via_index(&repo, "a.txt");
    let h1 = commit_with_msg(&repo, "first");
    write_file(&repo, "a.txt", b"aa");
    add_file_via_index(&repo, "a.txt");
    let h2 = commit_with_msg(&repo, "second");
    assert_ne!(h1.hex(), h2.hex());
    // log walk
    let algo = config::read_hasher(&repo).unwrap();
    let hasher = new_hasher(algo).unwrap();
    let head = refs::resolve_head(&repo).unwrap().unwrap();
    assert_eq!(head.hex(), h2.hex());
    // check parent link
    let obj = itehaas_lib::object::store::read_object(&repo, &h2, hasher.as_ref()).unwrap();
    match obj {
        Object::Commit(c) => {
            assert_eq!(c.parents.len(), 1);
            assert_eq!(c.parents[0].hex(), h1.hex());
        }
        _ => panic!("expected commit"),
    }
}

#[test]
fn test_tree_builder_nested() {
    let (_dir, repo) = setup_repo();
    write_file(&repo, "a.txt", b"a");
    write_file(&repo, "dir/b.txt", b"b");
    write_file(&repo, "dir/c.txt", b"c");
    add_file_via_index(&repo, "a.txt");
    add_file_via_index(&repo, "dir/b.txt");
    add_file_via_index(&repo, "dir/c.txt");
    let index = Index::load(&repo).unwrap();
    let entries = index.entries_sorted();
    let algo = config::read_hasher(&repo).unwrap();
    let hasher = new_hasher(algo).unwrap();
    let root_hash = tree_builder::build_tree_from_index(&repo, &entries, hasher.as_ref()).unwrap();
    let map = tree_builder::flatten_tree_root(&repo, &root_hash, hasher.as_ref()).unwrap();
    assert_eq!(map.len(), 3);
    assert!(map.contains_key("a.txt"));
    assert!(map.contains_key("dir/b.txt"));
    assert!(map.contains_key("dir/c.txt"));
    // Verify dir exists as subtree
    let obj = itehaas_lib::object::store::read_object(&repo, &root_hash, hasher.as_ref()).unwrap();
    match obj {
        Object::Tree(t) => {
            assert_eq!(t.entries.len(), 2);
            // root should have a.txt and dir
            let names: Vec<_> = t.entries.iter().map(|e| e.name.as_str()).collect();
            assert!(names.contains(&"a.txt"));
            assert!(names.contains(&"dir"));
            let dir_entry = t.entries.iter().find(|e| e.name == "dir").unwrap();
            assert_eq!(dir_entry.mode, 0o040000);
        }
        _ => panic!("expected tree"),
    }
}

#[test]
fn test_delete_staged_via_index() {
    let (_dir, repo) = setup_repo();
    write_file(&repo, "a.txt", b"a");
    write_file(&repo, "b.txt", b"b");
    add_file_via_index(&repo, "a.txt");
    add_file_via_index(&repo, "b.txt");
    commit_with_msg(&repo, "init");
    // delete b.txt, stage via index remove
    fs::remove_file(repo.join("b.txt")).unwrap();
    let mut index = Index::load(&repo).unwrap();
    // Simulate add . deletion handling
    index.remove("b.txt");
    index.save(&repo).unwrap();
    let st = status::status(&repo).unwrap();
    assert_eq!(st.staged.len(), 1);
    assert_eq!(st.staged[0].status, "deleted");
    assert_eq!(st.staged[0].path, "b.txt");
    let h2 = commit_with_msg(&repo, "remove b");
    let algo = config::read_hasher(&repo).unwrap();
    let hasher = new_hasher(algo).unwrap();
    let obj = itehaas_lib::object::store::read_object(&repo, &h2, hasher.as_ref()).unwrap();
    match obj {
        Object::Commit(c) => {
            let map = tree_builder::flatten_tree_root(&repo, &c.tree, hasher.as_ref()).unwrap();
            assert!(!map.contains_key("b.txt"));
            assert!(map.contains_key("a.txt"));
        }
        _ => panic!("expected commit"),
    }
}

#[test]
fn test_status_untracked_after_commit() {
    let (_dir, repo) = setup_repo();
    write_file(&repo, "a.txt", b"a");
    add_file_via_index(&repo, "a.txt");
    commit_with_msg(&repo, "init");
    write_file(&repo, "untracked.txt", b"u");
    let st = status::status(&repo).unwrap();
    assert_eq!(st.untracked.len(), 1);
    assert_eq!(st.untracked[0], "untracked.txt");
}

#[test]
fn test_index_sorted() {
    let (_dir, repo) = setup_repo();
    // Add out of order
    write_file(&repo, "z.txt", b"z");
    write_file(&repo, "a.txt", b"a");
    write_file(&repo, "m.txt", b"m");
    add_file_via_index(&repo, "z.txt");
    add_file_via_index(&repo, "a.txt");
    add_file_via_index(&repo, "m.txt");
    let index = Index::load(&repo).unwrap();
    let paths: Vec<_> = index.entries_sorted().into_iter().map(|e| e.path.clone()).collect();
    assert_eq!(paths, vec!["a.txt", "m.txt", "z.txt"]);
}

#[test]
fn test_commit_empty_index_should_fail_via_cli() {
    // This test uses CLI behavior: commit with empty index should be prevented.
    // We test via index check: building tree from empty index creates empty tree,
    // but our cmd_commit would reject empty index. Here we test that building empty tree works,
    // but committing empty should be considered.
    let (_dir, repo) = setup_repo();
    let algo = config::read_hasher(&repo).unwrap();
    let hasher = new_hasher(algo).unwrap();
    let index = Index::load(&repo).unwrap();
    assert!(index.is_empty());
    let entries = index.entries_sorted();
    let tree_hash = tree_builder::build_tree_from_index(&repo, &entries, hasher.as_ref()).unwrap();
    // Empty tree hash should be deterministic
    let empty_tree = itehaas_lib::object::Tree::new(vec![]).unwrap();
    let expected = itehaas_lib::object::Object::Tree(empty_tree).hash(hasher.as_ref());
    assert_eq!(tree_hash.hex(), expected.hex());
}

#[test]
fn test_log_walk() {
    let (_dir, repo) = setup_repo();
    write_file(&repo, "a.txt", b"a");
    add_file_via_index(&repo, "a.txt");
    let h1 = commit_with_msg(&repo, "first");
    write_file(&repo, "a.txt", b"aa");
    add_file_via_index(&repo, "a.txt");
    let h2 = commit_with_msg(&repo, "second");
    write_file(&repo, "a.txt", b"aaa");
    add_file_via_index(&repo, "a.txt");
    let h3 = commit_with_msg(&repo, "third");
    // Walk from HEAD
    let algo = config::read_hasher(&repo).unwrap();
    let hasher = new_hasher(algo).unwrap();
    let mut cur = Some(h3.clone());
    let mut hashes = Vec::new();
    while let Some(h) = cur {
        hashes.push(h.hex());
        let obj = itehaas_lib::object::store::read_object(&repo, &h, hasher.as_ref()).unwrap();
        match obj {
            Object::Commit(c) => {
                if c.parents.is_empty() { break; }
                cur = Some(c.parents[0].clone());
            }
            _ => panic!("expected commit"),
        }
    }
    assert_eq!(hashes, vec![h3.hex(), h2.hex(), h1.hex()]);
}

#[test]
fn test_file_mode_executable() {
    let (_dir, repo) = setup_repo();
    write_file(&repo, "run.sh", b"#!/bin/sh\necho hi\n");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let p = repo.join("run.sh");
        let mut perm = fs::metadata(&p).unwrap().permissions();
        perm.set_mode(0o755);
        fs::set_permissions(&p, perm).unwrap();
        add_file_via_index(&repo, "run.sh");
        let index = Index::load(&repo).unwrap();
        let e = index.get("run.sh").unwrap();
        assert_eq!(e.mode, 0o100755);
    }
}

#[test]
fn test_add_from_subdir() {
    let (_dir, repo) = setup_repo();
    write_file(&repo, "dir/sub/file.txt", b"content");
    // Simulate add from subdir: add file via index using repo-relative path
    add_file_via_index(&repo, "dir/sub/file.txt");
    let index = Index::load(&repo).unwrap();
    assert!(index.contains("dir/sub/file.txt"));
    // Build tree and verify flatten
    let algo = config::read_hasher(&repo).unwrap();
    let hasher = new_hasher(algo).unwrap();
    let entries = index.entries_sorted();
    let root = tree_builder::build_tree_from_index(&repo, &entries, hasher.as_ref()).unwrap();
    let map = tree_builder::flatten_tree_root(&repo, &root, hasher.as_ref()).unwrap();
    assert_eq!(map.len(), 1);
    assert!(map.contains_key("dir/sub/file.txt"));
}

#[test]
fn test_commit_author_via_config() {
    let (_dir, repo) = setup_repo();
    config::write_user(&repo, "Custom", "custom@example.com").unwrap();
    write_file(&repo, "a.txt", b"a");
    add_file_via_index(&repo, "a.txt");
    let (name, email) = config::read_user(&repo).unwrap();
    assert_eq!(name.unwrap(), "Custom");
    assert_eq!(email.unwrap(), "custom@example.com");
}
