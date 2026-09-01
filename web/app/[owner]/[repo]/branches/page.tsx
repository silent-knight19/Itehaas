"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { GitBranch, Copy } from "lucide-react";
import { Api } from "../../../../lib/api";
import { RepoHeader } from "../../../../components/RepoHeader";
import { RepoTabs } from "../../../../components/RepoTabs";
import { useToast } from "../../../../components/Toast";

export default function BranchesPage({
  params,
}: {
  params: { owner: string; repo: string };
}) {
  const { owner, repo } = params;
  const [repoInfo, setRepoInfo] = useState<any>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  async function loadData() {
    setLoading(true);
    try {
      const r = await Api.getRepo(owner, repo);
      if (r.ok) setRepoInfo(r.json.repo);

      const b = await Api.listBranches(owner, repo);
      if (b.ok && b.json.branches) {
        setBranches(b.json.branches);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [owner, repo]);

  function copyBranchCheckout(branch: string) {
    const cmd = `itehaas checkout ${branch}`;
    navigator.clipboard.writeText(cmd);
    toast(`Copied: ${cmd}`, "info");
  }

  const defaultBranch = repoInfo?.default_branch || "main";

  return (
    <div className="space-y-4">
      {repoInfo && (
        <RepoHeader
          owner={owner}
          repo={repo}
          visibility={repoInfo.visibility}
          defaultBranch={defaultBranch}
          description={repoInfo.description}
        />
      )}

      <RepoTabs owner={owner} repo={repo} />

      <div className="pt-2">
        <div className="flex items-center justify-between pb-3">
          <h2 className="text-xs font-semibold text-fg">
            Branches ({branches.length})
          </h2>
          <span className="text-[11px] text-fg-muted font-mono">
            Local refs
          </span>
        </div>

        {loading ? (
          <div className="py-12 text-center text-xs text-fg-muted font-mono animate-pulse border-t border-b border-border-subtle">
            Loading branches…
          </div>
        ) : branches.length === 0 ? (
          <div className="py-12 text-center text-xs text-fg-muted font-mono border-t border-b border-border-subtle">
            No branches found in this repository.
          </div>
        ) : (
          <div className="border-t border-b border-border-subtle divide-y divide-border-subtle">
            {branches.map((branch) => {
              const isDefault = branch === defaultBranch;
              return (
                <div
                  key={branch}
                  className="group flex items-center justify-between py-3 hover:bg-surface-hover/30 px-2 -mx-2 rounded-sm transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <GitBranch className="h-3.5 w-3.5 text-fg-muted shrink-0" />
                    <span className="font-mono text-xs font-medium text-fg truncate">
                      {branch}
                    </span>
                    {isDefault && (
                      <span className="rounded-xs border border-border-subtle bg-bg-subtle px-1.5 py-0.1 text-[10px] text-fg-muted">
                        default
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => copyBranchCheckout(branch)}
                      className="flex items-center gap-1 rounded-xs border border-border-default bg-surface px-2 py-0.5 text-[11px] text-fg-muted hover:border-border-emphasis hover:text-fg transition-colors"
                      title="Copy checkout command"
                    >
                      <Copy className="h-3 w-3" />
                      <span className="font-mono">checkout</span>
                    </button>

                    <Link
                      href={`/${owner}/${repo}?branch=${branch}`}
                      className="rounded-xs border border-border-default bg-surface px-2 py-0.5 text-xs text-fg-secondary hover:border-border-emphasis hover:text-fg transition-colors"
                    >
                      Browse →
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
