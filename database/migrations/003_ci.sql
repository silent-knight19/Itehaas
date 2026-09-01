-- Phase 9: CI/CD — job queue (in-memory + Postgres, Redis deferred)

CREATE TABLE ci_pipelines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  ref VARCHAR(200) NOT NULL,
  commit_hash VARCHAR(64) NOT NULL CHECK (commit_hash ~ '^[0-9a-f]{64}$'),
  status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','success','failed','canceled')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ci_pipelines_repo ON ci_pipelines(repo_id);
CREATE INDEX idx_ci_pipelines_status ON ci_pipelines(status);
CREATE TRIGGER ci_pipelines_updated_at BEFORE UPDATE ON ci_pipelines FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE ci_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID NOT NULL REFERENCES ci_pipelines(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','success','failed')),
  logs TEXT DEFAULT '',
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ci_jobs_pipeline ON ci_jobs(pipeline_id);

CREATE TABLE ci_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  key VARCHAR(100) NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(repo_id, key)
);
