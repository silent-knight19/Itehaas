"use client";
import React, { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  GitBranch,
  ChevronDown,
  Check,
  AlertCircle,
} from "lucide-react";
import { Api } from "../../../lib/api";
import { RepoHeader } from "../../../components/RepoHeader";
import { RepoTabs } from "../../../components/RepoTabs";
import { FileTree, TreeEntry } from "../../../components/FileTree";
import { FileViewer } from "../../../components/FileViewer";
import { MarkdownViewer } from "../../../components/MarkdownViewer";

type Params = { params: { owner: string; repo: string } };

function parseTreeHash(commitContent: string): string | null {
  const m = commitContent.match(/^tree ([0-9a-f]{64})$/m);
  return m ? m[1] : null;
}

function RepoPageContent({ params }: Params) {
  const { owner, repo } = params;
  const searchParams = useSearchParams();

  const [repoInfo, setRepoInfo] = useState<any>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>("main");
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
  const [commits, setCommits] = useState<any[]>([]);
  const [tree, setTree] = useState<TreeEntry[] | null>(null);
  const [fileContent, setFileContent] = useState<Record<string, string>>({});
  const [activeFile, setActiveFile] = useState<{ name: string; content: string } | null>(null);
  const [readme, setReadme] = useState<string | null>(null);
  const [stars, setStars] = useState<{ count: number; starred: boolean } | null>(null);
  const [issuesCount, setIssuesCount] = useState<number>(0);
  const [pullsCount, setPullsCount] = useState<number>(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const r = await Api.getRepo(owner, repo);
      if (!r.ok) {
        setError(r.json?.error || "Repository not found.");
        setLoading(false);
        return;
      }
      setRepoInfo(r.json.repo);
      const queryBranch = searchParams.get("branch");
      setSelectedBranch(queryBranch || r.json.repo.default_branch || "main");

      const b = await Api.listBranches(owner, repo);
      if (b.ok && b.json.branches) setBranches(b.json.branches);

      const l = await Api.log(owner, repo);
      if (l.ok && l.json.commits) setCommits(l.json.commits);

      const s = await Api.getStars(owner, repo);
      if (s.ok) setStars(s.json);

      const iss = await Api.listIssues(owner, repo, "open");
      if (iss.ok && iss.json.issues) setIssuesCount(iss.json.issues.length);

      const pls = await Api.listPulls(owner, repo);
      if (pls.ok && pls.json.pulls) {
        setPullsCount(pls.json.pulls.filter((p: any) => p.status === "open").length);
      }
    } catch (e: any) {
      setError(e.message || "Failed to load repository.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [owner, repo, searchParams]);

  // Load Tree when commits arrive
  useEffect(() => {
    async function loadTreeData() {
      if (!commits || commits.length === 0) return;
      const headHash = commits[0].hash;
      if (!/^[0-9a-f]{64}$/.test(headHash)) return;

      const commitObj = await Api.tree(owner, repo, headHash);
      if (commitObj.ok) {
        const th = parseTreeHash(commitObj.json.content);
        if (th) {
          const treeObj = await Api.tree(owner, repo, th);
          if (treeObj.ok) {
            const entries: TreeEntry[] = [];
            for (const line of treeObj.json.content.trim().split("\n")) {
              const m = line.trim().match(/^(\d{5,6})\s+([0-9a-f]{64})\s+(.+)$/);
              if (m) {
                entries.push({ mode: m[1], hash: m[2], name: m[3] });
              }
            }
            setTree(entries);

            const readmeEntry = entries.find((e) => /^readme\.md$/i.test(e.name));
            if (readmeEntry) {
              const rContent = await Api.tree(owner, repo, readmeEntry.hash);
              if (rContent.ok) setReadme(rContent.json.content);
            }
          }
        }
      }
    }
    loadTreeData();
  }, [commits, owner, repo]);

  async function handleSelectFile(hash: string, name: string) {
    if (fileContent[name]) {
      setActiveFile({ name, content: fileContent[name] });
      return;
    }
    const r = await Api.tree(owner, repo, hash);
    if (r.ok) {
      const content = r.json.content;
      setFileContent((prev) => ({ ...prev, [name]: content }));
      setActiveFile({ name, content });
    }
  }

  if (loading) {
    return (
      <div className="py-12 text-center text-xs text-fg-muted font-mono animate-pulse">
        Loading repository…
      </div>
    );
  }

  if (error || !repoInfo) {
    return (
      <div className="rounded-sm border border-danger-border bg-danger-subtle p-6 text-center space-y-3">
        <AlertCircle className="mx-auto h-5 w-5 text-danger" />
        <p className="text-xs text-danger font-mono">{error || "Repository not found"}</p>
        <Link href="/" className="inline-block rounded-xs bg-surface border border-border-default px-3 py-1 text-xs text-fg">
          ← Back to repositories
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <RepoHeader
        owner={owner}
        repo={repo}
        visibility={repoInfo.visibility}
        defaultBranch={repoInfo.default_branch || "main"}
        description={repoInfo.description}
        starsCount={stars?.count ?? 0}
        isStarred={stars?.starred ?? false}
      />

      <RepoTabs
        owner={owner}
        repo={repo}
        issuesCount={issuesCount}
        pullsCount={pullsCount}
      />

      {/* Branch Selector Bar */}
      <div className="flex items-center justify-between gap-4 pt-1">
        <div className="relative">
          <button
            onClick={() => setBranchDropdownOpen(!branchDropdownOpen)}
            className="flex items-center gap-1.5 rounded-xs border border-border-default bg-surface px-2.5 py-1 text-xs font-mono text-fg hover:border-border-emphasis transition-colors"
          >
            <GitBranch className="h-3 w-3 text-fg-muted" />
            <span>{selectedBranch}</span>
            <ChevronDown className="h-3 w-3 text-fg-subtle" />
          </button>

          {branchDropdownOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setBranchDropdownOpen(false)} />
              <div className="absolute left-0 top-full mt-1 z-40 w-48 rounded-sm border border-border-default bg-surface-overlay p-1 shadow-xl space-y-0.5 animate-fast">
                <div className="px-2 py-1 text-[10px] text-fg-muted uppercase border-b border-border-subtle mb-0.5">
                  Branches
                </div>
                {(branches.length > 0 ? branches : [selectedBranch]).map((b) => (
                  <button
                    key={b}
                    onClick={() => {
                      setSelectedBranch(b);
                      setBranchDropdownOpen(false);
                    }}
                    className={`w-full flex items-center justify-between rounded-xs px-2 py-1 text-xs font-mono text-left transition-colors ${
                      selectedBranch === b ? "bg-surface-active text-fg font-medium" : "text-fg-secondary hover:bg-surface-hover"
                    }`}
                  >
                    <span>{b}</span>
                    {selectedBranch === b && <Check className="h-3 w-3" />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 text-[11px] text-fg-subtle">
          <span className="font-mono">{commits.length} commits</span>
          <span>•</span>
          <Link href={`/${owner}/${repo}/commits`} className="text-fg-muted hover:text-fg transition-colors">
            View history →
          </Link>
        </div>
      </div>

      {/* Code Browser Stack */}
      <div className="space-y-4 pt-1">
        {activeFile && (
          <FileViewer
            fileName={activeFile.name}
            content={activeFile.content}
            onClose={() => setActiveFile(null)}
          />
        )}

        <FileTree
          entries={tree || []}
          onSelectFile={handleSelectFile}
          selectedFileName={activeFile?.name}
          latestCommit={commits[0] || null}
        />

        {readme && <MarkdownViewer content={readme} title="README.md" />}
      </div>
    </div>
  );
}

export default function RepoPage(props: Params) {
  return (
    <Suspense fallback={<div className="py-12 text-center text-xs text-fg-muted">Loading repository…</div>}>
      <RepoPageContent {...props} />
    </Suspense>
  );
}
