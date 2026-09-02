"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { GitCompare } from "lucide-react";
import { Api } from "../../../../lib/api";
import { RepoHeader } from "../../../../components/RepoHeader";
import { RepoTabs } from "../../../../components/RepoTabs";

export default function ComparePickerPage({ params }: { params: { owner: string; repo: string } }) {
  const { owner, repo } = params;
  const [repoInfo, setRepoInfo] = useState<any>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [baseInput, setBaseInput] = useState("");
  const [headInput, setHeadInput] = useState("");

  useEffect(() => {
    async function load() {
      const r = await Api.getRepo(owner, repo);
      if (r.ok) setRepoInfo(r.json.repo);
      const b = await Api.listBranches(owner, repo);
      if (b.ok && b.json.branches) setBranches(b.json.branches);
    }
    load();
  }, [owner, repo]);

  return (
    <div className="space-y-4">
      {repoInfo && <RepoHeader owner={owner} repo={repo} visibility={repoInfo.visibility} defaultBranch={repoInfo.default_branch} description={repoInfo.description} />}
      <RepoTabs owner={owner} repo={repo} />
      <div className="pt-4 border border-border-subtle rounded-sm p-6 bg-surface">
        <h2 className="text-sm font-semibold text-fg flex items-center gap-2">
          <GitCompare className="h-4 w-4" /> Compare changes
        </h2>
        <p className="text-xs text-fg-muted mt-1">Select two branches or commits to see what changed.</p>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-fg">Base</label>
            <select value={baseInput} onChange={(e) => setBaseInput(e.target.value)} className="mt-1 w-full px-2 py-1.5 text-xs bg-surface border border-border-subtle rounded-sm">
              <option value="">Select base</option>
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
            <input placeholder="or commit hash" value={baseInput} onChange={(e) => setBaseInput(e.target.value)} className="mt-2 w-full px-2 py-1 text-xs font-mono bg-bg-subtle border border-border-subtle rounded-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-fg">Head</label>
            <select value={headInput} onChange={(e) => setHeadInput(e.target.value)} className="mt-1 w-full px-2 py-1.5 text-xs bg-surface border border-border-subtle rounded-sm">
              <option value="">Select head</option>
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
            <input placeholder="or commit hash" value={headInput} onChange={(e) => setHeadInput(e.target.value)} className="mt-2 w-full px-2 py-1 text-xs font-mono bg-bg-subtle border border-border-subtle rounded-sm" />
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <Link
            href={baseInput && headInput ? `/${owner}/${repo}/compare/${encodeURIComponent(baseInput)}...${encodeURIComponent(headInput)}` : "#"}
            className={`px-3 py-1.5 text-xs font-medium rounded-sm ${baseInput && headInput ? "bg-accent text-white hover:bg-accent-hover" : "bg-surface border border-border-subtle text-fg-muted pointer-events-none"}`}
          >
            Compare
          </Link>
          <Link href={`/${owner}/${repo}/commits`} className="px-3 py-1.5 text-xs border border-border-subtle rounded-sm hover:bg-surface-hover">
            Back to commits
          </Link>
        </div>
      </div>
    </div>
  );
}
