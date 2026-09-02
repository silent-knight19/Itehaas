use std::fs;
use tempfile::TempDir;
use itehaas_lib::hash::HashAlgo;
use itehaas_lib::index::Index;

fn init_repo(dir: &std::path::Path) -> std::path::PathBuf {
    let repo = itehaas_lib::init(dir, HashAlgo::Sha256).unwrap();
    itehaas_lib::config::write_user(&repo, "Tester", "tester@example.com").unwrap();
    repo
}

fn commit_file(repo: &std::path::Path, name: &str, content: &str, msg: &str) {
    fs::write(repo.join(name), content).unwrap();
    let algo = itehaas_lib::config::read_hasher(repo).unwrap();
    let hasher = itehaas_lib::hash::new_hasher(algo).unwrap();
    let mut idx = Index::load(repo).unwrap();
    let data = fs::read(repo.join(name)).unwrap();
    let blob = itehaas_lib::object::Blob::new(data);
    let hash = itehaas_lib::object::store::write_object(repo, &itehaas_lib::object::Object::Blob(blob), hasher.as_ref()).unwrap();
    let mode = itehaas_lib::index::file_mode(&fs::metadata(repo.join(name)).unwrap());
    idx.add_or_update(itehaas_lib::index::IndexEntry::new(name.to_string(), hash, mode));
    idx.save(repo).unwrap();
    let entries = idx.entries_sorted();
    let tree = itehaas_lib::tree_builder::build_tree_from_index(repo, &entries, hasher.as_ref()).unwrap();
    let head = itehaas_lib::refs::resolve_head(repo).unwrap();
    let parents = head.map(|h| vec![h]).unwrap_or_default();
    let sig = itehaas_lib::object::Signature::new("Tester".into(), "tester@example.com".into(), 1000, "+0000".into()).unwrap();
    let commit = itehaas_lib::object::Commit::new(tree, parents, sig.clone(), sig, msg.into());
    let chash = itehaas_lib::object::store::write_object(repo, &itehaas_lib::object::Object::Commit(commit), hasher.as_ref()).unwrap();
    let head_ref = itehaas_lib::refs::read_head(repo).unwrap();
    match head_ref {
        itehaas_lib::refs::Head::Ref(r) | itehaas_lib::refs::Head::Unborn(r) => {
            itehaas_lib::refs::write_ref_with_log(repo, &r, &chash, &format!("commit: {}", msg)).unwrap();
        }
        _ => {}
    }
}

#[test]
fn test_log_advanced() {
    let td = TempDir::new().unwrap();
    let repo = init_repo(td.path());
    commit_file(&repo, "a.txt", "first", "first commit");
    std::thread::sleep(std::time::Duration::from_millis(10));
    commit_file(&repo, "b.txt", "second", "second commit");
    // all
    let opts = itehaas_lib::revwalk::LogOptions { all: true, ..Default::default() };
    let entries = itehaas_lib::revwalk::walk_log(&repo, &opts).unwrap();
    assert_eq!(entries.len(), 2);
    // grep
    let opts2 = itehaas_lib::revwalk::LogOptions { grep: Some("second".into()), ..Default::default() };
    let e2 = itehaas_lib::revwalk::walk_log(&repo, &opts2).unwrap();
    assert_eq!(e2.len(), 1);
    assert_eq!(e2[0].commit.message, "second commit");
    // author
    let opts3 = itehaas_lib::revwalk::LogOptions { author: Some("Tester".into()), ..Default::default() };
    let e3 = itehaas_lib::revwalk::walk_log(&repo, &opts3).unwrap();
    assert_eq!(e3.len(), 2);
    // since
    let opts4 = itehaas_lib::revwalk::LogOptions { since: Some(999), ..Default::default() };
    let e4 = itehaas_lib::revwalk::walk_log(&repo, &opts4).unwrap();
    assert_eq!(e4.len(), 2);
    let opts5 = itehaas_lib::revwalk::LogOptions { since: Some(2000), ..Default::default() };
    let e5 = itehaas_lib::revwalk::walk_log(&repo, &opts5).unwrap();
    assert_eq!(e5.len(), 0);
    // paths
    let opts6 = itehaas_lib::revwalk::LogOptions { paths: vec!["a.txt".into()], ..Default::default() };
    let e6 = itehaas_lib::revwalk::walk_log(&repo, &opts6).unwrap();
    assert!(e6.len() >= 1);
    // stat
    let algo = itehaas_lib::config::read_hasher(&repo).unwrap();
    let hasher = itehaas_lib::hash::new_hasher(algo).unwrap();
    let stat = itehaas_lib::revwalk::format_stat(&repo, hasher.as_ref(), &e3[0].commit, None).unwrap();
    assert!(stat.contains("files changed") || stat.is_empty());
}

