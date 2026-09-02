-- Phase 16: Search (pg_trgm) + Watch

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Watches (like stars but for notifications)
CREATE TABLE IF NOT EXISTS watches (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repo_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, repo_id)
);
CREATE INDEX IF NOT EXISTS idx_watches_user ON watches(user_id);
CREATE INDEX IF NOT EXISTS idx_watches_repo ON watches(repo_id);

-- GIN trigram indexes for search (repositories, issues, pull_requests)
CREATE INDEX IF NOT EXISTS idx_repositories_name_trgm ON repositories USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_repositories_desc_trgm ON repositories USING gin (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_issues_title_trgm ON issues USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_issues_body_trgm ON issues USING gin (body gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_pull_requests_title_trgm ON pull_requests USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_users_username_trgm ON users USING gin (username gin_trgm_ops);

-- Notifications already exists; ensure index for inbox
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read, created_at DESC);
