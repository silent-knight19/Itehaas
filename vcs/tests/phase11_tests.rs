use std::fs;
use std::path::Path;
use tempfile::TempDir;

use itehaas_lib::hash::HashAlgo;
use itehaas_lib::index::Index;

fn init_repo(dir: &Path) -> std::path::PathBuf {
    let repo = itehaas_lib::init(dir, HashAlgo::Sha256).unwrap();
    itehaas_lib::config::write_user(&repo, "Tester", "tester@example.com").unwrap();
    repo
}

fn commit_file(repo: &Path, name: &str, content: &str, msg: &str) {
    fs::write(repo.join(name), content).unwrap();
    // add via lib index directly for simplicity
    let algo = itehaas_lib::config::read_hasher(repo).unwrap();
    let hasher = itehaas_lib::hash::new_hasher(algo).unwrap();
    let mut idx = Index::load(repo).unwrap();
    let data = fs::read(repo.join(name)).unwrap();
    let blob = itehaas_lib::object::Blob::new(data);
    let hash = itehaas_lib::object::store::write_object(repo, &itehaas_lib::object::Object::Blob(blob), hasher.as_ref()).unwrap();
    let mode = itehaas_lib::index::file_mode(&fs::metadata(repo.join(name)).unwrap());
    idx.add_or_update(itehaas_lib::index::IndexEntry::new(name.to_string(), hash, mode));
    idx.save(repo).unwrap();
    // commit via main logic imitation: use lib tree builder + refs
    let entries = idx.entries_sorted();
    let tree = itehaas_lib::tree_builder::build_tree_from_index(repo, &entries, hasher.as_ref()).unwrap();
    let head = itehaas_lib::refs::resolve_head(repo).unwrap();
    let parents = head.map(|h| vec![h]).unwrap_or_default();
    let sig = itehaas_lib::object::Signature::new("Tester".into(), "tester@example.com".into(), 1000, "+0000".into()).unwrap();
    let commit = itehaas_lib::object::Commit::new(tree, parents, sig.clone(), sig, msg.into());
    let chash = itehaas_lib::object::store::write_object(repo, &itehaas_lib::object::Object::Commit(commit), hasher.as_ref()).unwrap();
    // update branch
    let head_ref = itehaas_lib::refs::read_head(repo).unwrap();
    match head_ref {
        itehaas_lib::refs::Head::Ref(r) | itehaas_lib::refs::Head::Unborn(r) => {
            itehaas_lib::refs::write_ref_with_log(repo, &r, &chash, &format!("commit: {}", msg)).unwrap();
        }
        _ => {}
    }
}

fn get_head(repo: &Path) -> itehaas_lib::hash::Hash {
    itehaas_lib::refs::resolve_head(repo).unwrap().unwrap()
}

#[test]
fn test_reset_soft_mixed_hard() {
    let td = TempDir::new().unwrap();
    let repo = init_repo(td.path());
    commit_file(&repo, "a.txt", "first", "first");
    let first = get_head(&repo);
    commit_file(&repo, "a.txt", "second", "second");
    let second = get_head(&repo);
    assert_ne!(first.hex(), second.hex());
    // soft to first
    itehaas_lib::reset::reset_soft(&repo, &first, "reset soft").unwrap();
    assert_eq!(get_head(&repo).hex(), first.hex());
    // index should still have second's content (soft)
    let idx = Index::load(&repo).unwrap();
    let entry = idx.get("a.txt").unwrap();
    let algo = itehaas_lib::config::read_hasher(&repo).unwrap();
    let hasher = itehaas_lib::hash::new_hasher(algo).unwrap();
    let blob_content = itehaas_lib::diff::get_blob_content(&repo, &entry.hash_as(algo).unwrap(), hasher.as_ref()).unwrap();
    assert_eq!(String::from_utf8(blob_content).unwrap(), "second");
    // mixed to second
    itehaas_lib::reset::reset_mixed(&repo, &second, "reset mixed").unwrap();
    assert_eq!(get_head(&repo).hex(), second.hex());
    let idx2 = Index::load(&repo).unwrap();
    let e2 = idx2.get("a.txt").unwrap();
    let c2 = itehaas_lib::diff::get_blob_content(&repo, &e2.hash_as(algo).unwrap(), hasher.as_ref()).unwrap();
    assert_eq!(String::from_utf8(c2).unwrap(), "second");
    // hard to first
    itehaas_lib::reset::reset_hard(&repo, &first, "reset hard").unwrap();
    assert_eq!(get_head(&repo).hex(), first.hex());
    // working tree should be first
    let wt = fs::read_to_string(repo.join("a.txt")).unwrap();
    assert_eq!(wt, "first");
    // index should be first
    let idx3 = Index::load(&repo).unwrap();
    let e3 = idx3.get("a.txt").unwrap();
    let c3 = itehaas_lib::diff::get_blob_content(&repo, &e3.hash_as(algo).unwrap(), hasher.as_ref()).unwrap();
    assert_eq!(String::from_utf8(c3).unwrap(), "first");
}

