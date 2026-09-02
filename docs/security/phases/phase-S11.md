# Security Phase S11 — XSS, Markdown Sanitization, & Content Security Policy

**Status:** ✅ Complete  
**Date:** 2026-09-02  
**Owner:** Principal Security Engineer  
**Scope:** Content Security Policy (CSP) enforcement, anti-framing and clickjacking defenses, MIME sniffing prevention, Markdown parsing sanitization (`rehype-sanitize`), dangerous URI scheme filtering (`javascript:`, `data:`, `vbscript:`), and safe structured file rendering.

---

## 1. Objective

Neutralize cross-site scripting (XSS) vectors across markdown viewers, user profile inputs, repository file views, and API response headers.

---

## 2. Threat Analysis & Defensive Matrix

| Threat | Attack Path | Previous State | Implemented Control (S11) |
|---|---|---|---|
| **Stored XSS via Dangerous URI Schemes** | An attacker injects `javascript:alert(1)`, `data:text/html;base64,...`, or `vbscript:` into avatar URLs, profile links, or markdown links. When a user clicks or loads the image/link, arbitrary JavaScript executes in their authenticated session. | Basic input fields without scheme verification. | Enforced strict URI scheme validation in `users.ts:107-131`: avatar URLs strictly require `https://`, actively rejecting `javascript:`, `data:`, and `vbscript:`. In `MarkdownViewer.tsx:43-53`, links with dangerous URI schemes are replaced with inert `<span>` elements. |
| **Raw HTML Injection & Script Execution in Markdown** | Markdown viewers render READMEs, issues, and PR comments. If raw HTML tags (`<script>`, `<iframe>`, `<svg onload=...>`, `<math>`) are parsed into the DOM, stored XSS compromises the viewer. | `dangerouslySetInnerHTML` risk in React components. | Zero `dangerouslySetInnerHTML` instances across the codebase. Verified `web/components/MarkdownViewer.tsx` parses markdown strictly through `rehype-sanitize` with `defaultSchema`, stripping all dangerous tags and event handlers. |
| **Clickjacking & Framing Attacks** | Attacker embeds the Itehaas web UI inside a malicious iframe (`<iframe src="https://itehaas...">`) to trick users into executing state-changing actions. | Missing explicit frame restriction headers. | Fastify helmet configured in `server/src/index.ts:38-57` sends `X-Frame-Options: DENY` and CSP directive `frame-ancestors 'none'`, prohibiting any frame embedding. |
| **MIME Sniffing & Stored XSS via File Serving** | An attacker commits an HTML file disguised as a text file. If served raw with guessed MIME types, browsers execute the embedded JavaScript. | Raw files served directly could trigger browser HTML rendering. | Repository file endpoint (`GET /api/repos/:owner/:repo/file/*`) returns structured JSON (`{ path, ref, commit, content, isBinary, size }`). `X-Content-Type-Options: nosniff` header is strictly sent on all responses. |
| **Content Security Policy (CSP) Directives** | Malicious scripts attempt inline execution, loading external untrusted bundles, or injecting `<base>` tags. | Default Fastify headers. | Configured strict CSP in `server/src/index.ts:38-50`: `defaultSrc: ["'self'"]`, `scriptSrc: ["'self'"]`, `objectSrc: ["'none'"]`, `frameAncestors: ["'none'"]`, `baseUri: ["'self'"]`. |

---

## 3. Files Modified

1. `server/src/routes/s11-xss.test.ts`: Created regression test suite verifying CSP directives, dangerous URI scheme rejections, MarkdownViewer sanitization, and safe file serving architecture.
2. Verified `server/src/index.ts`: Fastify Helmet CSP and defensive header configurations.
3. Verified `server/src/routes/users.ts`: `avatar_url` scheme validation.
4. Verified `web/components/MarkdownViewer.tsx`: `rehypeSanitize` and protocol stripping.

---

## 4. Verification & Regression Tests

- **XSS & Content Security Test Suite (`server/src/routes/s11-xss.test.ts` & `s10-xss.test.ts`):** 16/16 tests passing:
  - `sends strict CSP directives and defensive framing headers on API responses`.
  - `rejects dangerous URI scheme: javascript:alert(1) in user profile`.
  - `rejects dangerous URI scheme: JAVASCRIPT:alert(document.cookie) in user profile`.
  - `rejects dangerous URI scheme: javascript:confirm(1) in user profile`.
  - `rejects dangerous URI scheme: data:text/html;base64,... in user profile`.
  - `rejects dangerous URI scheme: vbscript:msgbox(1) in user profile`.
  - `rejects dangerous URI scheme: data:image/svg+xml;utf8,<svg onload=... in user profile`.
  - `MarkdownViewer component does not use dangerouslySetInnerHTML anywhere`.
  - `MarkdownViewer configures rehype-sanitize and custom anchor protocol filter`.
  - `file serving route returns structured JSON preventing direct browser HTML execution`.
  - `S10-02 avatar_url javascript: → 400`.
  - `S10-02 avatar_url data: → 400`.
  - `S10-02 avatar_url https:// allowed → 200`.
  - `S10-04 no dangerouslySetInnerHTML in web`.
  - `S10-01 MarkdownViewer uses rehypeSanitize`.
- **Full Project Regression Test Suites:**
  - `pnpm --filter server test`: 24 test files, 208/208 tests green.
  - `cargo test`: 124/124 tests green.

---

## 5. Acceptance Criteria Checklist

- [x] Strict CSP headers enforced (`default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`)
- [x] Anti-clickjacking (`X-Frame-Options: DENY`, `frame-ancestors 'none'`) verified
- [x] Anti-MIME sniffing (`X-Content-Type-Options: nosniff`) verified
- [x] Dangerous URI schemes (`javascript:`, `data:`, `vbscript:`) rejected across APIs and viewers
- [x] Zero `dangerouslySetInnerHTML` in frontend codebase
- [x] Markdown parsed through `rehype-sanitize` with `defaultSchema`
- [x] Safe structured file serving verified
- [x] `PLAN.md` updated

---

## 6. Next Phase Gate

- **Active Phase Status:** S11 COMPLETE.
- **Next Phase:** `SECURITY PHASE S12 — CSRF, CORS, & DEFENSIVE TRANSPORT HEADERS`
- **Scope:** Cookie-tossing session hijacking mitigation ([SEC-004](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-004--cross-subdomain-cookie-tossing-and-session-fixation)), wildcard origin reflection CORS restriction ([SEC-003](file:///Users/sachinkumarsingh/Projectss/Itehaas/docs/security/vulnerability-register.md#sec-003--development-cors-wildcard-origin-reflection)), strict HMAC double-submit CSRF tokens, strict origin verification.
