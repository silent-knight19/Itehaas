"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { GitCommit, Copy, Clock, ArrowRight } from "lucide-react";
import { Api } from "../../../../lib/api";
import { RepoHeader } from "../../../../components/RepoHeader";
import { RepoTabs } from "../../../../components/RepoTabs";
import { CommitList, CommitItem } from "../../../../components/CommitList";
import { useToast } from "../../../../components/Toast";
import { formatCommitDate } from "../../../../lib/formatDate";

export default function CommitsPage({
  params,
}: {
  params: { owner: string; repo: string };
}) {
  const { owner, repo } = params;
  const [repoInfo, setRepoInfo] = useState<any>(null);
  const [commits, setCommits] = useState<CommitItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastIdx, setLastIdx] = useState<number | null>(null);
  const { toast } = useToast();

  async function loadData() {
    setLoading(true);
    try {
      const r = await Api.getRepo(owner, repo);
      if (r.ok) setRepoInfo(r.json.repo);

      const l = await Api.log(owner, repo);
      if (l.ok && l.json.commits) {
        setCommits(l.json.commits);
      } else {
        setError(l.json?.error || "Failed to load commits.");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [owner, repo]);

  function toggleSelect(hash: string, idx: number, shift: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (shift && lastIdx !== null) {
        const [a, b] = [Math.min(lastIdx, idx), Math.max(lastIdx, idx)];
        const range = commits.slice(a, b + 1).map((c) => c.hash);
        const allSelected = range.every((h) => next.has(h));
        if (allSelected) range.forEach((h) => next.delete(h));
        else range.forEach((h) => next.add(h));
      } else {
        if (next.has(hash)) next.delete(hash);
        else {
          if (next.size >= 2) {
            // replace oldest
            const arr = Array.from(next);
            next.delete(arr[0]);
          }
          next.add(hash);
        }
      }
      return new Set(Array.from(next).slice(-2));
    });
    setLastIdx(idx);
  }

  function copyHash(hash: string) {
    navigator.clipboard.writeText(hash);
    toast(`Copied ${hash.slice(0, 7)}`, "info");
  }

  const selArr = Array.from(selected);
  const canCompare = selArr.length === 2;
  const canView = selArr.length === 1;

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

      <RepoTabs owner={owner} repo={repo} />

      <div className="pt-2">
        <div className="flex items-center justify-between pb-3">
          <h2 className="text-xs font-semibold text-fg">
            Commit History ({commits.length})
          </h2>
          <span className="text-[11px] text-fg-muted font-mono">
            Select 1–2 to compare • click hash to view
          </span>
        </div>

        {loading ? (
          <div className="py-12 text-center text-xs text-fg-muted font-mono animate-pulse border-t border-b border-border-subtle">
            Loading commits…
          </div>
        ) : error ? (
          <div className="rounded-xs border border-danger-border bg-danger-subtle p-3 text-xs text-danger font-mono">
            {error}
          </div>
        ) : (
          <div className="border-t border-b border-border-subtle divide-y divide-border-subtle">
            {commits.map((commit, idx) => {
              const isSel = selected.has(commit.hash);
              return (
                <div
                  key={commit.hash}
                  className={`group flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3 px-2 -mx-2 rounded-sm transition-colors ${isSel ? "bg-accent-subtle/50" : "hover:bg-surface-hover/30"}`}
                >
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={(e) => toggleSelect(commit.hash, idx, (e.nativeEvent as any).shiftKey)}
                      onClick={(e) => {
                        // shift handled via onChange
                      }}
                      className="mt-1.5 h-3.5 w-3.5 rounded-sm border-border-subtle"
                    />
                    <div className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center text-fg-muted">
                      <GitCommit className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 space-y-0.5 flex-1">
                      <Link
                        href={`/${owner}/${repo}/commit/${commit.hash}`}
                        className="block text-xs font-medium text-fg group-hover:text-accent transition-colors truncate hover:underline"
                      >
                        {commit.message}
                      </Link>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-muted">
                        <span className="text-fg-secondary">{commit.author?.split("<")[0].trim() || "Author"}</span>
                        {commit.date &&
                          (() => {
                            const { relative, absolute, hasDate } = formatCommitDate(commit.date);
                            return (
                              <>
                                <span>•</span>
                                <span className="inline-flex items-center gap-1 text-fg-subtle" title={hasDate ? absolute : commit.date!}>
                                  <Clock className="h-3 w-3" />
                                  <span>{relative}</span>
                                </span>
                              </>
                            );
                          })()}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                    <Link
                      href={`/${owner}/${repo}/commit/${commit.hash}`}
                      className="px-2 py-1 text-[11px] font-medium border border-border-subtle rounded-sm bg-surface hover:bg-surface-hover text-fg"
                    >
                      View
                    </Link>
                    <button
                      onClick={() => copyHash(commit.hash)}
                      className="flex items-center gap-1 rounded-xs border border-border-default bg-surface px-2 py-1 font-mono text-[11px] text-fg-secondary hover:border-border-emphasis hover:text-fg transition-colors"
                      title={`Copy hash: ${commit.hash}`}
                    >
                      <span>{commit.hash.slice(0, 7)}</span>
                      <Copy className="h-3 w-3 text-fg-muted" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Sticky compare bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-surface border border-border-subtle shadow-lg rounded-md px-4 py-2">
          <span className="text-xs font-mono text-fg-muted">{selected.size} selected</span>
          {canView && (
            <Link
              href={`/${owner}/${repo}/commit/${selArr[0]}`}
              className="px-3 py-1.5 text-xs font-medium bg-accent text-white rounded-sm hover:bg-accent-hover"
            >
              View commit
            </Link>
          )}
          {canCompare && (
            <Link
              href={`/${owner}/${repo}/compare/${selArr[0]}...${selArr[1]}`}
              className="px-3 py-1.5 text-xs font-medium bg-accent text-white rounded-sm hover:bg-accent-hover flex items-center gap-1"
            >
              Compare <ArrowRight className="h-3 w-3" />
            </Link>
          )}
          {selected.size === 2 && (
            <Link
              href={`/${owner}/${repo}/compare/${selArr[1]}...${selArr[0]}`}
              className="px-2 py-1 text-xs border border-border-subtle rounded-sm hover:bg-surface-hover text-fg-muted"
              title="Swap"
            >
              Swap
            </Link>
          )}
          <button onClick={() => setSelected(new Set())} className="text-xs text-fg-muted hover:text-fg px-2">
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
