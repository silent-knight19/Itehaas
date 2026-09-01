"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { GitCommit } from "lucide-react";
import { Api } from "../../../../lib/api";
import { RepoHeader } from "../../../../components/RepoHeader";
import { RepoTabs } from "../../../../components/RepoTabs";
import { CommitList, CommitItem } from "../../../../components/CommitList";

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
            HEAD revision
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
          <CommitList commits={commits} />
        )}
      </div>
    </div>
  );
}