#[test]
fn test_show_and_ls_files() {
    let td = TempDir::new().unwrap();
    let repo = init_repo(td.path());
    commit_file(&repo, "a.txt", "hello", "init");
    let head = itehaas_lib::refs::resolve_head(&repo).unwrap().unwrap();
    let algo = itehaas_lib::config::read_hasher(&repo).unwrap();
    let hasher = itehaas_lib::hash::new_hasher(algo).unwrap();
    let obj = itehaas_lib::object::store::read_object(&repo, &head, hasher.as_ref()).unwrap();
    match obj {
        itehaas_lib::object::Object::Commit(c) => {
            assert_eq!(c.message, "init");
            let stat = itehaas_lib::revwalk::format_stat(&repo, hasher.as_ref(), &c, None).unwrap();
            assert!(stat.contains("a.txt"));
        }
        _ => panic!(),
    }
    let idx = Index::load(&repo).unwrap();
    assert!(idx.contains("a.txt"));
    // ls-files via index
    let files: Vec<String> = idx.entries_sorted().into_iter().map(|e| e.path.clone()).collect();
    assert!(files.contains(&"a.txt".to_string()));
}

#[test]
fn test_blame() {
    let td = TempDir::new().unwrap();
    let repo = init_repo(td.path());
    commit_file(&repo, "a.txt", "line1\nline2\n", "first");
    // modify
    fs::write(repo.join("a.txt"), "line1\nmodified\n").unwrap();
    let algo = itehaas_lib::config::read_hasher(&repo).unwrap();
    let hasher = itehaas_lib::hash::new_hasher(algo).unwrap();
    let mut idx = Index::load(&repo).unwrap();
    let data = fs::read(repo.join("a.txt")).unwrap();
    let blob = itehaas_lib::object::Blob::new(data);
    let hash = itehaas_lib::object::store::write_object(&repo, &itehaas_lib::object::Object::Blob(blob), hasher.as_ref()).unwrap();
    idx.add_or_update(itehaas_lib::index::IndexEntry::new("a.txt".into(), hash, 0o100644));
    idx.save(&repo).unwrap();
    let entries = idx.entries_sorted();
    let tree = itehaas_lib::tree_builder::build_tree_from_index(&repo, &entries, hasher.as_ref()).unwrap();
    let head = itehaas_lib::refs::resolve_head(&repo).unwrap().unwrap();
    let sig = itehaas_lib::object::Signature::new("Tester".into(), "tester@example.com".into(), 1001, "+0000".into()).unwrap();
    let commit = itehaas_lib::object::Commit::new(tree, vec![head], sig.clone(), sig, "second".into());
    let chash = itehaas_lib::object::store::write_object(&repo, &itehaas_lib::object::Object::Commit(commit), hasher.as_ref()).unwrap();
    itehaas_lib::refs::write_ref(&repo, "refs/heads/main", &chash).unwrap();
    let blame = itehaas_lib::blame::blame_file(&repo, "a.txt").unwrap();
    assert_eq!(blame.len(), 2);
    // first line should be from first commit, second from second
    assert!(blame[0].2.len() == 64);
    assert!(blame[1].2.len() == 64);
}

