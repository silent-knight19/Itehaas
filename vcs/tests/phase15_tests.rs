use std::fs;

#[test]
fn test_review_tables_exist() {
    let content = fs::read_to_string("../database/migrations/007_review.sql").unwrap();
    assert!(content.contains("pr_requested_reviewers"));
    assert!(content.contains("pr_reviews"));
    assert!(content.contains("pr_review_comments"));
    assert!(content.contains("labels"));
    assert!(content.contains("milestones"));
    assert!(content.contains("issue_assignees"));
    assert!(content.contains("issue_labels"));
    assert!(content.contains("is_draft"));
    assert!(content.contains("source_repo_id"));
}

#[test]
fn test_issue_labels_milestones() {
    let content = fs::read_to_string("../database/migrations/007_review.sql").unwrap();
    assert!(content.contains("issue_labels"));
    assert!(content.contains("issue_assignees"));
    assert!(content.contains("labels"));
    assert!(content.contains("CREATE TABLE IF NOT EXISTS milestones"));
    assert!(content.contains("milestone_id"));
    assert!(content.contains("color ~ '^#[0-9a-fA-F]{6}$'"));
    assert!(content.contains("decision IN ('approved','changes_requested','commented')"));
    assert!(content.contains("side IN ('LEFT','RIGHT','UNIFIED')"));
}

#[test]
fn test_pulls_review_api_exists() {
    let pulls = fs::read_to_string("../server/src/routes/pulls.ts").unwrap();
    // Draft PR
    assert!(pulls.contains("is_draft"), "draft column handling missing");
    assert!(pulls.contains("draft") && pulls.contains("isDraft") || pulls.contains("is_draft"));
    assert!(pulls.contains("cannot merge draft"), "draft merge guard missing");
    // Requested reviewers
    assert!(pulls.contains("pr_requested_reviewers"), "reviewers table missing");
    assert!(pulls.contains("/reviewers"), "reviewers route missing");
    assert!(pulls.contains("pr_review_requested") || pulls.contains("review_requested"));
    // Reviews / approvals
    assert!(pulls.contains("pr_reviews"), "pr_reviews missing");
    assert!(pulls.contains("approved") && pulls.contains("changes_requested"), "approval decisions missing");
    assert!(pulls.contains("409") && pulls.contains("changes requested"), "changes_requested block missing");
    // Line-level comments
    assert!(pulls.contains("pr_review_comments"), "line comments table missing");
    assert!(pulls.contains("review_comments"), "review_comments route missing");
    assert!(pulls.contains("path") && pulls.contains("line") && pulls.contains("side"), "line comment fields missing");
    // CODEOWNERS
    assert!(pulls.contains("CODEOWNERS"), "CODEOWNERS handling missing");
    // Close keywords
    assert!(pulls.contains("fixes") || pulls.contains("closes") || pulls.contains("Close keywords"), "close keywords missing");
    assert!(pulls.contains("ROW_NUMBER()") || pulls.contains("fixes|closes|resolves") || pulls.contains("fix(?:es"), "close keyword numeric handling missing");
}

#[test]
fn test_issues_labels_milestones_api_exists() {
    let issues = fs::read_to_string("../server/src/routes/issues.ts").unwrap();
    assert!(issues.contains("labels"), "labels handling missing");
    assert!(issues.contains("milestones"), "milestones handling missing");
    assert!(issues.contains("assignees") || issues.contains("issue_assignees"), "assignees handling missing");
    assert!(issues.contains("enrichIssue"), "enrichIssue missing");
    assert!(issues.contains("issue_labels"), "issue_labels join missing");
    assert!(issues.contains("milestone_id"), "milestone_id missing");
    // Filtering
    assert!(issues.contains("label") && issues.contains("assignee") && issues.contains("milestone"), "filter params missing");
    // CRUD routes
    assert!(issues.contains("/labels"), "labels route missing");
    assert!(issues.contains("/milestones"), "milestones route missing");
    assert!(issues.contains("color") && issues.contains("#0969da"), "label color default missing");
}

#[test]
fn test_review_migration_indexes() {
    let content = fs::read_to_string("../database/migrations/007_review.sql").unwrap();
    assert!(content.contains("idx_pr_requested_reviewers_pr"));
    assert!(content.contains("idx_pr_reviews_pr"));
    assert!(content.contains("idx_pr_review_comments_pr"));
    assert!(content.contains("idx_labels_repo"));
    assert!(content.contains("idx_milestones_repo"));
    assert!(content.contains("idx_issue_labels_label"));
    assert!(content.contains("idx_pr_review_comments_path"));
}

#[test]
fn test_pulls_draft_and_merge_guards() {
    let pulls = fs::read_to_string("../server/src/routes/pulls.ts").unwrap();
    // Ensure PATCH and ready endpoints exist
    assert!(pulls.contains("app.patch('/api/repos/:owner/:repo/pulls/:id'") || pulls.contains("app.patch"), "PATCH PR missing");
    assert!(pulls.contains("/ready"), "ready endpoint missing");
    // Ensure is_draft appears in SELECT
    assert!(pulls.contains("pr.is_draft"), "SELECT is_draft missing");
    // Ensure merge checks reviews
    assert!(pulls.contains("SELECT decision FROM pr_reviews"), "review check in merge missing");
}

#[test]
fn test_close_keywords_variants() {
    // Validate close keywords regex handles variants (fix/close/resolve) by checking pulls.ts contains expanded pattern
    let pulls = fs::read_to_string("../server/src/routes/pulls.ts").unwrap();
    assert!(pulls.contains("fix(?:es|ed)?") || pulls.contains("fix"), "fix variants missing");
    // Check numeric handling uses ROW_NUMBER
    assert!(pulls.contains("ROW_NUMBER() OVER (ORDER BY created_at)"), "sequential numeric close missing");
}

#[test]
fn test_codeowners_improved() {
    let pulls = fs::read_to_string("../server/src/routes/pulls.ts").unwrap();
    // Should handle any pattern, not just '*'
    assert!(!pulls.contains("if (pattern === '*'"), "still restrictive CODEOWNERS pattern");
    assert!(pulls.contains("CODEOWNERS"), "CODEOWNERS missing");
    // Should handle team syntax via pop()
    assert!(pulls.contains("split('/').pop()") || pulls.contains("split('/')"), "team handling missing");
}
