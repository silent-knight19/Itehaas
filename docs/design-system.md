# Itehaas — Design System Specification (v2)

> **Standard**: Quietly premium, technical, precise, editorial, fast, confident.  
> **Rule**: Remove visual noise before adding visual beauty. 90% neutral, scarce accent, authentic typography.

---

## 1. Color System (90% Neutral + Scarce Accent)

```css
:root {
  /* Surfaces & Neutral Backgrounds */
  --bg-canvas: #090a0f;          /* Deep graphite application backdrop */
  --bg-sidebar: #0d0f14;         /* Left navigation chrome */
  --bg-surface: #12151c;         /* Primary list surfaces, tables, code containers */
  --bg-surface-hover: #171b24;   /* Interactive item hover */
  --bg-surface-active: #1d222e;  /* Selected row / active toggle */
  --bg-overlay: #151821;         /* Command palette, dialogs, popovers */
  --bg-subtle: #0b0d12;          /* Inset code blocks, terminal streams */

  /* Text & Foreground Hierarchy */
  --fg-primary: #ededed;         /* High-contrast headings, active text */
  --fg-secondary: #a1a1a1;       /* Body copy, descriptions, table cells */
  --fg-muted: #666666;           /* Metadata, timestamps, non-active icons */
  --fg-subtle: #444444;          /* Line numbers, disabled hints, borders */
  --fg-on-accent: #ffffff;       /* Text on primary filled actions */

  /* Hairline Borders & Dividers */
  --border-subtle: #1c202a;      /* Table row dividers, internal section rules */
  --border-default: #282d3b;     /* Input borders, card framing */
  --border-emphasis: #3d4456;    /* Hovered borders, active inputs */

  /* Brand Accent: Itehaas Electric Steel (Scarce, Rare) */
  --accent: #3b82f6;             /* Single primary action per screen, tab indicator */
  --accent-hover: #2563eb;       /* Hovered primary action */
  --accent-subtle: rgba(59, 130, 246, 0.08); /* Selection tint */
  --accent-border: rgba(59, 130, 246, 0.25); /* Focus ring */

  /* Semantic Status Tokens (Precise, Subdued) */
  --success: #10b981;
  --success-subtle: rgba(16, 185, 129, 0.1);
  --success-border: rgba(16, 185, 129, 0.25);

  --warning: #f59e0b;
  --warning-subtle: rgba(245, 158, 11, 0.1);
  --warning-border: rgba(245, 158, 11, 0.25);

  --danger: #ef4444;
  --danger-subtle: rgba(239, 68, 68, 0.1);
  --danger-border: rgba(239, 68, 68, 0.25);

  --merged: #8b5cf6;
  --merged-subtle: rgba(139, 92, 246, 0.1);
  --merged-border: rgba(139, 92, 246, 0.25);

  /* Diff Readability Tokens */
  --diff-add-bg: rgba(16, 185, 129, 0.08);
  --diff-add-text: #34d399;
  --diff-del-bg: rgba(239, 68, 68, 0.08);
  --diff-del-text: #f87171;
  --diff-hunk-bg: rgba(59, 130, 246, 0.06);
  --diff-hunk-text: #93c5fd;
}
```

---

## 2. Typography System (Geist Sans + Geist Mono)

| Token | Family | Size | Weight | Tracking | Purpose |
|---|---|---|---|---|---|
| `text-display` | Geist Sans | 18px (1.125rem) | 600 (Semibold) | -0.02em | Top repository title, auth title |
| `text-title` | Geist Sans | 15px (0.9375rem) | 600 (Semibold) | -0.015em | Page headings, modal titles |
| `text-section` | Geist Sans | 13px (0.8125rem) | 500 (Medium) | -0.01em | Table headers, section titles |
| `text-body` | Geist Sans | 13px (0.8125rem) | 400 (Regular) | 0 | Descriptions, prose, comments |
| `text-meta` | Geist Sans | 12px (0.75rem) | 400 (Regular) | 0 | Authors, timestamps, relative dates |
| `text-code` | Geist Mono | 12px (0.75rem) | 400 (Regular) | 0 | Commit hashes, branch tags, CLI |
| `text-code-sm` | Geist Mono | 11px (0.6875rem) | 400 (Regular) | 0 | Line numbers, object sizes, permissions |

> [!IMPORTANT]
> **Strict Monospace Rule**: Monospace is reserved exclusively for code, SHA-256 hashes, commit IDs, terminal commands, mode bits, and branch ref names. All descriptions, repository names, author names, and headings use **Geist Sans**.

---

## 3. Disciplined Radius Scale

| Token | Value | Applied To |
|---|---|---|
| `radius-none` | 0px | Full-bleed code tables, diff blocks, table borders |
| `radius-xs` | 2px | Micro tags, permission badges (`100644`), hash tags |
| `radius-sm` | 4px | Buttons, inputs, search bar, dropdown items, table rows |
| `radius-md` | 6px | Modals, command palette, popovers, dialogs |
| `radius-full` | 9999px | Avatars, live status dots |

---

## 4. Spacing, Elevation & Surfaces

- **Zero Arbitrary Box Shadows**: Surfaces rely on background luminance separation and subtle borders (`--border-subtle`, `--border-default`).
- **Command Palette & Dialogs**: `box-shadow: 0 16px 40px -8px rgba(0, 0, 0, 0.7), 0 0 0 1px var(--border-default)`.
- **Reading Width Constraint**: Documents and READMEs constrained to max-width `720px` for optimal typographic readability.
