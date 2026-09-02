-- Phase 15: Review & Developer Workflow (draft PR, reviewers, approvals, line-comments, labels, milestones)

-- Draft PR: add is_draft to pull_requests
ALTER TABLE pull_requests ADD COLUMN IF NOT EXISTS is_draft BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE pull_requests ADD COLUMN IF NOT EXISTS source_repo_id UUID REFERENCES repositories(id) ON DELETE SET NULL;
-- Already added in 006, but ensure index
CREATE INDEX IF NOT EXISTS idx_pull_requests_source_repo ON pull_requests(source_repo_id);
CREATE INDEX IF NOT EXISTS idx_pull_requests_is_draft ON pull_requests(is_draft);

-- Requested reviewers
CREATE TABLE IF NOT EXISTS pr_requested_reviewers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_id UUID NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pr_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_pr_requested_reviewers_pr ON pr_requested_reviewers(pr_id);
CREATE INDEX IF NOT EXISTS idx_pr_requested_reviewers_user ON pr_requested_reviewers(user_id);

-- Reviews (approvals / changes_requested / commented)
CREATE TABLE IF NOT EXISTS pr_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_id UUID NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  decision VARCHAR(20) NOT NULL CHECK (decision IN ('approved','changes_requested','commented')),
  body TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pr_reviews_pr ON pr_reviews(pr_id);
CREATE INDEX IF NOT EXISTS idx_pr_reviews_reviewer ON pr_reviews(reviewer_id);

-- Line-level review comments (path/line/side/commit)
CREATE TABLE IF NOT EXISTS pr_review_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_id UUID NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) > 0),
  path TEXT NOT NULL,
  line INTEGER,
  side VARCHAR(10) CHECK (side IN ('LEFT','RIGHT','UNIFIED')),
  commit_hash VARCHAR(64) CHECK (commit_hash ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pr_review_comments_pr ON pr_review_comments(pr_id);
CREATE INDEX IF NOT EXISTS idx_pr_review_comments_path ON pr_review_comments(path);

-- Labels (per repo)
CREATE TABLE IF NOT EXISTS labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  name VARCHAR(50) NOT NULL,
  color VARCHAR(7) NOT NULL DEFAULT '#0969da' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  description TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(repo_id, name)
);
CREATE INDEX IF NOT EXISTS idx_labels_repo ON labels(repo_id);

CREATE TABLE IF NOT EXISTS issue_labels (
  issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  label_id UUID NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (issue_id, label_id)
);
CREATE INDEX IF NOT EXISTS idx_issue_labels_label ON issue_labels(label_id);

-- Milestones (per repo)
CREATE TABLE IF NOT EXISTS milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  title VARCHAR(100) NOT NULL,
  description TEXT DEFAULT '',
  due_date TIMESTAMPTZ,
  status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(repo_id, title)
);
CREATE INDEX IF NOT EXISTS idx_milestones_repo ON milestones(repo_id);
CREATE TRIGGER milestones_updated_at BEFORE UPDATE ON milestones FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE issues ADD COLUMN IF NOT EXISTS milestone_id UUID REFERENCES milestones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_issues_milestone ON issues(milestone_id);

-- Assignees (many-to-many for issues)
CREATE TABLE IF NOT EXISTS issue_assignees (
  issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (issue_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_issue_assignees_user ON issue_assignees(user_id);
