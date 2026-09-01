# Itehaas — Database Specification (Phase 6)

> PostgreSQL 16, metadata only. VCS objects remain on filesystem `.itehaas/objects` (`docs/storage.md`).

## Migrations

- Dir: `database/migrations/` sorted lexicographically `001_*.sql`.
- Runner: `server/src/db/migrate.ts:10` resolves `database/migrations` from `src` or `dist`, creates `_migrations(name PK)` tracking table, runs each file in `BEGIN` → SQL → `INSERT INTO _migrations` → `COMMIT` (skip if already applied).
- Command: `pnpm --filter server migrate` (`server/package.json:11`), `DATABASE_URL` default `postgres://itehaas:itehaas@localhost:5432/itehaas` (`server/src/config.ts:8`). Docker: `docker compose up -d db` (`docker-compose.yml:5`).

## Schema (`database/migrations/001_init.sql:1`)

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid()
```

### users (`001_init.sql:6`)

| col | type | constraint |
|-----|------|------------|
| id | UUID PK DEFAULT gen_random_uuid() | |
| username | VARCHAR(32) UNIQUE | CHECK `~ '^[a-zA-Z0-9._-]{3,32}$'` |
| email | VARCHAR(255) UNIQUE | |
| password_hash | TEXT | Argon2id (`server/src/lib/auth.ts:4`) |
| created_at | TIMESTAMPTZ DEFAULT now() | |
| updated_at | TIMESTAMPTZ DEFAULT now() | trigger `set_updated_at()` |

Validated in API `zod` + `validateUsername` (`server/src/lib/auth.ts:12`).

### repositories (`001_init.sql:15`)

| col | type |
|-----|------|
| id | UUID PK gen_random_uuid() |
| owner_id | UUID FK users(id) ON DELETE CASCADE |
| name | VARCHAR(100) CHECK `^[a-zA-Z0-9._-]{1,100}$` |
| description | TEXT DEFAULT '' |
| visibility | VARCHAR(10) CHECK IN ('public','private') DEFAULT 'private' |
| default_branch | VARCHAR(100) DEFAULT 'main' |
| created_at/updated_at | TIMESTAMPTZ |

- `UNIQUE(owner_id, name)` — enforced in API 409 (`server/src/routes/repos.ts:30`).
- Indexes: `idx_repositories_owner(owner_id)`, `idx_repositories_visibility(visibility)`.
- FS side: `REPOS_ROOT/owner/name` created via `repoPathFor` (`server/src/lib/vcs.ts:24`) + `execItehaas init` (`server/src/routes/repos.ts:60`).

### repository_members (`001_init.sql:29`)

| col | type |
|-----|------|
| repo_id | UUID FK repositories(id) CASCADE |
| user_id | UUID FK users(id) CASCADE |
| role | VARCHAR(10) CHECK IN ('read','write','admin') |
| created_at | TIMESTAMPTZ |

- PK `(repo_id, user_id)`.
- Owner inserted as `admin` on creation (`server/src/routes/repos.ts:35`).
- Permission helpers `server/src/lib/permissions.ts:4` (`canRead` public or owner/member, `canWrite` owner or `write|admin`, `isAdmin` owner or `admin`).

### sessions (`001_init.sql:37`)

| col | type |
|-----|------|
| id | UUID PK gen_random_uuid() |
| user_id | UUID FK users(id) CASCADE |
| expires_at | TIMESTAMPTZ |
| created_at | TIMESTAMPTZ |

- Indexes: `idx_sessions_user(user_id)`, `idx_sessions_expires(expires_at)`.
- Created on register/login (`server/src/routes/auth.ts:39,81` `INSERT INTO sessions`), expiry `+30d` (`server/src/lib/auth.ts:35` `newSessionExpiry`), validated `WHERE expires_at > now()` (`server/src/middleware/auth.ts:12`).
- Cookie `itehaas_session` httpOnly `SameSite=Lax` (`server/src/routes/auth.ts:42`), cleared on logout (`server/src/routes/auth.ts:99` `DELETE FROM sessions WHERE id=$1`).
- Cleanup: `DELETE FROM sessions WHERE expires_at < now()` opportunistic (`server/src/middleware/auth.ts:24` `cleanupExpiredSessions` called on auth).

### _migrations (runner)

| col | type |
|-----|------|
| name | TEXT PK |
| applied_at | TIMESTAMPTZ DEFAULT now() |

### users — profile extension (`004_profile.sql`)

| col | type | constraint |
|-----|------|------------|
| bio | TEXT DEFAULT '' | CHECK `char_length(bio) <= 160` |
| avatar_url | TEXT DEFAULT NULL | nullable, future upload |

### Indexes — profile (`004_profile.sql`)

- `idx_repositories_owner_updated(owner_id, updated_at DESC)` — owned repos sort
- `idx_activity_user_created(user_id, created_at DESC)` — per-user activity feed
- `idx_stars_user_created(user_id, created_at DESC)` — starred list
- `idx_repositories_stars_count(repo_id)` — stars aggregation

### Triggers (`001_init.sql:46`)

```sql
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER ...
CREATE TRIGGER users_updated_at BEFORE UPDATE ...
CREATE TRIGGER repos_updated_at BEFORE UPDATE ...
```

## Queries (examples)

- List public + member repos: `SELECT ... WHERE visibility='public' OR owner_id=$1 OR EXISTS (SELECT 1 FROM repository_members ...)` (`server/src/routes/repos.ts:80`).
- Get repo: `SELECT r.id... FROM repositories r JOIN users u WHERE u.username=$1 AND r.name=$2` (`server/src/routes/repos.ts:100`).
- Check owner: `SELECT owner_id FROM repositories WHERE id=$1` (`server/src/lib/permissions.ts:4`).
- Member role: `SELECT role FROM repository_members WHERE repo_id=$1 AND user_id=$2` (`server/src/lib/permissions.ts:9`).

## Invariants

- Never store file content/blobs in DB; DB is metadata only (`docs/storage.md:5`).
- All queries parameterized (`pg` `$1` etc.) — no string interpolation (`server/src/routes/*.ts`).
- `REPOS_ROOT` (`server/src/config.ts:12` default `data/repos`) is source of truth for VCS path; DB row and FS `init` must both succeed or DB rolled back (`server/src/routes/repos.ts:35` transaction + FS cleanup).
