-- Phase 14: Forks, Organizations, Teams, Invites
-- Keep single-laptop first, no K8s, just Postgres metadata. VCS objects remain filesystem.

-- Organizations
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(32) NOT NULL UNIQUE CHECK (name ~ '^[a-zA-Z0-9._-]{3,32}$'),
  display_name VARCHAR(100) DEFAULT '',
  description TEXT DEFAULT '',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER organizations_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS organization_members (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(10) NOT NULL CHECK (role IN ('owner','admin','member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org ON organization_members(org_id);

-- Teams (within org)
CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL CHECK (name ~ '^[a-zA-Z0-9._-]{1,100}$'),
  description TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, name)
);
CREATE TRIGGER teams_updated_at BEFORE UPDATE ON teams FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS team_members (
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);

CREATE TABLE IF NOT EXISTS team_repositories (
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  repo_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  permission VARCHAR(10) NOT NULL CHECK (permission IN ('read','write','admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, repo_id)
);
CREATE INDEX IF NOT EXISTS idx_team_repos_repo ON team_repositories(repo_id);

-- Forks
CREATE TABLE IF NOT EXISTS forks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upstream_repo_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  fork_repo_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE UNIQUE,
  forked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_forks_upstream ON forks(upstream_repo_id);
CREATE INDEX IF NOT EXISTS idx_forks_fork ON forks(fork_repo_id);

-- Invites (org, team, repo) — unified
CREATE TABLE IF NOT EXISTS invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  repo_id UUID REFERENCES repositories(id) ON DELETE CASCADE,
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  invited_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  email VARCHAR(255),
  role VARCHAR(10) NOT NULL CHECK (role IN ('owner','admin','member','read','write')),
  token VARCHAR(64) NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','expired')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT invites_target_check CHECK (
    (org_id IS NOT NULL)::int + (team_id IS NOT NULL)::int + (repo_id IS NOT NULL)::int = 1
  ),
  CONSTRAINT invites_invitee_check CHECK (invited_user_id IS NOT NULL OR email IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_invites_token ON invites(token);
CREATE INDEX IF NOT EXISTS idx_invites_user ON invites(invited_user_id);
CREATE INDEX IF NOT EXISTS idx_invites_org ON invites(org_id);
CREATE INDEX IF NOT EXISTS idx_invites_team ON invites(team_id);
CREATE INDEX IF NOT EXISTS idx_invites_repo ON invites(repo_id);
