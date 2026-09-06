use std::fs;
use std::path::Path;
use tempfile::TempDir;

fn run_itehaas(cwd: &Path, args: &[&str]) -> (i32, String, String) {
    let bin = Path::new(env!("CARGO_MANIFEST_DIR")).join("../target/debug/itehaas");
    let output = std::process::Command::new(bin)
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("spawn itehaas");
    let code = output.status.code().unwrap_or(1);
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    (code, stdout, stderr)
}

fn seed_two_branch_repo() -> (TempDir, std::path::PathBuf) {
    let tmp = TempDir::new().unwrap();
    let repo = tmp.path().join("repo");
    fs::create_dir_all(&repo).unwrap();
    let (code, _, _) = run_itehaas(tmp.path(), &["init", repo.to_str().unwrap()]);
    assert_eq!(code, 0);
    run_itehaas(&repo, &["config", "user.name", "Test"]);
    run_itehaas(&repo, &["config", "user.email", "test@example.com"]);
    fs::write(repo.join("a.txt"), "one").unwrap();
    assert_eq!(run_itehaas(&repo, &["add", "a.txt"]).0, 0);
    assert_eq!(run_itehaas(&repo, &["commit", "-m", "one"]).0, 0);
    assert_eq!(run_itehaas(&repo, &["branch", "feat"]).0, 0);
    assert_eq!(run_itehaas(&repo, &["checkout", "feat"]).0, 0);
    fs::write(repo.join("b.txt"), "two").unwrap();
    assert_eq!(run_itehaas(&repo, &["add", "b.txt"]).0, 0);
    assert_eq!(run_itehaas(&repo, &["commit", "-m", "two"]).0, 0);
    (tmp, repo)
}

#[test]
fn test_log_rev_reads_branch_without_touching_head() {
    let (_tmp, repo) = seed_two_branch_repo();
    let head_before = fs::read_to_string(repo.join(".itehaas/HEAD")).unwrap();
    assert!(head_before.contains("feat"));

    let (code, out, _) = run_itehaas(&repo, &["log", "--oneline", "--rev", "main"]);
    assert_eq!(code, 0);
    assert_eq!(out.lines().count(), 1, "main must show exactly its own commit");

    let (code, out, _) = run_itehaas(&repo, &["log", "--oneline", "--rev", "feat"]);
    assert_eq!(code, 0);
    assert_eq!(out.lines().count(), 2, "feat must show both commits");

    // HEAD must be byte-identical: reads never mutate repository state (FSEC-006).
    let head_after = fs::read_to_string(repo.join(".itehaas/HEAD")).unwrap();
    assert_eq!(head_before, head_after);
}

#[test]
fn test_log_rev_traversal_rejected() {
    let (_tmp, repo) = seed_two_branch_repo();
    for rev in ["../config", "..", "../../etc/passwd", "refs/heads/../../config"] {
        let (code, _, stderr) = run_itehaas(&repo, &["log", "--oneline", "--rev", rev]);
        assert_ne!(code, 0, "rev {:?} must fail, not walk", rev);
        assert!(
            stderr.contains("traversal") || stderr.contains("invalid"),
            "rev {:?} must report traversal, got: {}",
            rev,
            stderr
        );
    }
    // Unknown (non-traversal) revs stay silent-empty for API fallback semantics.
    let (code, out, _) = run_itehaas(&repo, &["log", "--oneline", "--rev", "nosuchbranch"]);
    assert_eq!(code, 0);
    assert!(out.trim().is_empty());
}

#[test]
fn test_resolve_rev_rejects_traversal_at_lib_level() {
    let tmp = TempDir::new().unwrap();
    let repo = tmp.path().join("repo3");
    fs::create_dir_all(&repo).unwrap();
    itehaas_lib::init(&repo, itehaas_lib::hash::HashAlgo::Sha256).unwrap();
    for rev in ["..", "../config", "/abs", "a\\b", "HEAD~x/../../y"] {
        let res = itehaas_lib::refs::resolve_rev(&repo, rev);
        assert!(res.is_err(), "rev {:?} must be Err, got {:?}", rev, res);
    }
}
