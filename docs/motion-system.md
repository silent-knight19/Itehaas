# Itehaas — Motion System Specification

> Version: 2.0 (Refined Architecture)  
> Author: Principal Product Designer & Design Engineer  
> Status: Specification & Contract  

---

## 1. Guiding Principle

> **"Motion explains change. It never decorates."**

If an interface element changes state, motion clarifies what changed, where it came from, or what action was confirmed. If an animation provides zero informational or spatial value, it is removed.

---

## 2. Motion Tokens

### 2.1 Duration Scale
| Token | Duration | Usage |
|---|---|---|
| `--duration-micro` | `100ms` | Button press, hover tint, icon flip, checkbox toggle |
| `--duration-fast` | `150ms` | Tab indicator slide, tooltip appear, copy feedback |
| `--duration-normal`| `200ms` | Dropdown open, popover reveal, branch switch |
| `--duration-modal` | `250ms` | Command palette open, dialog display, sidebar drawer |

### 2.2 Easing Curves
```css
:root {
  /* Fast start, smooth deceleration — default for UI reveals */
  --ease-out-quad: cubic-bezier(0.25, 0.46, 0.45, 0.94);
  
  /* Snappy mechanical response without bounce */
  --ease-snappy: cubic-bezier(0.16, 1, 0.3, 1);

  /* Micro-interactions */
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
}
```

---

## 3. Interaction Patterns

### 3.1 Buttons & Interactive Controls
- **Hover**: Immediate subtle background change (`--bg-surface` ➔ `--bg-surface-hover`, `100ms`). No bounce, no scale transformations.
- **Active / Press**: Slight opacity drop (`0.92`, `80ms`).
- **Focus**: Clear 2px focus ring (`--accent-border`, `0px offset`) on `focus-visible`.

### 3.2 Tabs & Segmented Controls
- **Active Indicator**: Shared underline indicator sliding smoothly via CSS transition (`transform: translateX()`, `150ms`, `var(--ease-snappy)`).

### 3.3 Command Palette (`⌘K`) & Dialogs
- **Entry**: Opacity `0` ➔ `1`, Scale `0.98` ➔ `1.0`, Duration `200ms`, `var(--ease-snappy)`.
- **Exit**: Opacity `1` ➔ `0`, Scale `1.0` ➔ `0.98`, Duration `150ms`.
- **Backdrop**: Opacity `0` ➔ `0.7` (`150ms`). Zero expensive backdrop blur filters.

### 3.4 Feedback & Confirmations
- **1-Click Copy**: Immediate switch from `Copy` icon to `Check` (green) with 0ms delay, reverting after `2000ms`.
- **Star Toggle**: Instant tabular counter increment (`1` ➔ `2`) with filled star icon.
- **Toast Notifications**: Non-intrusive bottom-right slide-up (`translateY(8px)` ➔ `translateY(0)`, `150ms`).

---

## 4. Accessibility: Reduced Motion

Every motion token strictly obeys `@media (prefers-reduced-motion: reduce)`:

```css
@media (prefers-reduced-motion: reduce) {
  *, ::before, ::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```
All state transitions remain instantaneous and fully accessible when reduced motion is preferred by the operating system.
