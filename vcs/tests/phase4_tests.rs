use std::fs;
use std::path::Path;
use itehaas_lib::config;
use itehaas_lib::hash::HashAlgo;
use itehaas_lib::refs;
use itehaas_lib::index::Index;
use itehaas_lib::diff;
use itehaas_lib::merge;
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
fn test_diff_working_vs_index() {
    let (_dir, repo) = setup_repo();
    add_and_commit(&repo, "a.txt", b"hello", "init");
    // Modify without staging
    write_file(&repo, "a.txt", b"hello world");
    let diffs = diff::diff_working_vs_index(&repo).unwrap();
    assert_eq!(diffs.len(), 1);
    assert_eq!(diffs[0].path, "a.txt");
    assert_eq!(diffs[0].status, diff::DiffStatus::Modified);
    // After staging, working vs index should be clean
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
    let diffs2 = diff::diff_working_vs_index(&repo).unwrap();
    assert!(diffs2.is_empty());
}

#[test]
fn test_diff_index_vs_head() {
    let (_dir, repo) = setup_repo();
    add_and_commit(&repo, "a.txt", b"hello", "init");
    write_file(&repo, "a.txt", b"hello world");
    // Not staged: index vs HEAD should be empty (index still has old)
    let diffs = diff::diff_index_vs_head(&repo).unwrap();
    assert!(diffs.is_empty());
    // Stage
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
    let diffs2 = diff::diff_index_vs_head(&repo).unwrap();
    assert_eq!(diffs2.len(), 1);
    assert_eq!(diffs2[0].status, diff::DiffStatus::Modified);
}

#[test]
fn test_diff_added_deleted() {
    let (_dir, repo) = setup_repo();
    add_and_commit(&repo, "a.txt", b"a", "init");
    // Add new file
    write_file(&repo, "b.txt", b"b");
    let algo = config::read_hasher(&repo).unwrap();
    let hasher = itehaas_lib::hash::new_hasher(algo).unwrap();
    let mut index = Index::load(&repo).unwrap();
    let abs = repo.join("b.txt");
    let data = fs::read(&abs).unwrap();
    let blob = itehaas_lib::object::Blob::new(data);
    let obj = itehaas_lib::object::Object::Blob(blob);
    let hash = itehaas_lib::object::store::write_object(&repo, &obj, hasher.as_ref()).unwrap();
    let mode = itehaas_lib::index::file_mode(&fs::metadata(&abs).unwrap());
    let entry = itehaas_lib::index::IndexEntry::new("b.txt".to_string(), hash, mode);
    index.add_or_update(entry);
    index.save(&repo).unwrap();
    let diffs = diff::diff_index_vs_head(&repo).unwrap();
    assert_eq!(diffs.len(), 1);
    assert_eq!(diffs[0].status, diff::DiffStatus::Added);
    // Delete file
    fs::remove_file(repo.join("a.txt")).unwrap();
    index.remove("a.txt");
    index.save(&repo).unwrap();
    let diffs2 = diff::diff_index_vs_head(&repo).unwrap();
    assert!(diffs2.iter().any(|d| d.path == "a.txt" && d.status == diff::DiffStatus::Deleted));
}

#[test]
fn test_unified_diff() {
    let old = b"hello\nworld\n";
    let new = b"hello\nworld modified\n";
    let diff = diff::unified_diff(old, new, "test.txt");
    assert!(diff.contains("diff --itehaas"));
    assert!(diff.contains("-world"));
    assert!(diff.contains("+world modified"));
    // Binary
    let bin_old = b"hello\x00world";
    let diff2 = diff::unified_diff(bin_old, new, "bin.txt");
    assert!(diff2.contains("Binary files"));
}

#[test]
fn test_is_ancestor_and_common_ancestor() {
    let (_dir, repo) = setup_repo();
    let h1 = add_and_commit(&repo, "a.txt", b"a", "init");
    let h2 = add_and_commit(&repo, "b.txt", b"b", "second");
    // h1 is ancestor of h2
    assert!(merge::is_ancestor(&repo, &h1, &h2).unwrap());
    assert!(!merge::is_ancestor(&repo, &h2, &h1).unwrap());
    let ca = merge::find_common_ancestor(&repo, &h1, &h2).unwrap().unwrap();
    assert_eq!(ca.hex(), h1.hex());
    // Same commit
    let ca2 = merge::find_common_ancestor(&repo, &h2, &h2).unwrap().unwrap();
    assert_eq!(ca2.hex(), h2.hex());
}