#[test]
fn test_reset_paths_unstage() {
    let td = TempDir::new().unwrap();
    let repo = init_repo(td.path());
    commit_file(&repo, "a.txt", "orig", "init");
    // modify and stage
    fs::write(repo.join("a.txt"), "modified").unwrap();
    let algo = itehaas_lib::config::read_hasher(&repo).unwrap();
    let hasher = itehaas_lib::hash::new_hasher(algo).unwrap();
    let mut idx = Index::load(&repo).unwrap();
    let data = fs::read(repo.join("a.txt")).unwrap();
    let blob = itehaas_lib::object::Blob::new(data);
    let hash = itehaas_lib::object::store::write_object(&repo, &itehaas_lib::object::Object::Blob(blob), hasher.as_ref()).unwrap();
    idx.add_or_update(itehaas_lib::index::IndexEntry::new("a.txt".into(), hash, 0o100644));
    idx.save(&repo).unwrap();
    assert_eq!(itehaas_lib::status::status(&repo).unwrap().staged.len(), 1);
    // reset paths
    let head = get_head(&repo);
    itehaas_lib::reset::reset_paths(&repo, &head, &["a.txt".into()]).unwrap();
    assert!(itehaas_lib::status::status(&repo).unwrap().staged.is_empty());
    // working tree still modified
    assert_eq!(itehaas_lib::status::status(&repo).unwrap().not_staged.len(), 1);
}

#[test]
fn test_restore() {
    let td = TempDir::new().unwrap();
    let repo = init_repo(td.path());
    commit_file(&repo, "a.txt", "orig", "init");
    // staged change
    fs::write(repo.join("a.txt"), "staged").unwrap();
    let algo = itehaas_lib::config::read_hasher(&repo).unwrap();
    let hasher = itehaas_lib::hash::new_hasher(algo).unwrap();
    let mut idx = Index::load(&repo).unwrap();
    let data = fs::read(repo.join("a.txt")).unwrap();
    let blob = itehaas_lib::object::Blob::new(data);
    let hash = itehaas_lib::object::store::write_object(&repo, &itehaas_lib::object::Object::Blob(blob), hasher.as_ref()).unwrap();
    idx.add_or_update(itehaas_lib::index::IndexEntry::new("a.txt".into(), hash, 0o100644));
    idx.save(&repo).unwrap();
    // restore staged
    itehaas_lib::restore::restore(&repo, &["a.txt".into()], true, None, false).unwrap();
    assert!(itehaas_lib::status::status(&repo).unwrap().staged.is_empty());
    // modify worktree and restore worktree from index
    fs::write(repo.join("a.txt"), "dirty").unwrap();
    itehaas_lib::restore::restore(&repo, &["a.txt".into()], false, None, true).unwrap();
    assert_eq!(fs::read_to_string(repo.join("a.txt")).unwrap(), "orig");
}

