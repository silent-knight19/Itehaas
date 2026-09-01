"use client";
import React from "react";
import Link from "next/link";
import { Globe, Lock, GitBranch, Star } from "lucide-react";

interface PinnedRepo {
  id: string;
  name: string;
  description: string;
  visibility: string;
  default_branch: string;
  owner: string;
  stars_count: number;
  updated_at?: string;
}

export function PinnedRepos({ repos }: { repos: PinnedRepo[] }) {
  if (!repos || repos.length === 0) {
    return (
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-fg tracking-tight">Pinned repositories</h3>
        <div className="rounded-sm border border-border-subtle bg-surface p-6 text-center">
          <p className="text-xs text-fg-muted">No repositories pinned.</p>
          <p className="text-[11px] text-fg-subtle">Top repositories appear here.</p>
        </div>
      </div>
    );
  }

  const pinned = repos.slice(0, 4);

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-fg tracking-tight">Pinned repositories</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {pinned.map((r) => (
          <Link
            key={r.id}
            href={`/${r.owner}/${r.name}`}
            className="group flex flex-col gap-1.5 rounded-sm border border-border-subtle bg-surface p-3 hover:border-border-default hover:bg-surface-hover/50 transition-colors min-w-0"
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-xs font-medium text-fg group-hover:text-accent truncate">
                <span className="text-fg-muted font-normal">{r.owner}/</span>{r.name}
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] text-fg-subtle shrink-0">
                {r.visibility === "public" ? <Globe className="h-3 w-3 text-fg-muted" /> : <Lock className="h-3 w-3 text-fg-muted" />}
              </span>
            </div>
            <p className="text-xs text-fg-muted line-clamp-1 min-h-[16px]">
              {r.description || <span className="italic text-fg-subtle">No description</span>}
            </p>
            <div className="flex items-center gap-3 text-[11px] text-fg-subtle pt-0.5">
              <span className="inline-flex items-center gap-1 font-mono text-[10px]">
                <GitBranch className="h-3 w-3 text-fg-muted" /> {r.default_branch || "main"}
              </span>
              <span className="inline-flex items-center gap-1">
                <Star className="h-3 w-3 text-fg-muted" /> {r.stars_count}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