#[test]
fn test_common_ancestor_diverged() {
    let (_dir, repo) = setup_repo();
    let base = add_and_commit(&repo, "base.txt", b"base", "base");
    refs::create_branch(&repo, "feature", &base).unwrap();
    // Commit on main
    let main_h = add_and_commit(&repo, "main.txt", b"main", "main");
    // Checkout feature and commit
    itehaas_lib::checkout::checkout_branch(&repo, "feature").unwrap();
    let feat_h = add_and_commit(&repo, "feature.txt", b"feature", "feature");
    let ca = merge::find_common_ancestor(&repo, &main_h, &feat_h).unwrap().unwrap();
    assert_eq!(ca.hex(), base.hex());
    // Back to main
    itehaas_lib::checkout::checkout_branch(&repo, "main").unwrap();
}

#[test]
fn test_merge_fast_forward() {
    let (_dir, repo) = setup_repo();
    let base = add_and_commit(&repo, "base.txt", b"base", "base");
    refs::create_branch(&repo, "feature", &base).unwrap();
    itehaas_lib::checkout::checkout_branch(&repo, "feature").unwrap();
    let feat = add_and_commit(&repo, "feature.txt", b"feature", "feature");
    itehaas_lib::checkout::checkout_branch(&repo, "main").unwrap();
    let head_before = refs::resolve_head(&repo).unwrap().unwrap();
    assert_eq!(head_before.hex(), base.hex());
    let res = merge::merge(&repo, "feature", &feat, "main", &head_before).unwrap();
    assert!(res.fast_forward);
    assert!(!res.already_up_to_date);
    let head_after = refs::resolve_head(&repo).unwrap().unwrap();
    assert_eq!(head_after.hex(), feat.hex());
    assert!(repo.join("feature.txt").exists());
}

#[test]
fn test_merge_already_up_to_date() {
    let (_dir, repo) = setup_repo();
    let base = add_and_commit(&repo, "a.txt", b"a", "base");
    refs::create_branch(&repo, "feature", &base).unwrap();
    // Main advances, feature stays at base (so feature is ancestor of main)
    add_and_commit(&repo, "b.txt", b"b", "second");
    let main_h = refs::resolve_head(&repo).unwrap().unwrap();
    let feat_h = refs::read_ref(&repo, "refs/heads/feature").unwrap().unwrap();
    let res = merge::merge(&repo, "feature", &feat_h, "main", &main_h).unwrap();
    assert!(res.already_up_to_date);
}

#[test]
fn test_merge_three_way_no_conflict() {
    let (_dir, repo) = setup_repo();
    let base = add_and_commit(&repo, "base.txt", b"base", "base");
    refs::create_branch(&repo, "feature", &base).unwrap();
    // Main adds main.txt
    let main_h = add_and_commit(&repo, "main.txt", b"main", "main");
    // Feature adds feature.txt
    itehaas_lib::checkout::checkout_branch(&repo, "feature").unwrap();
    let feat_h = add_and_commit(&repo, "feature.txt", b"feature", "feature");
    itehaas_lib::checkout::checkout_branch(&repo, "main").unwrap();
    let cur_h = refs::resolve_head(&repo).unwrap().unwrap();
    let res = merge::merge(&repo, "feature", &feat_h, "main", &cur_h).unwrap();
    assert!(!res.fast_forward);
    assert!(res.conflicts.is_empty());
    // Check merge commit has 2 parents
    let new_head = refs::resolve_head(&repo).unwrap().unwrap();
    let algo = config::read_hasher(&repo).unwrap();
    let hasher = itehaas_lib::hash::new_hasher(algo).unwrap();
    let obj = itehaas_lib::object::store::read_object(&repo, &new_head, hasher.as_ref()).unwrap();
    match obj {
        itehaas_lib::object::Object::Commit(c) => {
            assert_eq!(c.parents.len(), 2);
            assert!(c.parents.iter().any(|p| p.hex() == main_h.hex()));
            assert!(c.parents.iter().any(|p| p.hex() == feat_h.hex()));
        }
        _ => panic!("expected commit"),
    }
    // Both files should exist
    assert!(repo.join("main.txt").exists());
    assert!(repo.join("feature.txt").exists());
    assert!(repo.join("base.txt").exists());
}

