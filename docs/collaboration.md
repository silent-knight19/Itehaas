# Itehaas — Collaboration (Phase 8)

> Issues, PRs, stars, notifications, activity on top of VCS merge.

## Schema (`database/migrations/002_collaboration.sql:1`)

- `issues(id, repo_id, author_id, title, body, status open|closed, created_at)` + `issue_comments`.
- `pull_requests(id, repo_id, author_id, title, body, source_branch, target_branch, status open|merged|closed)` + `pr_comments`.
- `stars(user_id, repo_id PK)` + `notifications(id, user_id, type, payload JSONB, is_read)` + `activity(id, repo_id, user_id, action, payload)`.

## API (`server/src/routes/issues.ts:1`, `pulls.ts:1`, `stars.ts:1`)

- `GET/POST /api/repos/:owner/:repo/issues` + `GET/PATCH /issues/:id` + `GET/POST /issues/:id/comments` — `canRead` for list, author or `canWrite` for patch.
- `GET/POST /api/repos/:owner/:repo/pulls` + `GET /pulls/:id` + `GET /pulls/:id/diff` (`execItehaas diff <source>` `server/src/routes/pulls.ts:55`) + `POST /pulls/:id/merge` (`execItehaas checkout target; execItehaas merge source` `server/src/routes/pulls.ts:85` uses `vcs/src/merge.rs:400` 3-way) + `GET/POST /pulls/:id/comments`.
- `POST/DELETE /api/repos/:owner/:repo/star` + `GET /stars` (`server/src/routes/stars.ts:8`), `GET /notifications` + `POST /notifications/:id/read`, `GET /activity/:owner/:repo`.

## Permissions

- Issues/PRs: `canRead` for view, `canWrite` for merge/close (see `server/src/lib/permissions.ts:11`).
- Stars: any `canRead` can star.
- Webhooks/Releases deferred.

## Web

- `web/app/[owner]/[repo]/issues/page.tsx:1` lists issues, create, comments.
- `web/app/[owner]/[repo]/pulls/page.tsx:1` lists PRs, create with branch selects via `GET /branches`, diff view, merge button.
- `web/app/[owner]/[repo]/page.tsx:1` star toggle + tabs Code/Issues/Pulls.

## Verification

- Create issue via `POST /issues` → `GET /issues` shows → `POST /issues/:id/comments` → activity inserted.
- Create PR `feature→main` → `GET /pulls/:id/diff` shows unified diff via `similar`, `POST /merge` creates merge commit (2 parents) or 409 conflict.
