# Itehaas — UI Audit

> Date: 2026-09-01
> Scope: `web/` Next.js 14 + Tailwind — all routes, components, tokens, layout.
> Auditor role: Principal Product Designer + Design Engineer
> Method: Full codebase inspection (every page, component, token, motion, state)

---

## 1. Product Summary

Itehaas is a Git-inspired VCS (Rust CAS) + GitHub-like platform (Fastify + Next.js + Postgres). Current web surface:

- **Routes**: `web/app/page.tsx` dashboard, `web/app/[owner]/[repo]/page.tsx` code browser, `web/app/[owner]/[repo]/issues/page.tsx`, `web/app/[owner]/[repo]/pulls/page.tsx`, `web/app/[owner]/[repo]/ci/page.tsx`, `web/app/login/page.tsx`, `web/app/register/page.tsx`, `web/components/*` 9 shared components, `web/lib/api.ts` client.
- **IA**: Workspace → Repository → Code / Issues / Pulls / CI. No global search, no command palette, no secondary repo navigation (branches/commits are sub-tabs inside Code).
- **Data**: Repos, branches, commits (SHA-256), tree/blobs via `cat-file`, issues, PRs with diff/merge, CI pipelines/jobs.

The product is functionally solid (filesystem CAS, real DAG). The visual layer does not match that seriousness.

---

## 2. Overall Verdict

**Current quality bar: AI-generated SaaS template, not a developer tool.**

The shell communicates "indigo SaaS starter" — generic gradients, large rounded cards, repeated `border-white/[0.08] bg-[#11131c]` surfaces, and copy like `Engineering Workspace` + `Distributed VCS & Collaboration` pill. None of this communicates *history, objects, branches, integrity*. It would fail the hallway test: "Was this built by a serious design-engineering team?"

Strengths to preserve: data flow is real (no mocks), SHA-256 invariants are surfaced, component split is sensible (RepoHeader, RepoTabs, FileTree, etc.), API layer is clean.

Everything below is a restraint, hierarchy, and identity problem — fixable without touching backend contracts.

---

## 3. Typography Audit

### 3.1 Font Families
- **UI sans**: `Inter` declared in `web/tailwind.config.ts:35` but never loaded via `next/font` — falls back to system sans. No variable font, no `font-feature-settings` actually applied. `web/app/globals.css:17` sets `cv02/cv03/cv04/cv11` but without Inter loaded they do nothing.
- **Mono**: `JetBrains Mono` declared `web/tailwind.config.ts:45` but also not loaded. Falls back to `ui-monospace`. Commits/hashes/branches do want mono, but currently mono is applied inconsistently (sometimes `font-mono` on repo names, sometimes `font-sans`, sometimes both).
- **Result**: Typography never renders as designed. No `@font-face`, no `next/font/google` import.

### 3.2 Hierarchy
| Role | Current | Problem |
|------|---------|---------|
| Display / Hero | `text-2xl sm:text-3xl font-bold` in dashboard `web/app/page.tsx:130` | Marketing scale in a workspace. Too large, too bold for a developer tool. |
| Page title | `text-lg sm:text-xl` repo name `web/components/RepoHeader.tsx:95` | Mono + sans mixed on same line, weight fights pill. |
| Section title | `text-xs font-semibold uppercase tracking-wider` repeated 12× | Overused — every panel screams equally. |
| Body | `text-sm` vs `text-xs` vs `text-[11px]` vs `text-[10px]` | 4 micro sizes with no token — drift everywhere. |
| Metadata | `text-[11px] font-mono text-zinc-400` commit times, hashes | Correct intent but color contrast insufficient; no token. |
| Code | `text-xs font-mono` in `FileViewer.tsx:78`, `DiffViewer.tsx:51` | OK size but line-height `leading-relaxed` is too loose for dense reading; no syntax color. |

- **Weights**: Only `400 / 500 / 600 / 700` used; `600` on labels is heavy vs. actual density needs.
- **Letter-spacing**: Only `tracking-tight` on hero, `tracking-wider` on section titles — no systematic `tracking` scale.
- **Line-height**: `leading-relaxed` on descriptions, `leading-snug` on titles — arbitrary, not tokenized.
- **Headings**: `markdown-body h1 1.6rem / h2 1.3rem` `web/app/globals.css:77` — large for a code-adjacent product, and markdown styles bleed outside docs.

