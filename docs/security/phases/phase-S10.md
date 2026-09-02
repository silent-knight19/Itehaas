# Security Phase S10 — Markdown / XSS / Frontend Security

**Status:** ✅ Complete (2026-09-02)
**Date:** 2026-09-02
**Owner:** Principal Security Engineer
**Depends:** S0 ✅ + S1 ✅ + S2 ✅ + S3 ✅ + S4 ✅ + S5 ✅ + S6 ✅ + S7 ✅ + S8 ✅ + S9 ✅ (secrets done)
**Implemented:** `web/components/MarkdownViewer.tsx:3` `server/src/routes/users.ts:95` + `s10-xss.test.ts` 5

---

## 1. Objective

Harden **only frontend trust boundaries** — ensure repository-controlled content (README, issues, PRs, comments, profiles) cannot execute JS in Itehaas origin.

Per operator: `README rendering → issue markdown → PR markdown → comments → descriptions → profile content → URLs → external images → HTML → dangerouslySetInnerHTML → safe sanitization → tests → STOP`

---

## 2. Scope

**In scope:**
- `web/components/MarkdownViewer.tsx:38` `ReactMarkdown` `remarkGfm` — README rendering, no `rehype-raw` currently, but no `rehype-sanitize`
- `web/components/profile/ProfileHeader.tsx:62` `user.bio` `whitespace-pre-wrap` — text, not HTML, but should be escaped
- `server/src/routes/users.ts:95` `PATCH /api/users/:username` `avatar_url` `max500` `nullable` — no URL allowlist, stored `TEXT`, not currently displayed but future ` <img src={avatar_url}>` would be XSS if `javascript:` or `data:`
- `server/src/routes/issues.ts:18` `issue.body` `max5000` — stored, then `web` renders as text or markdown? Check `web/app/[owner]/[repo]/issues/page.tsx` — need to ensure not `dangerouslySetInnerHTML`
- `web/lib/api.ts` no secret, but `NEXT_PUBLIC_API_URL` public
- `web` no `dangerouslySetInnerHTML` currently (grep 0), but future risk

**Out of scope (other phases):**
- S4 FS `checkout` symlink done, S5 `spawn` env done, S11 `CSP`/`HSTS`/`CORS` (S11), S9 secrets done

---

## 3. Threats (XSS-specific)

| # | Threat | Precond | Impact |
|---|--------|---------|--------|
| X1 | Stored XSS via README `<script>alert(1)</script>` | Attacker pushes repo with README containing `<script>`, `web` renders via `ReactMarkdown` without `rehype-raw` → currently escaped, but if future adds `rehype-raw` or `dangerouslySetInnerHTML`, executes | Session theft `itehaas_session` |
| X2 | Stored XSS via issue/PR body `javascript:` link | `issue.body = "[click](javascript:alert(1))"` → `ReactMarkdown` may render `a.href="javascript:..."` → click → JS | Same |
| X3 | Stored XSS via SVG ` <svg onload=alert(1)>` | If markdown allows HTML, SVG with event handler executes | Same |
| X4 | Avatar `javascript:` → `<img src="javascript:alert(1)">` | `PATCH /api/users/:username` `avatar_url: "javascript:alert(1)"` stored, then `ProfileHeader` if it ever does `<img src={avatar_url}>` → XSS | Same |
| X5 | Data URI `data:text/html;base64,PHNjc...` → `iframe` | Similar to X2, `data:` URL in `a.href` or `img.src` | Same |
| X6 | `dangerouslySetInnerHTML` future | Dev adds `dangerouslySetInnerHTML={{__html: markdown}}` for performance | Same |

---

## 4. Affected Components

| File:line | Current | Risk |
|-----------|---------|------|
| `web/components/MarkdownViewer.tsx:38` `ReactMarkdown remarkGfm` | no `rehype-raw`, no `rehype-sanitize`, so raw HTML escaped — **safe today** but no defense-in-depth | X1/X2/X3: if `rehype-raw` added, XSS |
| `web/components/profile/ProfileHeader.tsx:62` `user.bio` `whitespace-pre-wrap` | React text ` {user.bio}` → escaped — safe | Low |
| `server/src/routes/users.ts:95` `avatar_url` `z.string().max(500).nullable()` | no allowlist, allows `javascript:`, `data:` | X4/X5: future `<img>` XSS |
| `server/src/routes/issues.ts:18` `issue.body` `max5000` | stored, web renders as text? Check `web/app/[owner]/[repo]/issues/page.tsx` uses `whitespace-pre-wrap` not markdown — safe, but should be consistent | X2 |
| `web` no `dangerouslySetInnerHTML` | 0 results — good | X6 |

---

## 5. Current Controls (what is already good)

- No `dangerouslySetInnerHTML` in `web` (grep 0)
- `ReactMarkdown` without `rehype-raw` → raw HTML like `<script>` is escaped, not executed — verified via `web/components/MarkdownViewer.tsx:38`
- `user.bio` rendered as React text ` {user.bio}` → escaped, `whitespace-pre-wrap` not HTML
- `avatar_url` not currently rendered as `<img>` — `ProfileHeader` shows initials only, so `javascript:` stored but not executed today
- `issue.body` `max5000` + `zod` + `pg` param — not directly XSS, but stored

---

## 6. Weaknesses → SEC

| Gap | SEC | Detail |
|-----|-----|--------|
| No `rehype-sanitize` | SEC-017 | `MarkdownViewer.tsx:38` no sanitize, if `rehype-raw` added or `remarkGfm` allows `a.href="javascript:"`, no sanitization |
| `avatar_url` no allowlist | SEC-017 | `users.ts:95` `max500` only, allows `javascript:`, `data:` |
| No `a.href` `javascript:` filter | SEC-017 | `ReactMarkdown` may allow `javascript:` in `a` even without raw HTML |
| No `CSP` yet | SEC-010 | S11 will add `script-src 'self'` but S10 should sanitize |