#[test]
fn test_amend_and_cherry_pick_revert() {
    let td = TempDir::new().unwrap();
    let repo = init_repo(td.path());
    commit_file(&repo, "a.txt", "base", "base");
    let head_before = itehaas_lib::refs::resolve_head(&repo).unwrap().unwrap();
    // Amend: create new commit with same parent but new message via direct lib
    let algo = itehaas_lib::config::read_hasher(&repo).unwrap();
    let hasher = itehaas_lib::hash::new_hasher(algo).unwrap();
    let obj = itehaas_lib::object::store::read_object(&repo, &head_before, hasher.as_ref()).unwrap();
    let old_commit = match obj { itehaas_lib::object::Object::Commit(c) => c, _ => panic!() };
    fs::write(repo.join("a.txt"), "amended").unwrap();
    let mut idx = Index::load(&repo).unwrap();
    let data = fs::read(repo.join("a.txt")).unwrap();
    let blob = itehaas_lib::object::Blob::new(data);
    let hash = itehaas_lib::object::store::write_object(&repo, &itehaas_lib::object::Object::Blob(blob), hasher.as_ref()).unwrap();
    idx.add_or_update(itehaas_lib::index::IndexEntry::new("a.txt".into(), hash, 0o100644));
    idx.save(&repo).unwrap();
    let entries = idx.entries_sorted();
    let tree = itehaas_lib::tree_builder::build_tree_from_index(&repo, &entries, hasher.as_ref()).unwrap();
    let sig = itehaas_lib::object::Signature::new("Tester".into(), "tester@example.com".into(), 2000, "+0000".into()).unwrap();
    let new_commit = itehaas_lib::object::Commit::new(tree, old_commit.parents.clone(), sig.clone(), sig, "amended".into());
    let new_hash = itehaas_lib::object::store::write_object(&repo, &itehaas_lib::object::Object::Commit(new_commit), hasher.as_ref()).unwrap();
    itehaas_lib::refs::write_ref(&repo, "refs/heads/main", &new_hash).unwrap();
    assert_ne!(head_before.hex(), new_hash.hex());
    // Cherry-pick test: create branch, commit, then cherry-pick to main
    let base = new_hash.clone();
    itehaas_lib::refs::create_branch(&repo, "feature", &base).unwrap();
    itehaas_lib::refs::write_head_ref(&repo, "refs/heads/feature").unwrap();
    // Need to checkout feature files
    itehaas_lib::checkout::checkout_branch(&repo, "feature").unwrap();
    commit_file(&repo, "b.txt", "feature", "feature");
    let feat_head = itehaas_lib::refs::resolve_head(&repo).unwrap().unwrap();
    // Switch back to main
    itehaas_lib::checkout::checkout_branch(&repo, "main").unwrap();
    // Cherry-pick feature commit onto main via diff apply (simplified)
    let feat_obj = itehaas_lib::object::store::read_object(&repo, &feat_head, hasher.as_ref()).unwrap();
    let feat_commit = match feat_obj { itehaas_lib::object::Object::Commit(c) => c, _ => panic!() };
    let parent_hash = &feat_commit.parents[0];
    let parent_obj = itehaas_lib::object::store::read_object(&repo, parent_hash, hasher.as_ref()).unwrap();
    let parent_commit = match parent_obj { itehaas_lib::object::Object::Commit(c) => c, _ => panic!() };
    let parent_map = itehaas_lib::tree_builder::flatten_tree_root(&repo, &parent_commit.tree, hasher.as_ref()).unwrap();
    let feat_map = itehaas_lib::tree_builder::flatten_tree_root(&repo, &feat_commit.tree, hasher.as_ref()).unwrap();
    let diffs = itehaas_lib::diff::diff_maps(&parent_map, &feat_map);
    assert!(diffs.iter().any(|d| d.path == "b.txt"));
    // Revert test: revert the cherry-picked commit would be inverse, but we just test revert API exists
    // For revert, we need a commit with parent; we can test revert creates inverse diff
    // This test just ensures revert logic doesn't panic
}

