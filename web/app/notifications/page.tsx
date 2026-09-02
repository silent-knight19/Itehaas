"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck, AtSign, GitPullRequest, Star, Eye, AlertCircle } from "lucide-react";
import { Api } from "../../lib/api";

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "unread" | "mention">("all");

  async function load() {
    setLoading(true);
    try {
      const res = await Api.getNotifications();
      if (!res.ok) {
        if (res.status === 401) setError("Please sign in to view notifications.");
        else setError(res.json?.error || "Failed to load notifications");
        setNotifications([]);
      } else {
        setNotifications(res.json.notifications || []);
        setError(null);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function markRead(id: string) {
    await Api.markNotificationRead(id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
  }

  async function markAllRead() {
    for (const n of notifications.filter(n => !n.is_read)) {
      await Api.markNotificationRead(n.id);
    }
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
  }

  const filtered = notifications.filter(n => {
    if (filter === "unread") return !n.is_read;
    if (filter === "mention") return n.type === "mention";
    return true;
  });

  if (loading) return <div className="py-12 text-center text-xs text-fg-muted animate-pulse">Loading notifications…</div>;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-sm font-semibold text-fg">
          <Bell className="h-4 w-4" /> Notifications
          <span className="rounded-xs bg-surface border border-border-subtle px-1.5 py-0.5 text-[11px] font-mono text-fg-muted">{notifications.length}</span>
        </h1>
        <div className="flex items-center gap-1.5">
          <div className="flex rounded-sm border border-border-subtle overflow-hidden">
            {(["all", "unread", "mention"] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2.5 py-1 text-xs capitalize ${filter===f ? "bg-surface-active text-fg font-medium" : "bg-surface text-fg-muted hover:text-fg"}`}
              >
                {f}
              </button>
            ))}
          </div>
          <button
            onClick={markAllRead}
            className="flex items-center gap-1 rounded-sm border border-border-default bg-surface px-2 py-1 text-xs text-fg-muted hover:text-fg"
          >
            <CheckCheck className="h-3 w-3" /> Mark all read
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-sm border border-danger-border bg-danger-subtle p-3 flex items-center gap-2 text-xs text-danger">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      <div className="rounded-sm border border-border-subtle bg-surface divide-y divide-border-subtle overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <Bell className="h-5 w-5 mx-auto text-fg-muted" />
            <p className="text-xs text-fg-muted">No notifications{filter !== "all" ? ` for ${filter}` : ""}.</p>
            <p className="text-[11px] text-fg-subtle">Watch repos, get mentioned @user, or create PRs to generate notifications.</p>
          </div>
        ) : (
          filtered.map((n:any) => {
            let payload: any = {};
            try { payload = typeof n.payload === 'string' ? JSON.parse(n.payload) : n.payload; } catch {}
            const isMention = n.type === "mention";
            const isPR = n.type === "pr_open" || n.type === "pr_review_requested";
            const Icon = isMention ? AtSign : isPR ? GitPullRequest : n.type === "star" ? Star : Eye;
            const title = n.type === "mention" ? `You were mentioned by @${payload.by || "?"}` :
                          n.type === "pr_open" ? `PR opened: ${payload.title || ""}` :
                          n.type === "pr_review_requested" ? `Review requested by @${payload.requested_by || "?"}` :
                          n.type === "issue_assigned" ? `Assigned: ${payload.title || ""}` :
                          n.type === "star" ? `Starred` :
                          n.type;
            const href = payload.repo ? `/${payload.repo}` : payload.repo_owner && payload.repo ? `/${payload.repo_owner}/${payload.repo}` : "/";
            return (
              <div key={n.id} className={`flex items-start justify-between gap-3 px-3 py-2.5 hover:bg-surface-hover/50 ${!n.is_read ? "bg-accent-subtle/20" : ""}`}>
                <div className="flex gap-2.5 min-w-0">
                  <div className={`mt-0.5 rounded-xs p-1 ${!n.is_read ? "bg-accent text-white" : "bg-surface-hover text-fg-muted"}`}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs text-fg truncate">{title}</div>
                    <div className="text-[11px] text-fg-muted font-mono truncate">
                      {payload.repo || ""} {payload.pr_id && `#${payload.pr_id.slice(0,7)}`} • {new Date(n.created_at).toLocaleString()}
                    </div>
                    {payload.body && <div className="text-[11px] text-fg-secondary truncate max-w-md">{payload.body.slice(0,80)}</div>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {payload.repo && (
                    <Link href={href} className="rounded-xs border border-border-subtle bg-surface px-1.5 py-0.5 text-[11px] text-fg-muted hover:text-fg">
                      View
                    </Link>
                  )}
                  {!n.is_read && (
                    <button
                      onClick={() => markRead(n.id)}
                      className="rounded-xs bg-accent px-1.5 py-0.5 text-[11px] text-white hover:bg-accent-hover"
                    >
                      Mark read
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="text-center">
        <Link href="/" className="text-xs text-fg-muted hover:text-fg">← Back to dashboard</Link>
      </div>
    </div>
  );
}
