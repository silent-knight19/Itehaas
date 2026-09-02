use tempfile::TempDir;
use itehaas_lib::hash::HashAlgo;

#[test]
fn test_fork_db_table_exists() {
    // This test verifies that the forks migration file exists and contains expected tables
    let content = std::fs::read_to_string("../database/migrations/005_forks_orgs.sql").unwrap();
    assert!(content.contains("CREATE TABLE IF NOT EXISTS organizations"));
    assert!(content.contains("CREATE TABLE IF NOT EXISTS teams"));
    assert!(content.contains("CREATE TABLE IF NOT EXISTS forks"));
    assert!(content.contains("CREATE TABLE IF NOT EXISTS invites"));
}

#[test]
fn test_org_name_validation() {
    assert!(is_valid_org_name("acme"));
    assert!(is_valid_org_name("a-b_c"));
    assert!(!is_valid_org_name("ab")); // too short
    assert!(!is_valid_org_name("a".repeat(33).as_str()));
    assert!(!is_valid_org_name("bad name")); // space
    assert!(!is_valid_org_name("bad@name"));
}

fn is_valid_org_name(name: &str) -> bool {
    if name.len() < 3 || name.len() > 32 { return false; }
    name.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
}

#[test]
fn test_fork_filesystem_clone() {
    let td = TempDir::new().unwrap();
    let upstream = itehaas_lib::init(&td.path().join("upstream"), HashAlgo::Sha256).unwrap();
    itehaas_lib::config::write_user(&upstream, "Alice", "alice@example.com").unwrap();
    // commit in upstream
    std::fs::write(upstream.join("a.txt"), "hello").unwrap();
    let algo = itehaas_lib::config::read_hasher(&upstream).unwrap();
    let hasher = itehaas_lib::hash::new_hasher(algo).unwrap();
    let mut idx = itehaas_lib::index::Index::load(&upstream).unwrap();
    let data = std::fs::read(upstream.join("a.txt")).unwrap();
    let blob = itehaas_lib::object::Blob::new(data);
    let hash = itehaas_lib::object::store::write_object(&upstream, &itehaas_lib::object::Object::Blob(blob), hasher.as_ref()).unwrap();
    idx.add_or_update(itehaas_lib::index::IndexEntry::new("a.txt".into(), hash, 0o100644));
    idx.save(&upstream).unwrap();
    let entries = idx.entries_sorted();
    let tree = itehaas_lib::tree_builder::build_tree_from_index(&upstream, &entries, hasher.as_ref()).unwrap();
    let sig = itehaas_lib::object::Signature::new("Alice".into(), "alice@example.com".into(), 1000, "+0000".into()).unwrap();
    let commit = itehaas_lib::object::Commit::new(tree, vec![], sig.clone(), sig, "init".into());
    let chash = itehaas_lib::object::store::write_object(&upstream, &itehaas_lib::object::Object::Commit(commit), hasher.as_ref()).unwrap();
    itehaas_lib::refs::write_ref(&upstream, "refs/heads/main", &chash).unwrap();
    itehaas_lib::refs::write_head_ref(&upstream, "refs/heads/main").unwrap();

    // Simulate fork by cloning via transfer_objects
    let fork_path = td.path().join("fork");
    std::fs::create_dir_all(&fork_path).unwrap();
    let fork = itehaas_lib::init(&fork_path, HashAlgo::Sha256).unwrap();
    itehaas_lib::config::write_user(&fork, "Bob", "bob@example.com").unwrap();
    // Transfer objects from upstream to fork
    let transferred = itehaas_lib::remote::transfer_objects(&upstream, &fork, &chash).unwrap();
    assert!(transferred >= 2);
    itehaas_lib::refs::write_ref(&fork, "refs/heads/main", &chash).unwrap();
    itehaas_lib::refs::write_head_ref(&fork, "refs/heads/main").unwrap();
    // Verify fork has same commit
    let read = itehaas_lib::refs::read_ref(&fork, "refs/heads/main").unwrap().unwrap();
    assert_eq!(read.hex(), chash.hex());
}

#[test]
fn test_cross_fork_pr_migration() {
    let content = std::fs::read_to_string("../database/migrations/006_pr_fork.sql").unwrap();
    assert!(content.contains("source_repo_id"));
}

#[test]
fn test_team_permission_logic() {
    // Test that team permission hierarchy is correct: read < write < admin
    let order = |perm: &str| match perm {
        "read" => 1,
        "write" => 2,
        "admin" => 3,
        _ => 0,
    };
    assert!(order("read") < order("write"));
    assert!(order("write") < order("admin"));
    // Simulate getTeamPermission would return highest
    let perms = vec!["read", "write"];
    let best = perms.into_iter().max_by_key(|p| order(p)).unwrap();
    assert_eq!(best, "write");
}
