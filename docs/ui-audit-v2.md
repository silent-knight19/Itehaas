# Itehaas — Comprehensive UI/UX Audit (v2: Design Engineering Pass)

> **Auditor**: Principal Product Designer + Design Engineer  
> **Scope**: Complete web application (`web/app/*`, `web/components/*`, `web/app/globals.css`, `web/tailwind.config.ts`)  
> **Standard**: Linear-level restraint, Vercel/Geist-level typographic sharpness, Raycast-level interaction precision, GitHub-level data density, Stripe-level visual balance.  
> **Status**: Specification & Audit Baseline

---

## 1. Executive Summary & Diagnosis

The Itehaas web interface is functionally robust and architecturally connected to real content-addressable storage (SHA-256 CAS), live Fastify REST endpoints, and local PostgreSQL tables. However, the **visual execution currently exhibits classic AI-generated SaaS tropes**:

1. **Card Container Obsession**: Every entity (repo row, commit row, file tree, statistics block, README document) is wrapped in a discrete `border + rounded + dark-surface` card. It feels like a template of boxes rather than a cohesive developer workspace.
2. **Accent Color Saturation (Blue Fatigue)**: Bright electric blue is overused across primary buttons, secondary links, active tabs, branch tags, commit hashes, icons, and status indicators. Because blue is everywhere, nothing stands out.
3. **Typography Flattening**: Typography relies on generic weights and indiscriminate monospace application (e.g. repo names, descriptions, author details). Headings lack editorial distinction, and metadata does not recede naturally.
4. **Visual "Fake Technicality" & Jargon Soup**: Interface copy repeatedly announces internal implementation details ("CAS Stored", "Storage Invariant", "Engine: 13ms latency") instead of communicating direct product value.
5. **README Boxed as a Widget**: The README is rendered inside a heavy card container instead of feeling like an integrated, readable document.
6. **Machine-Generated Copy**: Headings and descriptions sound like architecture documentation ("Manage your content-addressable storage repositories and VCS projects") rather than clean product language.

---

## 2. Granular Flaw Analysis

### 2.1 The "Card Container" Disease (Problem A)
- **Current State**:
  - Dashboard: 2-column grid with stacked boxed cards for repositories + boxed card for CLI cheat sheet + boxed card for storage invariant.
  - Repo View: File tree is boxed in a card; README is boxed in another card with a separate header bar; latest commit is boxed in a sub-bar.
  - Commits View: Every commit row feels like a mini container with redundant badges.
- **Remedy**:
  - Remove outer box wrappers.
  - Use clean hairline horizontal dividers, subtle typography hierarchy, optical alignment, and generous margin rhythm.
  - Let the file list look like an authentic IDE/desktop file explorer, the commit history look like a chronological ledger, and the README read like an editorial document.

### 2.2 Accent Overuse & Palette Imbalance (Problem B)
- **Current State**:
  - Blue (`#3b82f6`) appears in:
    - New Repo button, Star button, Clone button, Browse buttons
    - Active nav tab indicator & tab text
    - File icons, branch icons, commit icons
    - Commit hashes, branch tags, quick command boxes
    - Search icons, health indicator text, links
- **Remedy**:
  - Establish a **90% neutral architecture**: layered graphite, deep slate, warm-toned dark surfaces (`#090a0f`, `#0d0f14`, `#12151c`, `#181b24`), with crisp off-white text (`#ededed`, `#a1a1a1`, `#666666`).
  - Reserve brand accent strictly for:
    - Single primary action per view (e.g. "New repository" or "Merge pull request")
    - Active tab underline indicator
    - Specific focus rings on active keyboard controls

### 2.3 Typography & Font Discipline (Problem D)
- **Current State**:
  - Monospace applied arbitrarily to repository names, descriptions, status badges, and table headers.
  - Sans serif lacks crisp micro-kerning and optical scale.
- **Remedy**:
  - Integrate **Geist Sans** (`geist/font/sans`) for all UI text, headings, titles, descriptions, and metadata.
  - Restrict **Geist Mono** (`geist/font/mono`) strictly to:
    - SHA-256 hashes (`3a7f9b2`)
    - Code viewer lines and diff chunks
    - Terminal CLI commands
    - Mode bits (`100644`, `100755`)
    - Branch ref names when presented as code identifiers
  - Establish distinct typographic roles: Display (20px/26px), Page Title (16px/22px), Section Title (13px/18px bold), Body (13px/20px regular), Metadata (12px/16px muted), Caption (11px/14px subtle).

### 2.4 Removal of "Fake Technicality" & Jargon (Problem E)
- **Current State**:
  - Right sidebar card showing `H(header || 0x00 || body)` formula.
  - `CAS Stored` badge on every repository row.
  - `Engine: 13ms` real-time telemetry badge in the top bar.