#[test]
fn test_merge_conflict() {
    let (_dir, repo) = setup_repo();
    add_and_commit(&repo, "conflict.txt", b"base", "base");
    refs::create_branch(&repo, "feature", &refs::resolve_head(&repo).unwrap().unwrap()).unwrap();
    // Main modifies
    write_file(&repo, "conflict.txt", b"main change");
    let main_h = {
        let p = repo.join("conflict.txt");
        let algo = config::read_hasher(&repo).unwrap();
        let hasher = itehaas_lib::hash::new_hasher(algo).unwrap();
        let mut index = Index::load(&repo).unwrap();
        let data = fs::read(&p).unwrap();
        let blob = itehaas_lib::object::Blob::new(data);
        let obj = itehaas_lib::object::Object::Blob(blob);
        let hash = itehaas_lib::object::store::write_object(&repo, &obj, hasher.as_ref()).unwrap();
        let mode = itehaas_lib::index::file_mode(&fs::metadata(&p).unwrap());
        let entry = itehaas_lib::index::IndexEntry::new("conflict.txt".to_string(), hash, mode);
        index.add_or_update(entry);
        index.save(&repo).unwrap();
        let idx = Index::load(&repo).unwrap();
        let entries = idx.entries_sorted();
        let tree = itehaas_lib::tree_builder::build_tree_from_index(&repo, &entries, hasher.as_ref()).unwrap();
        let parent = refs::resolve_head(&repo).unwrap().unwrap();
        let sig = itehaas_lib::object::Signature::new("Tester".into(), "tester@example.com".into(), 1000, "+0000".into()).unwrap();
        let commit = itehaas_lib::object::Commit::new(tree, vec![parent], sig.clone(), sig, "main change".into());
        let obj = itehaas_lib::object::Object::Commit(commit);
        let h = itehaas_lib::object::store::write_object(&repo, &obj, hasher.as_ref()).unwrap();
        refs::write_ref(&repo, "refs/heads/main", &h).unwrap();
        h
    };
    // Feature modifies differently
    itehaas_lib::checkout::checkout_branch(&repo, "feature").unwrap();
    write_file(&repo, "conflict.txt", b"feature change");
    let feat_h = {
        let p = repo.join("conflict.txt");
        let algo = config::read_hasher(&repo).unwrap();
        let hasher = itehaas_lib::hash::new_hasher(algo).unwrap();
        let mut index = Index::load(&repo).unwrap();
        let data = fs::read(&p).unwrap();
        let blob = itehaas_lib::object::Blob::new(data);
        let obj = itehaas_lib::object::Object::Blob(blob);
        let hash = itehaas_lib::object::store::write_object(&repo, &obj, hasher.as_ref()).unwrap();
        let mode = itehaas_lib::index::file_mode(&fs::metadata(&p).unwrap());
        let entry = itehaas_lib::index::IndexEntry::new("conflict.txt".to_string(), hash, mode);
        index.add_or_update(entry);
        index.save(&repo).unwrap();
        let idx = Index::load(&repo).unwrap();
        let entries = idx.entries_sorted();
        let tree = itehaas_lib::tree_builder::build_tree_from_index(&repo, &entries, hasher.as_ref()).unwrap();
        let parent = refs::resolve_head(&repo).unwrap().unwrap();
        let sig = itehaas_lib::object::Signature::new("Tester".into(), "tester@example.com".into(), 1000, "+0000".into()).unwrap();
        let commit = itehaas_lib::object::Commit::new(tree, vec![parent], sig.clone(), sig, "feature change".into());
        let obj = itehaas_lib::object::Object::Commit(commit);
        let h = itehaas_lib::object::store::write_object(&repo, &obj, hasher.as_ref()).unwrap();
        refs::write_ref(&repo, "refs/heads/feature", &h).unwrap();
        h
    };
    itehaas_lib::checkout::checkout_branch(&repo, "main").unwrap();
    let cur_h = refs::resolve_head(&repo).unwrap().unwrap();
    assert_eq!(cur_h.hex(), main_h.hex());
    let res = merge::merge(&repo, "feature", &feat_h, "main", &cur_h).unwrap();
    assert!(!res.conflicts.is_empty());
    assert_eq!(res.conflicts[0], "conflict.txt");
    // Check working tree has conflict markers
    let content = fs::read_to_string(repo.join("conflict.txt")).unwrap();
    assert!(content.contains("<<<<<<< HEAD"));
    assert!(content.contains("======="));
    assert!(content.contains(">>>>>>> feature"));
    assert!(content.contains("main change"));
    assert!(content.contains("feature change"));
    // Check MERGE_HEAD exists
    assert!(repo.join(".itehaas").join("MERGE_HEAD").exists());
    // After resolve and commit, MERGE_HEAD should be cleaned
    write_file(&repo, "conflict.txt", b"resolved");
    // Add and commit via merge commit path
    let algo = config::read_hasher(&repo).unwrap();
    let hasher = itehaas_lib::hash::new_hasher(algo).unwrap();
    let mut index = Index::load(&repo).unwrap();
    let p = repo.join("conflict.txt");
    let data = fs::read(&p).unwrap();
    let blob = itehaas_lib::object::Blob::new(data);
    let obj = itehaas_lib::object::Object::Blob(blob);
    let hash = itehaas_lib::object::store::write_object(&repo, &obj, hasher.as_ref()).unwrap();
    let mode = itehaas_lib::index::file_mode(&fs::metadata(&p).unwrap());
    let entry = itehaas_lib::index::IndexEntry::new("conflict.txt".to_string(), hash, mode);
    index.add_or_update(entry);
    index.save(&repo).unwrap();
    // Simulate commit with MERGE_HEAD
    let idx = Index::load(&repo).unwrap();
    let entries = idx.entries_sorted();
    let tree = itehaas_lib::tree_builder::build_tree_from_index(&repo, &entries, hasher.as_ref()).unwrap();
    let merge_head_content = fs::read_to_string(repo.join(".itehaas").join("MERGE_HEAD")).unwrap();
    let merge_hash = itehaas_lib::hash::Hash::from_hex(algo, merge_head_content.trim()).unwrap();
    let sig = itehaas_lib::object::Signature::new("Tester".into(), "tester@example.com".into(), 1000, "+0000".into()).unwrap();
    let commit = itehaas_lib::object::Commit::new(tree, vec![cur_h.clone(), merge_hash], sig.clone(), sig, "resolve".into());
    let obj = itehaas_lib::object::Object::Commit(commit);
    let h = itehaas_lib::object::store::write_object(&repo, &obj, hasher.as_ref()).unwrap();
    refs::write_ref(&repo, "refs/heads/main", &h).unwrap();
    fs::remove_file(repo.join(".itehaas").join("MERGE_HEAD")).unwrap();
    let _ = fs::remove_file(repo.join(".itehaas").join("MERGE_MSG"));
    let _ = fs::remove_file(repo.join(".itehaas").join("MERGE_BRANCH"));
    // Check commit has 2 parents
    let obj2 = itehaas_lib::object::store::read_object(&repo, &h, hasher.as_ref()).unwrap();
    match obj2 {
        itehaas_lib::object::Object::Commit(c) => assert_eq!(c.parents.len(), 2),
        _ => panic!("expected commit"),
    }
}