### 3.3 Code Typography
- Monospace used for: hashes (`slice(0,7)`), branch names, commands, but also for `Current User: Guest` stat — noise.
- Hashes shown as `text-indigo-400` on dark — decorative, not semantic.
- No tabular numbers, no `font-variant-ligatures` control.

**Grade: D — no loaded fonts, no scale, no density discipline.**

---

## 4. Layout Audit

### 4.1 Max Widths / Grid
- `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8` in `web/app/layout.tsx:28` and `Navbar.tsx:68` — consistent but too wide for code reading; file viewer lines run to edge.
- Dashboard: `grid grid-cols-1 lg:grid-cols-3 gap-8` `web/app/page.tsx:188` — left `lg:col-span-2` repo list + right quick-start panel. Right panel is filler (CLI cheatsheet) crowding real workspace.
- Repo page: single-column stack (`space-y-6`) with branch pill + view pills + content — no secondary navigation, no sticky context.
- CI page: `grid-cols-1 lg:grid-cols-3 gap-6` `web/app/[owner]/[repo]/ci/page.tsx:156` — correct split but job cards `grid-cols-3 gap-3` collapse poorly on mobile.

### 4.2 Density
- **Too loose vertically**: `space-y-8` dashboard hero, `py-8` page gutters, `p-6 sm:p-8` hero padding — marketing whitespace, not tool density.
- **Too tight horizontally** inside cards: `px-4 py-2.5` rows with `gap-4` — inconsistent.
- **No vertical rhythm**: `8 / 12 / 16 / 24 / 32px` mixed arbitrarily (e.g., `mt-8` then `pt-6` on same hero).

### 4.3 Shell
- **Navbar**: `h-16` `web/components/Navbar.tsx:68` tall, heavy `bg-[#090a0f]/80 backdrop-blur-xl` with gradient logo `from-indigo-600 via-indigo-500 to-purple-500` and `CAS v1.0` pill — louder than content. Two calls to `Api.me()` (Navbar + page) on mount.
- **Footer**: `border-t bg-[#090a0f]/90 py-8` `web/app/layout.tsx:32` with `Cpu/Database/Terminal` icon row — decorative, repeats hero.
- **Ambient blobs**: 3 fixed gradients `web/app/layout.tsx:20-23` (`from-indigo-900/15 via-purple-900/10 blur-3xl`) — trend soup, paints over neutral intent, costs blur on old hardware.

### 4.4 Responsive
- No tablet design — `hidden md:flex` nav, `sm:` breakpoints only. Sidebar concept absent (single top nav) — OK for v1 but no drawer/sheet for mobile repo nav.
- Code/diff tables `overflow-x-auto` but header pills `overflow-x-auto scrollbar-none` without affordance.
- Modals `max-w-lg / max-w-2xl / max-w-4xl` good, but `p-4` on mobile clips code.

**Grade: D — no density system, marketing spacing, shell louder than content.**

---

## 5. Color Audit

### 5.1 Token System
Declared in `web/tailwind.config.ts:11-31`:
```ts
brand: 50-950 (indigo)
surface: base #090a0f, card #11131c, elevated #181b28, hover #212538, border #252a3e, border-subtle #1b1f2e
```
And `web/app/globals.css:6-11` CSS vars `--bg-base/card/elevated/border-subtle/border-highlight` — **vars never used**. Actual components hardcode hex and `white/[0.08]`.

### 5.2 Background Layers
- Base `#090a0f`, card `#11131c`, elevated `#181b28` — correct neutral intent, but layers differ by <5% luminance; borders carry contrast instead, inconsistently.
- Many `bg-zinc-900/60`, `bg-zinc-950/60`, `bg-zinc-800/60` mixed with `bg-[#11131c]` — 3 neutral families (surface + zinc) fighting.

### 5.3 Foreground Hierarchy
- Primary `text-white`, secondary `text-zinc-200`, muted `text-zinc-400`, subtle `text-zinc-500` — 4 steps but used randomly (`text-zinc-300` on commit messages, `text-zinc-400` on titles).
- No `foreground-disabled` token.

