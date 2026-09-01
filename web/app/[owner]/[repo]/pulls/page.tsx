"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  GitPullRequest,
  GitMerge,
  Plus,
  ArrowRight,
  X,
  Send,
  AlertCircle,
} from "lucide-react";
import { Api } from "../../../../lib/api";
import { RepoHeader } from "../../../../components/RepoHeader";
import { RepoTabs } from "../../../../components/RepoTabs";
import { DiffViewer } from "../../../../components/DiffViewer";
import { useToast } from "../../../../components/Toast";

interface Pull {
  id: string;
  title: string;
  body?: string;
  source_branch: string;
  target_branch: string;
  status: "open" | "merged" | "closed";
  created_at: string;
  author: string;
}

interface Comment {
  id: string;
  body: string;
  created_at: string;
  author: string;
}

export default function PullsPage({
  params,
}: {
  params: { owner: string; repo: string };
}) {
  const { owner, repo } = params;

  const [repoInfo, setRepoInfo] = useState<any>(null);
  const [pulls, setPulls] = useState<Pull[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Active PR Viewer
  const [activePull, setActivePull] = useState<Pull | null>(null);
  const [diffText, setDiffText] = useState<string>("");
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeMessage, setMergeMessage] = useState<{ text: string; success: boolean } | null>(null);

  // PR Comments
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);

  // New PR Modal
  const [newPROpen, setNewPROpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [sourceBranch, setSourceBranch] = useState("");
  const [targetBranch, setTargetBranch] = useState("main");
  const [creatingPR, setCreatingPR] = useState(false);
  const [prError, setPRError] = useState<string | null>(null);

  const { toast } = useToast();

  async function loadData() {
    setLoading(true);
    try {
      const r = await Api.getRepo(owner, repo);
      if (r.ok) setRepoInfo(r.json.repo);

      const b = await Api.listBranches(owner, repo);
      if (b.ok && b.json.branches) {
        setBranches(b.json.branches);
        if (b.json.branches.length > 0) {
          const nonMain = b.json.branches.find((br: string) => br !== "main");
          if (nonMain) setSourceBranch(nonMain);
        }
      }

      const res = await Api.listPulls(owner, repo);
      if (res.ok && res.json.pulls) {
        setPulls(res.json.pulls);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [owner, repo]);

  async function openPRDetail(pr: Pull) {
    setActivePull(pr);
    setMergeMessage(null);
    setLoadingDiff(true);

    try {
      const d = await Api.getPullDiff(owner, repo, pr.id);
      if (d.ok) {
        setDiffText(d.json.diff || "");
      } else {
        setDiffText("");
      }

      const c = await Api.getPullComments(owner, repo, pr.id);
      if (c.ok && c.json.comments) {
        setComments(c.json.comments);
      } else {
        setComments([]);
      }
    } finally {
      setLoadingDiff(false);
    }
  }

  async function handleCreatePR(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim() || !sourceBranch) return;
    setCreatingPR(true);
    setPRError(null);

    const res = await Api.createPull(owner, repo, {
      title: newTitle.trim(),
      source_branch: sourceBranch,
      target_branch: targetBranch,
    });

    setCreatingPR(false);
    if (res.ok) {
      setNewTitle("");
      setNewPROpen(false);
      toast("Pull request created", "success");
      loadData();
    } else {
      setPRError(res.json?.error || "Failed to create PR");
    }
  }

  async function handleMerge() {
    if (!activePull) return;
    setMerging(true);
    setMergeMessage(null);

    const res = await Api.mergePull(owner, repo, activePull.id);
    setMerging(false);

    if (res.ok) {
      setMergeMessage({ text: "Merged successfully into target branch.", success: true });
      setActivePull({ ...activePull, status: "merged" });
      toast("Pull request merged", "success");
      loadData();
    } else {
      setMergeMessage({ text: res.json?.error || "Merge conflict or execution error.", success: false });
    }
  }

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault();
    if (!commentText.trim() || !activePull) return;
    setSubmittingComment(true);

    const res = await Api.addPullComment(owner, repo, activePull.id, commentText.trim());
    setSubmittingComment(false);
    if (res.ok) {
      setCommentText("");
      const updated = await Api.getPullComments(owner, repo, activePull.id);
      if (updated.ok) setComments(updated.json.comments);
      toast("Comment posted", "info");
    }
  }

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

      <RepoTabs owner={owner} repo={repo} pullsCount={pulls.filter((p) => p.status === "open").length} />

      {/* PR Header Controls */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold text-fg">
            Pull Requests ({pulls.length})
          </h2>
        </div>

        <button
          onClick={() => setNewPROpen(true)}
          className="flex items-center gap-1.5 rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>New pull request</span>
        </button>
      </div>

      {/* Unboxed Pull Requests Ledger */}
      <div className="border-t border-b border-border-subtle">
        {loading ? (
          <div className="py-12 text-center text-xs text-fg-muted font-mono animate-pulse">
            Loading pull requests…
          </div>
        ) : pulls.length === 0 ? (
          <div className="py-12 text-center text-xs text-fg-muted font-mono">
            No pull requests found.
          </div>
        ) : (
          <div className="divide-y divide-border-subtle">
            {pulls.map((pr) => (
              <div
                key={pr.id}
                onClick={() => openPRDetail(pr)}
                className="group flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3 hover:bg-surface-hover/30 px-2 -mx-2 rounded-sm transition-colors cursor-pointer"
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <div className="mt-0.5 shrink-0">
                    {pr.status === "merged" ? (
                      <GitMerge className="h-3.5 w-3.5 text-merged" />
                    ) : pr.status === "open" ? (
                      <GitPullRequest className="h-3.5 w-3.5 text-success" />
                    ) : (
                      <AlertCircle className="h-3.5 w-3.5 text-fg-muted" />
                    )}
                  </div>

                  <div className="space-y-0.5 min-w-0">
                    <span className="text-xs font-medium text-fg group-hover:text-accent transition-colors truncate block">
                      {pr.title}
                    </span>
                    <div className="flex items-center gap-2 text-[11px] font-mono text-fg-subtle">
                      <span className="text-fg-secondary">{pr.source_branch}</span>
                      <ArrowRight className="h-3 w-3 text-fg-subtle" />
                      <span>{pr.target_branch}</span>
                      <span>•</span>
                      <span>by {pr.author}</span>
                      <span>•</span>
                      <span>{new Date(pr.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  <span className="capitalize text-[11px] font-mono text-fg-muted">
                    {pr.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Active PR Detail / Diff Inspector Modal */}
      {activePull && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 animate-fast">
          <div className="fixed inset-0" onClick={() => setActivePull(null)} />
          <div className="relative w-full max-w-4xl max-h-[90vh] flex flex-col rounded-md border border-border-default bg-surface-overlay shadow-2xl z-10 overflow-hidden">
            {/* Header */}
            <div className="flex items-start justify-between border-b border-border-subtle bg-surface p-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-fg-muted">#{activePull.id.slice(0, 6)}</span>
                  <span className="text-[11px] font-mono capitalize text-fg-muted">
                    {activePull.status}
                  </span>
                </div>
                <h2 className="text-sm font-semibold text-fg">{activePull.title}</h2>
                <div className="flex items-center gap-1.5 font-mono text-[11px] text-fg-muted">
                  <span className="text-fg-secondary">{activePull.source_branch}</span>
                  <span>into</span>
                  <span className="text-fg-secondary">{activePull.target_branch}</span>
                  <span>•</span>
                  <span>by {activePull.author}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {activePull.status === "open" && (
                  <button
                    onClick={handleMerge}
                    disabled={merging}
                    className="flex items-center gap-1.5 rounded-sm bg-merged px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    <GitMerge className="h-3.5 w-3.5" />
                    <span>{merging ? "Merging…" : "Merge pull request"}</span>
                  </button>
                )}
                <button
                  onClick={() => setActivePull(null)}
                  className="rounded-xs p-1 text-fg-muted hover:text-fg"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Merge Status Banner */}
            {mergeMessage && (
              <div
                className={`p-2.5 text-xs font-mono border-b ${
                  mergeMessage.success
                    ? "border-success-border bg-success-subtle text-success"
                    : "border-danger-border bg-danger-subtle text-danger"
                }`}
              >
                {mergeMessage.text}
              </div>
            )}

            {/* Scrollable Body: Diff + Discussion */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="space-y-1.5">
                <div className="text-[11px] text-fg-muted uppercase font-medium">
                  Changes
                </div>
                {loadingDiff ? (
                  <div className="text-xs text-fg-muted font-mono">Computing diff…</div>
                ) : (
                  <DiffViewer diffText={diffText} />
                )}
              </div>

              {/* Discussion / Comments */}
              <div className="space-y-2 pt-2 border-t border-border-subtle">
                <div className="text-[11px] text-fg-muted uppercase font-medium">
                  Discussion ({comments.length})
                </div>

                {comments.length === 0 ? (
                  <div className="text-xs text-fg-subtle italic">No review comments yet.</div>
                ) : (
                  comments.map((c) => (
                    <div key={c.id} className="rounded-xs border border-border-subtle bg-surface p-2.5 space-y-1">
                      <div className="flex items-center justify-between text-[11px] text-fg-muted">
                        <span className="font-medium text-fg-secondary">{c.author}</span>
                        <span className="text-[10px] font-mono">{new Date(c.created_at).toLocaleTimeString()}</span>
                      </div>
                      <p className="text-xs text-fg-secondary leading-relaxed whitespace-pre-wrap">{c.body}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Comment Form */}
            <form onSubmit={handleAddComment} className="border-t border-border-subtle bg-surface p-3 flex gap-2">
              <input
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Leave review feedback…"
                className="flex-1 rounded-sm border border-border-default bg-bg-subtle px-3 py-1.5 text-xs text-fg placeholder-fg-subtle focus:border-border-emphasis focus:outline-none"
              />
              <button
                type="submit"
                disabled={submittingComment || !commentText.trim()}
                className="flex items-center gap-1 rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                <Send className="h-3 w-3" />
                <span>Submit</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* New PR Modal */}
      {newPROpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 animate-fast">
          <div className="fixed inset-0" onClick={() => setNewPROpen(false)} />
          <div className="relative w-full max-w-lg rounded-md border border-border-default bg-surface-overlay p-5 shadow-2xl z-10 space-y-3.5">
            <div className="flex items-center justify-between border-b border-border-subtle pb-3">
              <h2 className="text-xs font-semibold text-fg">
                Create Pull Request
              </h2>
              <button
                onClick={() => setNewPROpen(false)}
                className="text-fg-muted hover:text-fg"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {prError && (
              <div className="rounded-xs border border-danger-border bg-danger-subtle p-2 text-xs text-danger font-mono">
                {prError}
              </div>
            )}

            <form onSubmit={handleCreatePR} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-secondary">Title *</label>
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Add greeting helper function"
                  required
                  autoFocus
                  className="w-full rounded-sm border border-border-default bg-surface px-3 py-1.5 text-xs text-fg placeholder-fg-subtle focus:border-border-emphasis focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-secondary">Source Branch</label>
                  <select
                    value={sourceBranch}
                    onChange={(e) => setSourceBranch(e.target.value)}
                    className="w-full rounded-sm border border-border-default bg-surface px-2.5 py-1.5 text-xs font-mono text-fg focus:border-border-emphasis focus:outline-none"
                  >
                    {branches.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-secondary">Target Branch</label>
                  <select
                    value={targetBranch}
                    onChange={(e) => setTargetBranch(e.target.value)}
                    className="w-full rounded-sm border border-border-default bg-surface px-2.5 py-1.5 text-xs font-mono text-fg focus:border-border-emphasis focus:outline-none"
                  >
                    {branches.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                    {!branches.includes("main") && <option value="main">main</option>}
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-subtle">
                <button
                  type="button"
                  onClick={() => setNewPROpen(false)}
                  className="rounded-sm border border-border-default bg-surface px-3 py-1.5 text-xs font-medium text-fg-secondary hover:bg-surface-hover"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingPR || !sourceBranch}
                  className="rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  {creatingPR ? "Creating…" : "Create pull request"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
