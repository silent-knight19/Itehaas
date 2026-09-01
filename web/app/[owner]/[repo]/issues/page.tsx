"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  CircleDot,
  CheckCircle2,
  Plus,
  MessageSquare,
  Search,
  X,
  Send,
} from "lucide-react";
import { Api } from "../../../../lib/api";
import { RepoHeader } from "../../../../components/RepoHeader";
import { RepoTabs } from "../../../../components/RepoTabs";
import { useToast } from "../../../../components/Toast";

interface Issue {
  id: string;
  title: string;
  body: string;
  status: "open" | "closed";
  created_at: string;
  updated_at: string;
  author: string;
}

interface Comment {
  id: string;
  body: string;
  created_at: string;
  author: string;
}

export default function IssuesPage({
  params,
}: {
  params: { owner: string; repo: string };
}) {
  const { owner, repo } = params;

  const [repoInfo, setRepoInfo] = useState<any>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [statusFilter, setStatusFilter] = useState<"open" | "closed" | "all">("open");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);

  // Active Issue Detail Modal
  const [activeIssue, setActiveIssue] = useState<Issue | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [newCommentText, setNewCommentText] = useState("");
  const [postingComment, setPostingComment] = useState(false);

  // New Issue Modal
  const [newIssueOpen, setNewIssueOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [creatingIssue, setCreatingIssue] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);

  const { toast } = useToast();

  async function loadData() {
    setLoading(true);
    try {
      const r = await Api.getRepo(owner, repo);
      if (r.ok) setRepoInfo(r.json.repo);

      const res = await Api.listIssues(owner, repo);
      if (res.ok && res.json.issues) {
        setIssues(res.json.issues);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [owner, repo]);

  async function handleCreateIssue(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setCreatingIssue(true);
    setIssueError(null);

    const res = await Api.createIssue(owner, repo, {
      title: newTitle.trim(),
      body: newBody.trim(),
    });

    setCreatingIssue(false);
    if (res.ok) {
      setNewTitle("");
      setNewBody("");
      setNewIssueOpen(false);
      toast("Issue created", "success");
      loadData();
    } else {
      setIssueError(res.json?.error || "Failed to create issue");
    }
  }

  async function openIssueDetail(issue: Issue) {
    setActiveIssue(issue);
    setLoadingComments(true);
    const res = await Api.getIssueComments(owner, repo, issue.id);
    setLoadingComments(false);
    if (res.ok && res.json.comments) {
      setComments(res.json.comments);
    } else {
      setComments([]);
    }
  }

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault();
    if (!newCommentText.trim() || !activeIssue) return;
    setPostingComment(true);

    const res = await Api.addIssueComment(owner, repo, activeIssue.id, newCommentText.trim());
    setPostingComment(false);
    if (res.ok) {
      setNewCommentText("");
      const updated = await Api.getIssueComments(owner, repo, activeIssue.id);
      if (updated.ok) setComments(updated.json.comments);
      toast("Comment posted", "info");
    }
  }

  async function handleToggleStatus() {
    if (!activeIssue) return;
    const nextStatus = activeIssue.status === "open" ? "closed" : "open";
    const res = await Api.updateIssue(owner, repo, activeIssue.id, { status: nextStatus });
    if (res.ok) {
      setActiveIssue({ ...activeIssue, status: nextStatus });
      toast(`Issue marked as ${nextStatus}`, "info");
      loadData();
    }
  }

  const filteredIssues = issues.filter((iss) => {
    const matchesStatus = statusFilter === "all" || iss.status === statusFilter;
    const matchesSearch =
      iss.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (iss.body || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      iss.author.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  const openCount = issues.filter((i) => i.status === "open").length;
  const closedCount = issues.filter((i) => i.status === "closed").length;

  return (
    <div className="space-y-4">
      {repoInfo && (
        <RepoHeader
          owner={owner}
          repo={repo}
          visibility={repoInfo.visibility}
          defaultBranch={repoInfo.default_branch || "main"}
          description={repoInfo.description}
        />
      )}

      <RepoTabs owner={owner} repo={repo} issuesCount={openCount} />

      {/* Issues Bar Controls */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          <div className="flex items-center rounded-sm border border-border-default bg-surface p-0.5 text-xs">
            <button
              onClick={() => setStatusFilter("open")}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xs text-[11px] transition-colors ${
                statusFilter === "open"
                  ? "bg-surface-active text-fg font-medium"
                  : "text-fg-muted hover:text-fg"
              }`}
            >
              <CircleDot className="h-3 w-3 text-success" />
              <span>{openCount} Open</span>
            </button>
            <button
              onClick={() => setStatusFilter("closed")}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xs text-[11px] transition-colors ${
                statusFilter === "closed"
                  ? "bg-surface-active text-fg font-medium"
                  : "text-fg-muted hover:text-fg"
              }`}
            >
              <CheckCircle2 className="h-3 w-3 text-merged" />
              <span>{closedCount} Closed</span>
            </button>
          </div>

          <div className="relative flex-1 sm:w-56">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-fg-subtle" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter issues…"
              className="w-full rounded-sm border border-border-default bg-surface py-1 pl-8 pr-3 text-xs text-fg placeholder-fg-subtle focus:border-border-emphasis focus:outline-none"
            />
          </div>
        </div>

        <button
          onClick={() => setNewIssueOpen(true)}
          className="w-full sm:w-auto flex items-center justify-center gap-1.5 rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>New issue</span>
        </button>
      </div>

      {/* Unboxed Issues Ledger */}
      <div className="border-t border-b border-border-subtle">
        {loading ? (
          <div className="py-12 text-center text-xs text-fg-muted font-mono animate-pulse">
            Loading issues…
          </div>
        ) : filteredIssues.length === 0 ? (
          <div className="py-12 text-center text-xs text-fg-muted font-mono">
            No matching issues found.
          </div>
        ) : (
          <div className="divide-y divide-border-subtle">
            {filteredIssues.map((iss) => (
              <div
                key={iss.id}
                onClick={() => openIssueDetail(iss)}
                className="group flex items-center justify-between gap-3 py-3 hover:bg-surface-hover/30 px-2 -mx-2 rounded-sm transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="shrink-0">
                    {iss.status === "open" ? (
                      <CircleDot className="h-3.5 w-3.5 text-success" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5 text-merged" />
                    )}
                  </div>

                  <div className="space-y-0.5 min-w-0">
                    <span className="text-xs font-medium text-fg group-hover:text-accent transition-colors truncate block">
                      {iss.title}
                    </span>
                    <div className="flex items-center gap-2 text-[11px] text-fg-subtle">
                      <span className="font-mono text-[10px]">#{iss.id.slice(0, 6)}</span>
                      <span>•</span>
                      <span>by {iss.author}</span>
                      <span>•</span>
                      <span>{new Date(iss.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="flex items-center gap-1 text-[11px] text-fg-muted">
                    <MessageSquare className="h-3 w-3 text-fg-subtle" />
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Active Issue Detail Modal */}
      {activeIssue && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 animate-fast">
          <div className="fixed inset-0" onClick={() => setActiveIssue(null)} />
          <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-md border border-border-default bg-surface-overlay shadow-2xl z-10 overflow-hidden">
            {/* Header */}
            <div className="flex items-start justify-between border-b border-border-subtle bg-surface p-4">
              <div className="space-y-1 pr-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-fg-muted">#{activeIssue.id.slice(0, 6)}</span>
                  <span className="inline-flex items-center gap-1 text-[11px] text-fg-muted capitalize">
                    {activeIssue.status === "open" ? <CircleDot className="h-2.5 w-2.5 text-success" /> : <CheckCircle2 className="h-2.5 w-2.5 text-merged" />}
                    <span>{activeIssue.status}</span>
                  </span>
                </div>
                <h2 className="text-sm font-semibold text-fg">{activeIssue.title}</h2>
                <div className="text-[11px] text-fg-muted">
                  Opened by <span className="text-fg-secondary">{activeIssue.author}</span> on{" "}
                  {new Date(activeIssue.created_at).toLocaleString()}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleToggleStatus}
                  className="rounded-xs border border-border-default bg-bg-subtle px-2.5 py-1 text-xs text-fg-secondary hover:border-border-emphasis hover:text-fg"
                >
                  {activeIssue.status === "open" ? "Close" : "Reopen"}
                </button>
                <button
                  onClick={() => setActiveIssue(null)}
                  className="text-fg-muted hover:text-fg p-1"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Body & Comments */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="rounded-xs border border-border-subtle bg-bg-subtle p-3 text-xs text-fg-secondary whitespace-pre-wrap leading-relaxed">
                {activeIssue.body || "No description provided."}
              </div>

              <div className="space-y-2">
                <div className="text-[11px] text-fg-muted uppercase font-medium">
                  Comments ({comments.length})
                </div>

                {loadingComments ? (
                  <div className="text-xs text-fg-muted font-mono">Loading comments…</div>
                ) : comments.length === 0 ? (
                  <div className="text-xs text-fg-subtle italic">No comments yet.</div>
                ) : (
                  comments.map((c) => (
                    <div key={c.id} className="rounded-xs border border-border-subtle bg-surface p-2.5 space-y-1">
                      <div className="flex items-center justify-between text-[11px] text-fg-muted">
                        <span className="font-medium text-fg-secondary">{c.author}</span>
                        <span className="text-[10px]">{new Date(c.created_at).toLocaleTimeString()}</span>
                      </div>
                      <p className="text-xs text-fg-secondary leading-relaxed whitespace-pre-wrap">{c.body}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Comment Form Footer */}
            <form onSubmit={handleAddComment} className="border-t border-border-subtle bg-surface p-3 flex gap-2">
              <input
                value={newCommentText}
                onChange={(e) => setNewCommentText(e.target.value)}
                placeholder="Leave a comment…"
                className="flex-1 rounded-sm border border-border-default bg-bg-subtle px-3 py-1.5 text-xs text-fg placeholder-fg-subtle focus:border-border-emphasis focus:outline-none"
              />
              <button
                type="submit"
                disabled={postingComment || !newCommentText.trim()}
                className="flex items-center gap-1 rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                <Send className="h-3 w-3" />
                <span>Comment</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* New Issue Modal */}
      {newIssueOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 animate-fast">
          <div className="fixed inset-0" onClick={() => setNewIssueOpen(false)} />
          <div className="relative w-full max-w-lg rounded-md border border-border-default bg-surface-overlay p-5 shadow-2xl z-10 space-y-3.5">
            <div className="flex items-center justify-between border-b border-border-subtle pb-3">
              <h2 className="text-xs font-semibold text-fg">
                Create New Issue
              </h2>
              <button
                onClick={() => setNewIssueOpen(false)}
                className="text-fg-muted hover:text-fg"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {issueError && (
              <div className="rounded-xs border border-danger-border bg-danger-subtle p-2 text-xs text-danger font-mono">
                {issueError}
              </div>
            )}

            <form onSubmit={handleCreateIssue} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-secondary">Title *</label>
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Detect merge conflicts cleanly"
                  required
                  autoFocus
                  className="w-full rounded-sm border border-border-default bg-surface px-3 py-1.5 text-xs text-fg placeholder-fg-subtle focus:border-border-emphasis focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-secondary">Description</label>
                <textarea
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                  placeholder="Description or context"
                  rows={4}
                  className="w-full rounded-sm border border-border-default bg-surface px-3 py-1.5 text-xs text-fg placeholder-fg-subtle focus:border-border-emphasis focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-subtle">
                <button
                  type="button"
                  onClick={() => setNewIssueOpen(false)}
                  className="rounded-sm border border-border-default bg-surface px-3 py-1.5 text-xs font-medium text-fg-secondary hover:bg-surface-hover"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingIssue}
                  className="rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  {creatingIssue ? "Submitting…" : "Submit issue"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
