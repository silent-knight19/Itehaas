-- Phase Profile: user bio + indexes for profile queries
-- Extend users with bio and avatar_url (nullable, bio max 160 via CHECK)
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT '' CHECK (char_length(bio) <= 160);
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT NULL;

-- Indexes for profile metrics / filtering
CREATE INDEX IF NOT EXISTS idx_repositories_owner_updated ON repositories(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_user_created ON activity(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stars_user_created ON stars(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_repositories_stars_count ON stars(repo_id);