#[test]
fn test_merge_file_logic() {
    let (_dir, repo) = setup_repo();
    let algo = config::read_hasher(&repo).unwrap();
    let hasher = itehaas_lib::hash::new_hasher(algo).unwrap();
    // Create blobs for different contents
    let h_base = {
        let blob = itehaas_lib::object::Blob::new(b"base".to_vec());
        let obj = itehaas_lib::object::Object::Blob(blob);
        itehaas_lib::object::store::write_object(&repo, &obj, hasher.as_ref()).unwrap()
    };
    let h_main = {
        let blob = itehaas_lib::object::Blob::new(b"main".to_vec());
        let obj = itehaas_lib::object::Object::Blob(blob);
        itehaas_lib::object::store::write_object(&repo, &obj, hasher.as_ref()).unwrap()
    };
    let h_feat = {
        let blob = itehaas_lib::object::Blob::new(b"feature".to_vec());
        let obj = itehaas_lib::object::Object::Blob(blob);
        itehaas_lib::object::store::write_object(&repo, &obj, hasher.as_ref()).unwrap()
    };
    let base = Some((h_base.clone(), 0o100644));
    let cur = Some((h_main.clone(), 0o100644));
    let feat = Some((h_feat.clone(), 0o100644));
    // Both changed differently -> conflict
    let res = merge::merge_file(&repo, "file.txt", base.as_ref(), cur.as_ref(), feat.as_ref(), "main", "feature", hasher.as_ref()).unwrap();
    assert!(res.conflict);
    // Current == ancestor, take feature
    let res2 = merge::merge_file(&repo, "file.txt", base.as_ref(), base.as_ref(), feat.as_ref(), "main", "feature", hasher.as_ref()).unwrap();
    assert!(!res2.conflict);
    assert_eq!(res2.result_hash.unwrap().hex(), h_feat.hex());
    // Feature == ancestor, take current
    let res3 = merge::merge_file(&repo, "file.txt", base.as_ref(), cur.as_ref(), base.as_ref(), "main", "feature", hasher.as_ref()).unwrap();
    assert!(!res3.conflict);
    assert_eq!(res3.result_hash.unwrap().hex(), h_main.hex());
    // Current == Feature -> take current
    let res4 = merge::merge_file(&repo, "file.txt", base.as_ref(), cur.as_ref(), cur.as_ref(), "main", "feature", hasher.as_ref()).unwrap();
    assert!(!res4.conflict);
    assert_eq!(res4.result_hash.unwrap().hex(), h_main.hex());
}
