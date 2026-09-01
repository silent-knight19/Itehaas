"use client";
import React from "react";
import { GitCommit, Copy, ShieldCheck, Clock } from "lucide-react";
import { useToast } from "./Toast";
import { formatCommitDate } from "../lib/formatDate";

export interface CommitItem {
  hash: string;
  message: string;
  author?: string;
  date?: string;
}

interface CommitListProps {
  commits: CommitItem[];
}

export function CommitList({ commits }: CommitListProps) {
  const { toast } = useToast();

  function copyHash(hash: string) {
    navigator.clipboard.writeText(hash);
    toast(`Copied ${hash.slice(0, 7)}`, "info");
  }

  if (commits.length === 0) {
    return (
      <div className="py-12 text-center text-xs text-fg-muted font-mono border-t border-b border-border-subtle">
        No commits found on this branch.
      </div>
    );
  }

  return (
    <div className="border-t border-b border-border-subtle divide-y divide-border-subtle">
      {commits.map((commit) => (
        <div
          key={commit.hash}
          className="group flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3 hover:bg-surface-hover/30 px-2 -mx-2 rounded-sm transition-colors"
        >
          <div className="flex items-start gap-3 min-w-0">
            <div className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center text-fg-muted">
              <GitCommit className="h-3.5 w-3.5" />
            </div>

            <div className="min-w-0 space-y-0.5">
              <p className="text-xs font-medium text-fg group-hover:text-accent transition-colors truncate">
                {commit.message}
              </p>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-muted">
                <span className="text-fg-secondary">
                  {commit.author?.split("<")[0].trim() || "Author"}
                </span>
                {commit.date &&
                  (() => {
                    const { relative, absolute, hasDate } = formatCommitDate(commit.date);
                    return (
                      <>
                        <span>•</span>
                        <span
                          className="inline-flex items-center gap-1 text-fg-subtle"
                          title={hasDate ? absolute : commit.date!}
                        >
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
            <button
              onClick={() => copyHash(commit.hash)}
              className="flex items-center gap-1 rounded-xs border border-border-default bg-surface px-2 py-0.5 font-mono text-[11px] text-fg-secondary hover:border-border-emphasis hover:text-fg transition-colors"
              title={`Copy hash: ${commit.hash}`}
            >
              <span>{commit.hash.slice(0, 7)}</span>
              <Copy className="h-3 w-3 text-fg-muted" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
