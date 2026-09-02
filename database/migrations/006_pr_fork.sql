-- Phase 14: Cross-fork PR support
ALTER TABLE pull_requests ADD COLUMN IF NOT EXISTS source_repo_id UUID REFERENCES repositories(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_pull_requests_source_repo ON pull_requests(source_repo_id);
