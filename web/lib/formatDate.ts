/**
 * Commit date formatting for Itehaas.
 * Server returns `Date: 1788286734 +0000` (unix seconds + tz).
 * This module parses that and produces human-readable relative + absolute.
 */

export function parseCommitDate(raw?: string | null): Date | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Try numeric timestamp first: "1788286734 +0000" or "1788286734"
  const parts = trimmed.split(/\s+/);
  const first = parts[0];
  if (/^-?\d+$/.test(first)) {
    const ts = Number(first);
    // sanity: allow 0 .. year 2100
    if (Number.isFinite(ts) && ts > 0 && ts < 4102444800) {
      const d = new Date(ts * 1000);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }

  // Fallback: try native Date parsing (e.g., ISO, RFC)
  const d2 = new Date(trimmed);
  if (!Number.isNaN(d2.getTime())) return d2;

  return null;
}

export function formatAbsolute(date: Date): string {
  // Example: "Sep 1, 2026 at 2:18 PM UTC"
  try {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

export function formatRelative(date: Date, nowMs = Date.now()): string {
  const diffMs = nowMs - date.getTime();
  // Future dates (clock skew) -> show absolute shortly
  if (diffMs < 0) {
    const absFuture = Math.abs(diffMs);
    if (absFuture < 60_000) return "just now";
    return formatAbsolute(date);
  }

  const sec = Math.floor(diffMs / 1000);
  if (sec < 10) return "just now";
  if (sec < 60) return `${sec} sec ago`;
  const min = Math.floor(sec / 60);
  if (min === 1) return "1 min ago";
  if (min < 60) return `${min} mins ago`;
  const hour = Math.floor(min / 60);
  if (hour === 1) return "1 hour ago";
  if (hour < 24) return `${hour} hours ago`;
  const day = Math.floor(hour / 24);
  if (day === 1) return "yesterday";
  if (day < 7) return `${day} days ago`;
  if (day < 30) {
    const weeks = Math.floor(day / 7);
    return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
  }
  // Older than ~30 days -> show calendar date (keeps UI scannable)
  return formatAbsolute(date);
}

export function formatCommitDate(raw?: string | null): {
  date: Date | null;
  absolute: string;
  relative: string;
  hasDate: boolean;
} {
  const date = parseCommitDate(raw);
  if (!date) {
    return {
      date: null,
      absolute: raw ?? "",
      relative: raw ?? "",
      hasDate: false,
    };
  }
  return {
    date,
    absolute: formatAbsolute(date),
    relative: formatRelative(date),
    hasDate: true,
  };
}
