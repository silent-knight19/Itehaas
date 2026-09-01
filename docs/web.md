# Itehaas — Web Platform (Phase 7)

> Next.js 14 App Router + Tailwind, reads VCS via Fastify API.

## Stack

- `web/package.json:1` `next@14.2.5` `react@18.3.1` `tailwindcss@3.4.4` `react-markdown@9` `remark-gfm`.
- `web/tailwind.config.ts:1` content `app/**/*`, `components/**/*`, brand 500 `#6d28d9`.
- `web/app/layout.tsx:1` header `Itehaas` + nav Dashboard/Login/Register, footer.
- `web/lib/api.ts:1` `API_URL` `http://localhost:3001`, `fetch` `credentials: include`, wrappers `health/me/register/login/listRepos/getRepo/listBranches/log/tree`.

## Pages

- `web/app/page.tsx:1` Dashboard (client): `Api.me()` + `Api.listRepos()`, create repo form `POST /api/repos`, list `owner/name` with visibility badge, links to `/${owner}/${repo}`.
- `web/app/login/page.tsx:1` + `web/app/register/page.tsx:1` forms `Api.login/register`, router push `/` on success.
- `web/app/[owner]/[repo]/page.tsx:1` Code browser: `Api.getRepo/branches/log/tree`, parses commit `tree <hash>` via `parseTreeHash`, lists entries `mode hash name`, `view` blob via `Api.tree`, README `readme.md` rendered via `react-markdown + remarkGfm`, tabs Code/Issues/Pulls, stars `POST/DELETE /star` + count, settings `PATCH /api/repos/:owner/:repo` visibility.
- `web/app/[owner]/[repo]/issues/page.tsx:1` Issues list/create, comments `GET/POST /issues/:id/comments`.
- `web/app/[owner]/[repo]/pulls/page.tsx:1` PR list/create `source→target` branches via `GET /branches`, `POST /pulls`, `GET /pulls/:id/diff` via `execItehaas diff`, `POST /pulls/:id/merge` via `execItehaas merge`.
- `web/app/[owner]/[repo]/ci/page.tsx:1` CI pipelines list `GET /ci/pipelines`, trigger `POST /ci/run`, view jobs/logs `GET /ci/pipelines/:id`.

## Data Flow

```
Browser → Next.js (3000) → fetch → Fastify (3001) → pg (metadata) + execItehaas (CAS)
```

Never duplicates VCS logic; file browser reconstructs tree via `cat-file -p` (`server/src/routes/repos.ts:355`).

## Tests

- `pnpm --filter web build` passes (6 routes, see web build log). Vitest for components deferred (Phase 7 DoD requires UI integration; manual verify via `pnpm dev` + curl).

## Running

```bash
pnpm install
pnpm --filter server dev # 3001
pnpm --filter web dev    # 3000
# or docker compose up (db + server + web)
```