### 5.4 Borders
- `border-white/[0.08]`, `border-white/[0.04]`, `border-white/[0.06]`, `border-white/[0.1]`, `border-zinc-700/60`, `border-zinc-800/60` — **6+ border tokens** where 3 are needed. Inline `style` overrides in same file.

### 5.5 Semantic & Accent
- **Accent**: `indigo-600` primary everywhere (buttons, tabs, badges, glows). Competing accents: `emerald-400` (success), `purple-400` (CI/pills), `amber-400` (file icons), `sky-400`, `cyan-400`, `rose-400` — 6+ hues at full saturation, no hierarchy.
- **Success/Warning/Danger/Info**: No shared token — `emerald-500/20`, `rose-500/10`, `amber-500/20` inline with varying opacity/border.
- **Code accents**: hash `indigo-400`, branch `indigo-400`, Verified `emerald-400` — colors mean decoration, not state.

**Grade: D — token declared but unused; color used as decoration, not hierarchy.**

---

## 6. Border Radius Audit

`rounded-2xl` (16px) is the default for every panel: dashboard hero `web/app/page.tsx:123`, modal `web/app/page.tsx:388`, repo cards `web/app/page.tsx:250`, FileTree `web/components/FileTree.tsx:61`, CommitList `web/components/CommitList.tsx:34`, DiffViewer `web/components/DiffViewer.tsx:28`, auth cards `web/app/login/page.tsx:52`. Same radius for 32px badges and 400px modals — strongest AI-slop signal.

Sub-pills use `rounded-xl`, `rounded-lg`, `rounded-full` arbitrarily. No radius hierarchy.

**Grade: F — one radius to rule them all.**

---

## 7. Shadow Audit

`shadow-2xl`, `shadow-xl`, `shadow-lg`, `shadow-md`, `shadow-indigo-600/30` layered with `backdrop-blur-xl` on most surfaces `web/app/globals.css:38-49` `.glass-panel`. Backdrop blur on non-overlay surfaces is expensive and unnecessary. Glow utilities `.glow-indigo` unused but `shadow-indigo-500/20` on hero is.

Most surfaces should rely on background + border, not shadow. Only popovers/command palette/dialogs deserve elevation.

**Grade: D — heavy shadows + blur where subtle border would suffice.**

---

## 8. Component Inventory