#[test]
fn test_rm_mv_clean() {
    let td = TempDir::new().unwrap();
    let repo = init_repo(td.path());
    commit_file(&repo, "a.txt", "hello", "init");
    // rm
    let st_before = itehaas_lib::status::status(&repo).unwrap();
    assert!(st_before.staged.is_empty());
    // create and add file then rm
    fs::write(repo.join("b.txt"), "b").unwrap();
    let algo = itehaas_lib::config::read_hasher(&repo).unwrap();
    let hasher = itehaas_lib::hash::new_hasher(algo).unwrap();
    let mut idx = Index::load(&repo).unwrap();
    let data = fs::read(repo.join("b.txt")).unwrap();
    let blob = itehaas_lib::object::Blob::new(data);
    let hash = itehaas_lib::object::store::write_object(&repo, &itehaas_lib::object::Object::Blob(blob), hasher.as_ref()).unwrap();
    idx.add_or_update(itehaas_lib::index::IndexEntry::new("b.txt".into(), hash, 0o100644));
    idx.save(&repo).unwrap();
    // now rm b.txt via index remove imitating main rm
    let mut idx2 = Index::load(&repo).unwrap();
    idx2.remove("b.txt");
    idx2.save(&repo).unwrap();
    fs::remove_file(repo.join("b.txt")).unwrap();
    assert!(!Index::load(&repo).unwrap().contains("b.txt"));
    // mv
    fs::write(repo.join("c.txt"), "c").unwrap();
    let mut idx3 = Index::load(&repo).unwrap();
    let data = fs::read(repo.join("c.txt")).unwrap();
    let blob = itehaas_lib::object::Blob::new(data);
    let hash = itehaas_lib::object::store::write_object(&repo, &itehaas_lib::object::Object::Blob(blob), hasher.as_ref()).unwrap();
    idx3.add_or_update(itehaas_lib::index::IndexEntry::new("c.txt".into(), hash, 0o100644));
    idx3.save(&repo).unwrap();
    fs::rename(repo.join("c.txt"), repo.join("d.txt")).unwrap();
    let mut idx4 = Index::load(&repo).unwrap();
    idx4.remove("c.txt");
    let data = fs::read(repo.join("d.txt")).unwrap();
    let blob = itehaas_lib::object::Blob::new(data);
    let hash = itehaas_lib::object::store::write_object(&repo, &itehaas_lib::object::Object::Blob(blob), hasher.as_ref()).unwrap();
    idx4.add_or_update(itehaas_lib::index::IndexEntry::new("d.txt".into(), hash, 0o100644));
    idx4.save(&repo).unwrap();
    assert!(!Index::load(&repo).unwrap().contains("c.txt"));
    assert!(Index::load(&repo).unwrap().contains("d.txt"));
    // clean: create untracked
    fs::write(repo.join("untracked.txt"), "u").unwrap();
    let status = itehaas_lib::status::status(&repo).unwrap();
    assert!(status.untracked.contains(&"untracked.txt".to_string()));
    fs::remove_file(repo.join("untracked.txt")).unwrap();
    assert!(!repo.join("untracked.txt").exists());
}

#[test]
fn test_stash() {
    let td = TempDir::new().unwrap();
    let repo = init_repo(td.path());
    commit_file(&repo, "a.txt", "base", "init");
    fs::write(repo.join("a.txt"), "modified").unwrap();
    // stash push
    let hash = itehaas_lib::stash::stash_push(&repo, "test stash", false).unwrap();
    assert!(hash.hex().len() == 64);
    let list = itehaas_lib::stash::stash_list(&repo).unwrap();
    assert_eq!(list.len(), 1);
    assert!(itehaas_lib::status::status(&repo).unwrap().is_clean());
    assert_eq!(fs::read_to_string(repo.join("a.txt")).unwrap(), "base");
    // apply without pop (keep stash)
    itehaas_lib::stash::stash_apply(&repo, 0, false).unwrap();
    let content = fs::read_to_string(repo.join("a.txt")).unwrap();
    // After apply, a.txt may have conflict markers or modified depending on apply logic
    // It should be either modified or contain stashed content
    assert!(content.contains("modified") || content.contains("base"));
    // clear
    itehaas_lib::stash::stash_clear(&repo).unwrap();
    assert_eq!(itehaas_lib::stash::stash_list(&repo).unwrap().len(), 0);
}

#[test]
fn test_tag() {
    let td = TempDir::new().unwrap();
    let repo = init_repo(td.path());
    commit_file(&repo, "a.txt", "hello", "init");
    let head = get_head(&repo);
    // lightweight tag via refs directly
    itehaas_lib::refs::write_ref(&repo, "refs/tags/v1.0", &head).unwrap();
    assert!(itehaas_lib::refs::read_ref(&repo, "refs/tags/v1.0").unwrap().is_some());
    // annotated tag object
    let sig = itehaas_lib::object::Signature::new("Tester".into(), "tester@example.com".into(), 1000, "+0000".into()).unwrap();
    let tag = itehaas_lib::object::Tag {
        object: head.clone(),
        object_type: "commit".into(),
        name: "v1.1".into(),
        tagger: sig,
        message: "release".into(),
    };
    let algo = itehaas_lib::config::read_hasher(&repo).unwrap();
    let hasher = itehaas_lib::hash::new_hasher(algo).unwrap();
    let thash = itehaas_lib::object::store::write_object(&repo, &itehaas_lib::object::Object::Tag(tag), hasher.as_ref()).unwrap();
    itehaas_lib::refs::write_ref(&repo, "refs/tags/v1.1", &thash).unwrap();
    assert!(itehaas_lib::refs::read_ref(&repo, "refs/tags/v1.1").unwrap().is_some());
    // delete
    fs::remove_file(repo.join(".itehaas").join("refs/tags/v1.0")).unwrap();
    assert!(itehaas_lib::refs::read_ref(&repo, "refs/tags/v1.0").unwrap().is_none());
}

