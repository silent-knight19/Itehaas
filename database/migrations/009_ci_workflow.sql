-- Phase 17: Real CI/CD — workflow, artifacts, status checks

-- Artifacts per job
CREATE TABLE IF NOT EXISTS ci_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES ci_jobs(id) ON DELETE CASCADE,
  pipeline_id UUID NOT NULL REFERENCES ci_pipelines(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  path VARCHAR(500) NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ci_artifacts_job ON ci_artifacts(job_id);
CREATE INDEX IF NOT EXISTS idx_ci_artifacts_pipeline ON ci_artifacts(pipeline_id);

-- Extend pipelines with workflow info and duration
ALTER TABLE ci_pipelines ADD COLUMN IF NOT EXISTS workflow_file VARCHAR(500);
ALTER TABLE ci_pipelines ADD COLUMN IF NOT EXISTS branch VARCHAR(200);
ALTER TABLE ci_pipelines ADD COLUMN IF NOT EXISTS duration_ms INTEGER;

-- Extend jobs with runner info
ALTER TABLE ci_jobs ADD COLUMN IF NOT EXISTS runner VARCHAR(50) DEFAULT 'docker';
ALTER TABLE ci_jobs ADD COLUMN IF NOT EXISTS exit_code INTEGER;

-- Status checks for PR gating (required checks)
CREATE TABLE IF NOT EXISTS ci_status_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  required BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(repo_id, name)
);
CREATE INDEX IF NOT EXISTS idx_ci_status_checks_repo ON ci_status_checks(repo_id);

-- Add workflow parsing cache (optional, stored as JSONB in pipeline)
ALTER TABLE ci_pipelines ADD COLUMN IF NOT EXISTS workflow_json JSONB;