| Component | File | Current Treatment | Problem | Verdict |
|-----------|------|-------------------|---------|---------|
| **Navbar** | `web/components/Navbar.tsx:66` | `h-16 sticky backdrop-blur-xl`, gradient logo, CAS pill, health ping dot, auth split | Gradient + blur + ping = loudest element; health poll every 15s correct but pill styling generic | Redesign |
| **Dashboard Hero** | `web/app/page.tsx:123` | `rounded-2xl border bg-gradient-to-r from-indigo-950/40 …` + Sparkles pill + 4 stat cards | Marketing hero in a tool; stat cards `Total Repositories / CAS Storage Format / Architecture / Current User` are not workspace | Replace |
| **Repo Card** | `web/app/page.tsx:248` | `rounded-2xl p-5 hover:border-indigo-500/40 hover:shadow-indigo-500/5` + visibility pill + Explore button | Heavy hover, truncated density; no language, updated time, stars | Refactor |
| **Search/Filter** | `web/app/page.tsx:193` | `rounded-xl bg-zinc-900/80` input + segmented vis filter `rounded-xl p-1` | Segmented control uses large radius + `bg-indigo-600` active — OK but inconsistent with repo tabs | Unify |
| **RepoHeader** | `web/components/RepoHeader.tsx:87` | `border-b pb-6` + icon tile + `owner/repo` mono + visibility pill + Star + Clone dropdown | Good info, but `Clone` primary competes with Star; dropdown uses tab pills again | Refine |
| **RepoTabs** | `web/components/RepoTabs.tsx:85` | `border-b gap-1` + per-tab `rounded-t-lg` + gradient underline `from-indigo-500 to-purple-500` | Gradient underline is decoration; active `bg-zinc-900/60 border-t border-x` mimics browser tabs unnecessarily | Simplify |
| **Branch Selector** | `web/app/[owner]/[repo]/page.tsx:234` | Button `rounded-xl` + dropdown `rounded-xl p-2` | Duplicates Navbar pill language; no search, no keyboard | Rebuild as composable |
| **View Pills** | `web/app/[owner]/[repo]/page.tsx:279` | `Files / Commits / CAS Inspector / Settings` segmented `bg-indigo-600` active | 4-way pill is navigation pretending to be filter; Settings should not be a pill | Rework IA |
| **FileTree** | `web/components/FileTree.tsx:61` | `rounded-xl` + latest-commit bar `bg-zinc-900/60` + rows `divide-y` + `hover:bg-zinc-900/50` | Best component — dense rows good — but icons multicolor, `View` button per row is heavy, selected `bg-indigo-950/40` too tinted | Keep, tune |
| **FileViewer** | `web/components/FileViewer.tsx:28` | Header `bg-zinc-900/80` + `table` line numbers + `hover:bg-white/[0.03]` | Reads well but `max-h-[600px]` arbitrary, `Blobs size` via `new Blob()` is JS-only, no syntax highlight, no sticky header | Upgrade |
| **CommitList** | `web/components/CommitList.tsx:34` | `rounded-xl` header `SHA-256 CAS Verified` pill + rows `p-4 hover:bg-zinc-900/40` + avatar dot `bg-indigo-500/15` + Verified pill | Row padding large (generic card), Verified pill per row is noise, no graph, no copy affordance hierarchy | Densify |
| **VCSInspector** | `web/components/VCSInspector.tsx:60` | 3 info cards `rounded-xl` + input `rounded-lg` + result `pre` | Education panel is good, but 3 cards repeat hero info; input needs hash validation affordance | Trim |
| **DiffViewer** | `web/components/DiffViewer.tsx:28` | Header `+3 -2` pills + `table` green/red rows | Functional but `@@` row `bg-indigo-950/40` fights diff semantics; line numbers are display index not real diff line nos | Fix |
| **Issues List** | `web/app/[owner]/[repo]/issues/page.tsx:220` | `rounded-2xl` + filter pills `bg-emerald-500/20` vs `bg-purple-500/20` + rows `p-4` | Two highlight colors for open/closed fight; search `rounded-xl` again | Unify to single accent |
| **Issues Modal** | `web/app/[owner]/[repo]/issues/page.tsx:271` | `fixed inset-0 bg-black/75 backdrop-blur-sm` + `rounded-2xl border-white/[0.1] p-5` | Backdrop blur on modal is OK but `75%` dark + blur heavy on low-end; content scroll not trapped | Refine |
| **Pulls List** | `web/app/[owner]/[repo]/pulls/page.tsx:210` | `rounded-2xl` + rows with `source → target` pills | Branch pills `bg-indigo-500/10` + `bg-zinc-800` correct intent but arrows heavy | Keep |
| **PR Diff Modal** | `web/app/[owner]/[repo]/pulls/page.tsx:275` | `max-w-4xl max-h-[90vh]` + sticky header + diff + comments + input footer | Most complex view — good, but header repeats branch meta already in list; merge button `bg-purple-600` is off-brand | Consolidate |
| **CI Split** | `web/app/[owner]/[repo]/ci/page.tsx:156` | Left pipelines `divide-y` + right `grid grid-cols-3` jobs + terminal `bg-[#090a0f]` with traffic lights | Terminal chrome is cute but non-functional; `Live sync` pulse, job `bg-indigo-500/10` vs `bg-zinc-950/60` fight | Simplify |
| **Auth Cards** | `web/app/login/page.tsx:52`, `web/app/register/page.tsx:54` | `rounded-2xl p-8 backdrop-blur-xl` + gradient icon | Gradient icon repeats Navbar; `demo_user` filler is dev artifact leaking to UI | Restrain |

**Cross-cutting repeats**: `rounded-2xl border-white/[0.08] bg-[#11131c] shadow-xl` appears 18×; `rounded-xl border p-3` modals 7×; `bg-indigo-600` primary 22×; `Sparkles` decorative icon 4×.

**Grade: D — components are individually reasonable, collectively generic and duplicated.**

---

## 9. Interaction Audit