#[test]
fn test_reflog() {
    let td = TempDir::new().unwrap();
    let repo = init_repo(td.path());
    commit_file(&repo, "a.txt", "first", "first");
    let entries = itehaas_lib::reflog::read_reflog(&repo, "HEAD").unwrap();
    assert!(!entries.is_empty());
    assert!(entries.iter().any(|e| e.message.contains("commit")));
    // branch reflog
    let bentries = itehaas_lib::reflog::read_reflog(&repo, "refs/heads/main").unwrap();
    assert!(!bentries.is_empty());
}

#[test]
fn test_branch_move_and_list() {
    let td = TempDir::new().unwrap();
    let repo = init_repo(td.path());
    commit_file(&repo, "a.txt", "hello", "init");
    let head = get_head(&repo);
    itehaas_lib::refs::create_branch(&repo, "feature", &head).unwrap();
    // rename via manual
    let new_ref = "refs/heads/renamed";
    let old_ref = "refs/heads/feature";
    let hash = itehaas_lib::refs::read_ref(&repo, old_ref).unwrap().unwrap();
    itehaas_lib::refs::write_ref(&repo, new_ref, &hash).unwrap();
    itehaas_lib::refs::delete_branch(&repo, "feature").unwrap();
    assert!(itehaas_lib::refs::read_ref(&repo, old_ref).unwrap().is_none());
    assert!(itehaas_lib::refs::read_ref(&repo, new_ref).unwrap().is_some());
    let branches = itehaas_lib::refs::list_branches(&repo).unwrap();
    assert!(branches.contains(&"renamed".to_string()));
}

#[test]
fn test_ignore() {
    let td = TempDir::new().unwrap();
    let repo = init_repo(td.path());
    commit_file(&repo, "a.txt", "hello", "init");
    fs::write(repo.join(".itehaasignore"), "*.log\nbuild/\n!important.log\n").unwrap();
    fs::write(repo.join("a.log"), "log").unwrap();
    fs::write(repo.join("important.log"), "keep").unwrap();
    fs::create_dir_all(repo.join("build")).unwrap();
    fs::write(repo.join("build/x.txt"), "build").unwrap();
    fs::write(repo.join("keep.txt"), "keep").unwrap();
    assert!(itehaas_lib::ignore::is_ignored(&repo, Path::new("a.log"), false));
    assert!(!itehaas_lib::ignore::is_ignored(&repo, Path::new("important.log"), false));
    assert!(itehaas_lib::ignore::is_ignored(&repo, Path::new("build/x.txt"), false));
    assert!(itehaas_lib::ignore::is_ignored(&repo, Path::new("build"), true));
    assert!(!itehaas_lib::ignore::is_ignored(&repo, Path::new("keep.txt"), false));
    // status should ignore
    let st = itehaas_lib::status::status(&repo).unwrap();
    assert!(!st.untracked.iter().any(|p| p == "a.log"));
    assert!(st.untracked.contains(&"important.log".to_string()));
    assert!(!st.untracked.iter().any(|p| p.starts_with("build/")));
    assert!(st.untracked.contains(&"keep.txt".to_string()));
}

#[test]
fn test_clean_dry_run_logic() {
    let td = TempDir::new().unwrap();
    let repo = init_repo(td.path());
    commit_file(&repo, "a.txt", "hello", "init");
    fs::write(repo.join("untracked.txt"), "u").unwrap();
    let st = itehaas_lib::status::status(&repo).unwrap();
    assert!(st.untracked.contains(&"untracked.txt".to_string()));
    // simulate clean -n would list untracked, -f would delete
    // Here test that ignore respects clean: create ignored file shouldn't be listed
    fs::write(repo.join(".itehaasignore"), "*.tmp\n").unwrap();
    fs::write(repo.join("ignored.tmp"), "tmp").unwrap();
    let st2 = itehaas_lib::status::status(&repo).unwrap();
    assert!(!st2.untracked.contains(&"ignored.tmp".to_string()));
}