- **Remedy**:
  - Remove decorative formula cards and telemetry noise from the top bar.
  - Convey engineering depth through speed, keyboard ergonomics, data precision, clean diff rendering, and reliable DAG history.

### 2.5 Interface Copy Redesign (Problem F)
- **Current State**:
  - "Manage your content-addressable storage repositories and VCS projects."
  - "Create a new repository" modal subtitle describing storage format.
- **Remedy**:
  - Adopt concise, confident product copy:
    - Dashboard: `Repositories` / `Your projects, code, and history.`
    - Empty state: `No repositories yet` / `Create a repository to start tracking your code.`
    - Code viewer: Simple path breadcrumbs, file size, line counts.

### 2.6 README Document Experience (Problem H)
- **Current State**:
  - Boxed inside a framed card with a duplicate top header bar ("README.md" + "Raw" button).
- **Remedy**:
  - Embed the README directly below the file list as a seamless document.
  - Optimal reading width (max-w-3xl / 720px reading line), clean typography for headings, lists, blockquotes, and tables, with subtle code snippet backgrounds.

---

## 3. Component Rework Matrix

| Component | Current AI-Slop Pattern | Proposed Redesign Direction | Priority |
|---|---|---|---|
| **AppShell** | Utilitarian top bar with fake latency + generic sidebar | Quieter 220px desktop sidebar, subtle active indicators, integrated search trigger, real state | P0 |
| **CommandPalette** | Basic centered popup | Fast, elevated `⌘K` palette with grouped actions (Repositories, Navigation, Commands), fuzzy filter | P0 |
| **Dashboard** | 2-col card layout with CLI cheatsheet box & storage invariant | Refined repository workspace: search input with shortcut hint, segmented filter, dense rows, empty state | P0 |
| **RepoHeader** | Loud star & clone buttons fighting for dominance | Understated breadcrumbs (`owner / repo`), subtle visibility pill, clean secondary star/clone triggers | P0 |
| **RepoTabs** | Underline with heavy text color | Shared-element sliding indicator, quiet typography, compact badge counts | P1 |
| **FileTree** | Boxed card container with heavy row borders | Clean explorer table, subtle file-type icons, hairline row dividers, last commit snippet | P1 |
| **FileViewer** | Boxed card with oversized line numbers | Editor-grade code viewing surface, tabular line numbers, subtle active line hover, sticky info bar | P1 |
| **MarkdownViewer** | Boxed widget with thick borders | Document-grade typography, natural reading line width, refined code blocks | P1 |
| **CommitList** | Heavy boxed cards per commit with blue tags | Editorial chronological timeline, hairline graph line, sans commit title, mono hash, 1-click copy | P1 |
| **BranchesView** | Card wrapper with oversized checkout buttons | Dense data table with default branch indicator, ahead/behind counters, compact action menu | P1 |
| **IssuesView** | Floating cards per issue | Linear-style dense issue ledger, status icon, label badges, compact timestamp | P1 |
| **PullsView** | Colored arrow badges in cards | Operational PR list with branch comparison (`feature → main`), reviewer state, clean merge flow | P1 |
| **DiffViewer** | Harsh red/green row background fills | Subtle gutter indicators (+ / -), restrained addition/deletion tints, syntax readability | P1 |
| **CI / Pipelines** | Multi-card grid with polling badge | Clean timeline step progression nodes (`install` ➔ `test` ➔ `build`), real terminal stream | P2 |
| **Toast** | Raw text alert | Non-intrusive bottom-right micro-toast with auto-dismiss and concise copy | P2 |

---

## 4. Interaction & Motion Blueprint

1. **Restraint in Motion**: No decorative spinning, bouncing, or sliding of document text. Motion is used exclusively to explain spatial hierarchy and state changes.
2. **Micro-Transitions**:
   - Tab switching: Smooth underline glide (`150ms`, `cubic-bezier(0.16, 1, 0.3, 1)`).
   - Command palette: Fast fade-scale reveal (`180ms`).
   - Copy action: Instant icon check flip (`0ms delay`), 2s auto-revert.
   - Row hover: Subtle background shift (`100ms`).
3. **Accessibility & Reduced Motion**: Full `@media (prefers-reduced-motion: reduce)` override disabling all CSS transitions and animations.

---

## 5. Next Steps

1. Create `docs/design-system.md` (Formal centralized design tokens: neutral palette, typography scale, radii, spacing, motion).
2. Create `docs/ui-copy-guidelines.md` (Product copy tone, voice, and error/empty state patterns).
3. Create `docs/motion-system.md` (Tokenized curves, durations, and state transitions).
4. Update `PLAN.md` with `## UI/UX Redesign v2` roadmap and real tracking checkboxes.
