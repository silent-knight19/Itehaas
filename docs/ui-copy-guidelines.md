# Itehaas — UI Copy & Content Guidelines

> **Voice**: Concise, confident, precise, editorial.  
> **Philosophy**: A developer understands the product by using it, not by reading architecture descriptions on every page.

---

## 1. Principles

1. **Eliminate Implementation Jargon**: Do not announce internal architecture details in the primary user flow (e.g. "CAS Stored", "Storage Invariant", "Deterministic H(header\0body)"). The engineering speaks through speed and correctness.
2. **Remove Marketing Fluff**: Avoid generic SaaS onboarding slogans ("Manage your repositories with our cutting-edge VCS platform").
3. **Task-Appropriate Language**: Use straightforward, human, developer-centric terminology.
4. **No Fake Telemetry**: Never display hardcoded latencies or synthetic health statistics.

---

## 2. Copy Mapping & Replacements

| Context | What NOT to Write (AI/Jargon) | What to Write (Clean Product) |
|---|---|---|
| **Dashboard Heading** | `Manage your content-addressable storage repositories and VCS projects.` | `Repositories` / `Your projects, code, and history.` |
| **New Repo Modal** | `Initialize a content-addressable Git repository with SHA-256 storage.` | `Create a new repository` / `A repository contains all project files and revision history.` |
| **Repo Header** | `demo_user / demo-repo [CAS Stored]` | `demo_user / demo-repo` with subtle `public` or `private` indicator. |
| **Empty Repos** | `No repositories detected in content-addressable database.` | `No repositories yet` / `Create a repository to start tracking your code and history.` |
| **Empty Commits** | `No commit DAG nodes recorded for this ref.` | `No commits yet on this branch.` |
| **Empty Files** | `Tree object contains 0 blob entries.` | `This repository is empty.` |
| **Pull Request Status**| `Branch comparison detected 2 hunk variations.` | `2 changed files • +14 -3 lines` |
| **Action Toasts** | `SUCCESS!!! OPERATION COMPLETED SUCCESSFULLY 🚀` | `Repository created`, `Hash copied`, `Pull request merged` |
| **Error Feedback** | `Oops! Something went wrong 😭` | `Unable to load repository metadata` / `[Retry]` |

---

## 3. Empty, Loading & Error States

### Empty States
- Simple headline (e.g. `No repositories yet`).
- Concise one-line secondary explanation (e.g. `Create a repository to start tracking your code and history.`).
- Single primary action button (e.g. `New Repository`).

### Loading States
- Use geometry-matched skeletons (matching final rows, tables, or headers).
- No generic spinning wheel overlays.

### Error States
- State plainly what failed without dramatics.
- Provide a direct action to retry or navigate back.