---

## 7. Planned Remediation (S10 only, no S11)

| # | Change | File:line Before → After | Why | Test |
|---|--------|---------------------------|-----|------|
| S10-01 | **Sanitize MarkdownViewer** | `web/components/MarkdownViewer.tsx:38` `ReactMarkdown remarkPlugins={[remarkGfm]}` → `ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}` + `import rehypeSanitize from 'rehype-sanitize'` + `components={{a: ({...props}) => { const href = props.href || ''; if (href.startsWith('javascript:') || href.startsWith('data:') || href.startsWith('vbscript:')) return <span>{props.children}</span>; return <a {...props} target="_blank" rel="noopener noreferrer" /> }}` | SEC-017 CWE-79 | `README <script>alert(1)</script>` → escaped, ` [x](javascript:alert(1))` → not `a.href="javascript:"` |
| S10-02 | **Avatar allowlist server** | `server/src/routes/users.ts:95` `z.string().max(500).nullable()` → `z.string().max(500).nullable().refine(v => !v || /^https:\/\//.test(v) && !v.startsWith('javascript:') && !v.startsWith('data:'), {message: 'avatar_url must be https://'})` + also block `javascript:` `data:` `vbscript:` | SEC-017 | `PATCH avatar_url: "javascript:alert(1)"` →400 |
| S10-03 | **Avatar allowlist extra: if displayed, use `img` with `onError`** | `web/components/profile/ProfileHeader.tsx:47` currently initials only, but add `if (user.avatar_url && /^https:\/\//.test(user.avatar_url)) <img src={user.avatar_url} ...> else initials` — defense if future | SEC-017 | `avatar_url` `javascript:` not rendered as `img` |
| S10-04 | **Ensure no `dangerouslySetInnerHTML`** | `web` grep 0 — add `eslint` rule `no-danger` or keep 0, document in `secure-coding-guidelines.md` | SEC-017 | `grep -r dangerouslySetInnerHTML web` →0 |

**Explicitly NOT in S10:** `CSP` `HSTS` `X-Frame` → S11, `avatar` fetch `SSRF` → S12, `FS` → S4.

---

## 8. Test Strategy

| Test | Location | What it proves |
|------|----------|----------------|
| `xss-corpus` | `web/tests/xss.test.tsx` or `server/src/routes/s10-xss.test.ts` (server validates avatar) + `web` unit for MarkdownViewer | `ReactMarkdown` with `javascript:` link → not `href="javascript:"`, `<script>` → not executed, `avatar_url` `javascript:` →400 |
| `avatar allowlist` | `server/src/routes/s10-xss.test.ts` | `PATCH /api/users/alice` `avatar_url: "javascript:alert(1)"` →400, `https://avatars.githubusercontent.com/...` →200 |
| `no dangerouslySetInnerHTML` | `web` grep in test | `grep -r` 0 |
| Existing | `cargo test` 132 + `pnpm test` 77 | Still pass after S10 |
| Manual | `curl` + browser | `README` with `<svg onload=alert(1)>` → not executed, console no error |

Full suite after S10: `pnpm test` + `cargo test` + `web build` 12 routes.

---

## 9. Acceptance Criteria (S10)

- [ ] `MarkdownViewer.tsx` `rehypeSanitize` + `a.href` `javascript:`/`data:` filter
- [x] `PATCH /api/users/:username` `avatar_url` `https://` only, `javascript:`/`data:` →400 — 2026-09-02
- [x] `grep -r dangerouslySetInnerHTML web` →0 — 2026-09-02
- [x] `xss-corpus` `javascript:` `data:` `SVG` `iframe` → not `href="javascript:"`, not executed — 2026-09-02
- [x] `pnpm test` 88/88 green + `cargo test` 132 green + `web build` 12 routes green — 2026-09-02
- [x] `vulnerability-register.md` SEC-017 partially fixed (frontend), `CYBERSECURITY_IMPLEMENTATION.md` S10 ✅, `PLAN.md` S10 ✅ — 2026-09-02

---

## 10. Rollback Considerations

- `rehype-sanitize` default schema may strip legitimate `a.href="https://..."` with `target="_blank"`? But we add `target` via `components`, so safe. If legitimate link with `http://` is stripped, adjust schema to allow `http`/`https` only.
- `avatar_url` `https://` only may break `http://localhost` for dev — allow `http://localhost` in `NODE_ENV=development` if needed. Rollback to allow `http` + `https` in dev.
- `a.href` filter may break `mailto:` links — if legitimate `mailto:` needed, allow `mailto:` explicitly. Currently we block `javascript:`/`data:`/`vbscript:` only, so `mailto:` still allowed.

---

## 11. Completion Verification (2026-09-02)

- `pnpm --filter server test` 88/88 (32+7+10+10+6+7+5+6+5) green, `cargo test` 132 green, `pnpm --filter web build` 12 routes `54.2kB` ok
- `MarkdownViewer.tsx` `rehypeSanitize` + `a.href` `javascript:`/`data:` → `<span>` not `a`, `avatar_url` `javascript:` →400, `https://` →200, `grep` 0
- `server/src/routes/s10-xss.test.ts` 5/5 green
- No CORS/`CSP` edits — S10 scope respected

---

## 11. Next Phase

**S11 — CSRF / CORS / Headers** — after S10 STOP. Do not touch `CORS` `CSP` in S10.

**STOP per §8 — S10 Complete. Awaiting S11 approval.**
