use std::fs;
use tempfile::TempDir;
use itehaas_lib::{init, hash::HashAlgo};
use itehaas_lib::object::{Blob, Object};
use itehaas_lib::hash::new_hasher;

fn setup_repo() -> (TempDir, std::path::PathBuf) {
    let tmp = TempDir::new().unwrap();
    let repo = tmp.path().join("repo");
    init(&repo, HashAlgo::Sha256).unwrap();
    // configure user
    itehaas_lib::config::write_user(&repo, "Tester", "test@example.com").unwrap();
    (tmp, repo)
}

fn commit_file(repo: &std::path::Path, name: &str, content: &str) {
    fs::write(repo.join(name), content).unwrap();
    // add
    let algo = itehaas_lib::config::read_hasher(repo).unwrap();
    let hasher = new_hasher(algo).unwrap();
    let mut index = itehaas_lib::index::Index::load(repo).unwrap();
    let data = fs::read(repo.join(name)).unwrap();
    let blob = Blob::new(data);
    let obj = Object::Blob(blob);
    let hash = itehaas_lib::object::store::write_object(repo, &obj, hasher.as_ref()).unwrap();
    let mode = 0o100644;
    let entry = itehaas_lib::index::IndexEntry::new(name.to_string(), hash, mode);
    index.add_or_update(entry);
    index.save(repo).unwrap();

    // commit via low-level: build tree and commit
    let entries = index.entries_sorted();
    let tree_hash = itehaas_lib::tree_builder::build_tree_from_index(repo, &entries, hasher.as_ref()).unwrap();
    let parent = itehaas_lib::refs::resolve_head(repo).unwrap();
    let sig = itehaas_lib::object::Signature::new("Tester".into(), "test@example.com".into(), 0, "+0000".into()).unwrap();
    let commit = itehaas_lib::object::Commit::new(tree_hash, parent.into_iter().collect(), sig.clone(), sig, format!("commit {}", name));
    let commit_obj = Object::Commit(commit);
    let hash = itehaas_lib::object::store::write_object(repo, &commit_obj, hasher.as_ref()).unwrap();
    let head = itehaas_lib::refs::read_head(repo).unwrap();
    match head {
        itehaas_lib::refs::Head::Ref(r) | itehaas_lib::refs::Head::Unborn(r) => {
            itehaas_lib::refs::write_ref(repo, &r, &hash).unwrap()
        }
        _ => {}
    }
}

#[test]
fn test_fsck_ok() {
    let (_tmp, repo) = setup_repo();
    commit_file(&repo, "a.txt", "hello");
    let report = itehaas_lib::fsck::fsck(&repo).unwrap();
    assert_eq!(report.corrupted.len(), 0);
    assert_eq!(report.missing_refs.len(), 0);
    assert!(report.total >= 3);
}

#[test]
fn test_gc_unreachable() {
    let (_tmp, repo) = setup_repo();
    commit_file(&repo, "a.txt", "hello");
    // create unreachable blob
    let algo = itehaas_lib::config::read_hasher(&repo).unwrap();
    let hasher = new_hasher(algo).unwrap();
    let blob = Blob::new(b"unreachable".to_vec());
    let obj = Object::Blob(blob);
    let _h = itehaas_lib::object::store::write_object(&repo, &obj, hasher.as_ref()).unwrap();
    let report = itehaas_lib::fsck::fsck(&repo).unwrap();
    assert_eq!(report.unreachable, 1);
    let pruned = itehaas_lib::gc::gc(&repo, true).unwrap();
    assert_eq!(pruned, 1);
    let report2 = itehaas_lib::fsck::fsck(&repo).unwrap();
    assert_eq!(report2.unreachable, 0);
}

#[test]
fn test_pack_create_verify() {
    let (_tmp, repo) = setup_repo();
    commit_file(&repo, "a.txt", "a");
    commit_file(&repo, "b.txt", "b");
    let (path, count, orig, packed) = itehaas_lib::pack::create_pack(&repo).unwrap();
    assert!(count >= 3);
    assert!(path.exists());
    assert!(packed > 0);
    let verified = itehaas_lib::pack::verify_pack(&repo, &path).unwrap();
    assert_eq!(verified, count);
    // gc after pack should still keep reachable
    let unreachable = itehaas_lib::gc::gc(&repo, false).unwrap();
    assert_eq!(unreachable, 0);
}

#[test]
fn test_count_objects() {
    let (_tmp, repo) = setup_repo();
    commit_file(&repo, "a.txt", "a");
    let count = itehaas_lib::fsck::count_objects(&repo).unwrap();
    assert!(count >= 3);
    let packs = itehaas_lib::pack::list_packs(&repo).unwrap();
    assert_eq!(packs.len(), 0);
}
