"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Api } from "../../../../../lib/api";
import { RepoHeader } from "../../../../../components/RepoHeader";
import { RepoTabs } from "../../../../../components/RepoTabs";
import { CommitHeader } from "../../../../../components/CommitHeader";
import { DiffViewer } from "../../../../../components/DiffViewer";

export default function CommitPage({
  params,
}: {
  params: { owner: string; repo: string; hash: string };
}) {
  const { owner, repo, hash } = params;
  const [repoInfo, setRepoInfo] = useState<any>(null);
  const [commitData, setCommitData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const r = await Api.getRepo(owner, repo);
        if (r.ok) setRepoInfo(r.json.repo);
        const c = await Api.getCommit(owner, repo, hash);
        if (c.ok) {
          setCommitData(c.json);
        } else {
          setError(c.json?.error || "Commit not found");
        }
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [owner, repo, hash]);

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
        <Link href={`/${owner}/${repo}/commits`} className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg mb-3">
          <ArrowLeft className="h-3 w-3" /> Back to commits
        </Link>

        {loading ? (
          <div className="py-12 flex items-center justify-center gap-2 text-xs text-fg-muted font-mono border border-border-subtle rounded-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading commit…
          </div>
        ) : error ? (
          <div className="rounded-sm border border-danger-border bg-danger-subtle p-4 text-xs text-danger font-mono">{error}</div>
        ) : commitData ? (
          <div className="space-y-4">
            <CommitHeader
              owner={owner}
              repo={repo}
              commit={{
                hash: commitData.commit.hash,
                author: commitData.commit.author,
                committer: commitData.commit.committer,
                message: commitData.commit.message,
                parents: commitData.commit.parents || [],
                date: commitData.commit.date,
              }}
              stats={commitData.stats}
              parent={commitData.parent}
            />

            {commitData.files && commitData.files.length > 0 ? (
              <DiffViewer files={commitData.files} stats={commitData.stats} />
            ) : (
              <div className="py-8 text-center text-xs text-fg-muted font-mono border border-border-subtle rounded-sm">
                No changes in this commit.
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