| State | Current | Issue |
|-------|---------|-------|
| **Hover** | `hover:border-indigo-500/40`, `hover:bg-zinc-900/40`, `hover:text-white` uniform | All hovers tint indigo — no distinction between card hover vs row hover vs button hover. |
| **Focus** | `focus:border-indigo-500 focus:outline-none` only on inputs; buttons have no `focus-visible:ring` | Keyboard users get no ring; `focus-visible` not used. |
| **Active/Pressed** | No `active:` styles anywhere; buttons `hover:scale-[1.02]` `web/app/page.tsx:142` is bounce | Press has no tactile feedback; scale on hover is anti-pattern. |
| **Disabled** | `disabled:opacity-50` only | No `disabled:cursor-not-allowed`, no reduced contrast token. |
| **Loading** | `animate-pulse` on repo loading `web/app/[owner]/[repo]/page.tsx:187`, text `Loading…` elsewhere | Inconsistent; no skeletons matching final geometry. |
| **Success/Error** | `border-emerald-500/30 bg-emerald-500/10` success banners vs `border-rose-500/30 bg-rose-500/10` errors inline | Banner colors compete with accent; no toast system. |
| **Transitions** | `animate-fade-in` + `animate-slide-down` `web/tailwind.config.ts:53-75` + `transition-all` everywhere | `transition-all` is expensive (paints all props); `slide-down 0.2s ease-out` on every dropdown is OK but no `prefers-reduced-motion` guard. |
| **Dialogs** | `fixed inset-0 bg-black/70 p-4 backdrop-blur-sm` with `animate-slide-down` panel | No `role="dialog"`, no focus trap, no `Escape` handling beyond ad-hoc `onClick` overlay; backdrop is div not semantic. |
| **Lists** | No stagger, no layout animation | OK — but PR/issue rows could benefit from subtle layout transition on filter. |
| **Copy** | `Copy → Check` 2s timeout per component, duplicated code | Works but each file reimplements; no shared `useCopy` hook. |

**Grade: D — hover indiscriminate, focus missing, motion untokenized, a11y dialogs not real.**

---

## 10. UX & IA Problems

1. **Dashboard is not a workspace**. Hero + 4 stat cards + repo grid + CLI cheat sheet = landing page inside app. Developers want *recent activity, active PRs needing review, recent commits, pinned repos* — not `CAS Storage Format: SHA-256`.
2. **No global search / command palette**. Most common developer flow (jump to repo/file/commit) requires navigation + clicks. No `⌘K` affordance.
3. **Repository IA confusion**: `Files / Commits / CAS Inspector / Settings` are view pills inside Code — but Issues/Pulls/CI are top tabs. Commits should be top-level (like GitHub), CAS Inspector is power-user niche, Settings deserves own page.
4. **Branch awareness is weak**. Branch dropdown is local to Code tab; Issues/PRs/CI lose branch context.
5. **Empty states are an afterthought**. Most are `No … yet.` with a single icon `CircleDot h-8 w-8 text-zinc-600` and no primary action. Repo empty (no commits) is `p-8 animate-pulse` — not actionable.
6. **Error states are terse**. `error` string from API shown raw in `border-rose-500/30` box — sometimes `Failed to load repositories` with no retry action or correlation id.
7. **Loading states are fake**. Dashboard `Loading repositories…` box same size as card grid — skeletons should match repo rows.
8. **Excessive clicks**: repo → Code → branch dropdown → file row → `View` button → viewer modal — 3 clicks for 1 file. File row itself is clickable but also has a View button competing.
9. **Star is optimistic but not resilient**. Reverts on catch but no toast on failure; count pill `bg-zinc-900/60 border-white/[0.06]` is tiny.
10. **CI terminal is skeuomorphic**. Red/yellow/green dots `web/app/[owner]/[repo]/ci/page.tsx:281` + `ci-runner:` label add noise; logs are `text-emerald-400` always — not semantic.

---

## 11. Accessibility Audit

- **Semantics**: No `nav`, `main` landmark beyond `web/app/layout.tsx:28`; headings skip levels (dashboard `h1` then cards have no `h2`).
- **Keyboard**: No `⌘K`, no `/` search, no `?` help; tab order untested; dialogs have no roving focus.
- **Focus ring**: Missing `focus-visible:outline` or `ring` — visible focus is `border-indigo-500` only on inputs.
- **ARIA**: Custom dropdowns (`branchDropdownOpen`, `cloneOpen`) have no `aria-expanded`, `aria-haspopup`, `role="listbox"`; icons alone (`Star`, `Copy`) lack `aria-label`.
- **Contrast**: `text-zinc-400` on `#11131c` ≈ 4.2:1 borderline; `text-indigo-400` on `#11131c` ≈ 4.0:1 — fails for small text.
- **Reduced motion**: No `@media (prefers-reduced-motion)` — `animate-ping`, `animate-pulse`, `slide-down` run regardless.
- **Touch**: Buttons `px-3 py-1` (20px tall) below 44px minimum; file rows `py-2.5` tight for thumb.