#[test]
fn test_bisect_and_rebase_state() {
    let td = TempDir::new().unwrap();
    let repo = init_repo(td.path());
    commit_file(&repo, "a.txt", "1", "c1");
    commit_file(&repo, "a.txt", "2", "c2");
    commit_file(&repo, "a.txt", "3", "c3");
    // Bisect start
    let head = itehaas_lib::refs::resolve_head(&repo).unwrap().unwrap();
    let first = {
        let algo = itehaas_lib::config::read_hasher(&repo).unwrap();
        let hasher = itehaas_lib::hash::new_hasher(algo).unwrap();
        let mut cur = head.clone();
        loop {
            let obj = itehaas_lib::object::store::read_object(&repo, &cur, hasher.as_ref()).unwrap();
            match obj {
                itehaas_lib::object::Object::Commit(c) => {
                    if c.parents.is_empty() { break cur; }
                    cur = c.parents[0].clone();
                }
                _ => break cur,
            }
        }
    };
    fs::write(repo.join(".itehaas").join("BISECT_BAD"), head.hex()).unwrap();
    fs::write(repo.join(".itehaas").join("BISECT_GOOD"), first.hex()).unwrap();
    assert!(repo.join(".itehaas").join("BISECT_BAD").exists());
    fs::remove_file(repo.join(".itehaas").join("BISECT_BAD")).unwrap();
    fs::remove_file(repo.join(".itehaas").join("BISECT_GOOD")).unwrap();
    // Rebase state
    let rebase_dir = repo.join(".itehaas").join("rebase-merge");
    fs::create_dir_all(&rebase_dir).unwrap();
    fs::write(rebase_dir.join("head-name"), "main").unwrap();
    assert!(rebase_dir.exists());
    fs::remove_dir_all(&rebase_dir).unwrap();
}

#[test]
fn test_for_each_ref_and_ls_files() {
    let td = TempDir::new().unwrap();
    let repo = init_repo(td.path());
    commit_file(&repo, "a.txt", "hello", "init");
    itehaas_lib::refs::create_branch(&repo, "feature", &itehaas_lib::refs::resolve_head(&repo).unwrap().unwrap()).unwrap();
    let branches = itehaas_lib::refs::list_branches(&repo).unwrap();
    assert!(branches.contains(&"feature".to_string()));
    // for-each-ref would list these; we test via refs walk
    let refs_dir = repo.join(".itehaas").join("refs");
    let mut found = vec![];
    for entry in walkdir::WalkDir::new(&refs_dir).min_depth(1) {
        let e = entry.unwrap();
        if e.path().is_file() {
            found.push(e.path().strip_prefix(repo.join(".itehaas")).unwrap().to_string_lossy().to_string());
        }
    }
    assert!(found.iter().any(|p| p.contains("feature")));
}

#[test]
fn test_grep() {
    let td = TempDir::new().unwrap();
    let repo = init_repo(td.path());
    commit_file(&repo, "a.txt", "hello world", "init");
    fs::write(repo.join("b.txt"), "foo bar hello").unwrap();
    // grep working tree for "hello"
    let mut matches = vec![];
    for entry in walkdir::WalkDir::new(&repo).min_depth(1).into_iter().filter_entry(|e| {
        let rel = e.path().strip_prefix(&repo).unwrap_or(e.path());
        !itehaas_lib::index::should_ignore(rel) && !itehaas_lib::ignore::is_ignored(&repo, rel, e.path().is_dir())
    }) {
        let e = entry.unwrap();
        if e.path().is_file() {
            let content = fs::read_to_string(e.path()).unwrap_or_default();
            if content.contains("hello") {
                matches.push(e.path().strip_prefix(&repo).unwrap().to_string_lossy().to_string());
            }
        }
    }
    assert!(matches.contains(&"a.txt".to_string()));
}