**Grade: D — functional with screen reader, not designed for it.**

---

## 12. Performance Audit

- **Blur cost**: `backdrop-blur-xl` on navbar, 6 cards, 3 modals; `blur-[140px]` decor — heavy on Ryzen 3500U iGPU (target laptop). No `will-change` shortlist.
- **Animation cost**: `transition-all` triggers layout+paint; `hover:scale-[1.02]` forces compositing per repo card.
- **JS payload**: `lucide-react 1.39.0` + `react-markdown + remark-gfm` (micromark stack ~600KB parsed) shipped to every page, even auth. No code-splitting for `MarkdownViewer`.
- **Polling**: `setInterval(checkUserAndHealth,15000)` per mount `web/components/Navbar.tsx:55` + `setInterval(loadPipelines,4000)` `web/app/[owner]/[repo]/ci/page.tsx:88` — no backoff, no visibility guard.
- **Rerenders**: `Api.me()` called in `Navbar` and `page.tsx` separately; no `SWR`/`React Query` cache; `copiedCmd` per-page state re-renders whole grid.
- **CSS**: `white/[0.08]` bespoke JIT per file — no reuse; purge OK but token miss.

**Grade: C — works on M4 dev, will stutter on target Vivobook if unchanged.**

---

## 13. Visual Identity

**Current identity**: Indigo + purple gradients, glassmorphism, Sparkles icons, `Layers` logo. It says "2024 AI SaaS starter" — not "code, history, objects, branches, integrity."

**What Itehaas is about**: content-addressable objects, DAG history, deterministic hashing, branch graphs, file trees, diff hunks, CI pipelines. Identity should feel *precise, technical, structural* — inspired by graph nodes/edges, path separators, mono details, not nebula blobs.

**Opportunity**: Own identity via restrained technical accents — hairline graph lines, commit-node motif, `owner/repo:branch` breadcrumb, object hash as first-class typography.

---

## 14. What to Keep vs. Rebuild

| Keep | Reason |
|------|--------|
| `web/lib/api.ts` shape | Clean, typed enough, error handling OK |
| Real data flow (`Api.tree/log/branches`) | Must stay — no mocks |
| `FileTree` row density concept | Good base, just needs tuning |
| `DiffViewer` unified table | Correct, just color/number fixes |
| `RepoTabs` tab idea | Correct grouping, just visual simplification |

| Rebuild / Heavy Refactor |
|--------------------------|
| `web/app/globals.css` — full token rewrite |
| `web/tailwind.config.ts` — remove brand rainbow, add semantic tokens |
| `web/app/layout.tsx` — remove decor blobs, slim footer, add command palette shell |
| `web/app/page.tsx` — replace hero, kill stat cards, add workspace composition |
| `web/components/Navbar.tsx` — quieter, denser, no gradients |
| `web/components/RepoHeader.tsx` — sharper, less pill noise |
| `web/components/RepoTabs.tsx` — single accent, underline motion |
| `web/app/[owner]/[repo]/page.tsx` — fix IA (commits top-level, inspector secondary) |
| All `rounded-2xl` + `border-white/[0.08]` repeats — tokenize |
| Dialog/Popover primitives — replace div overlays with Radix-based a11y |
| Motion — remove `transition-all/scale/glow`, add tokenized springs |
| Responsive shell — add AppShell with collapsible sidebar pattern |

---

## 15. Audit Checklist

- [x] Typography inspected
- [x] Layout inspected
- [x] Color inspected
- [x] Radius inspected
- [x] Shadow inspected
- [x] Every component inventoried
- [x] Interaction states inspected
- [x] IA/UX problems listed
- [x] A11y checked
- [x] Performance checked
- [x] Identity assessed

Next: `docs/design-system.md` and `docs/motion-system.md` propose the fix.

