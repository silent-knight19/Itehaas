"use client";
import React, { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
  GitBranch,
  ChevronDown,
  Check,
  AlertCircle,
  Folder,
  FileText,
  ArrowLeft,
} from "lucide-react";
import { Api } from "../../../lib/api";
import { RepoHeader } from "../../../components/RepoHeader";
import { RepoTabs } from "../../../components/RepoTabs";
import { FileTree, TreeEntry } from "../../../components/FileTree";
import { FileViewer } from "../../../components/FileViewer";
import { MarkdownViewer } from "../../../components/MarkdownViewer";

type Params = { params: { owner: string; repo: string } };

function parseTreeHash(commitContent: string): string | null {
  const m = commitContent.match(/^tree ([0-9a-f]{40,64})$/m);
  return m ? m[1] : null;
}

function RepoPageContent({ params }: Params) {
  const { owner, repo } = params;
  const searchParams = useSearchParams();
  const router = useRouter();

  const [repoInfo, setRepoInfo] = useState<any>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>("main");
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
  const [commits, setCommits] = useState<any[]>([]);
  const [tree, setTree] = useState<TreeEntry[] | null>(null);
  const [fileContent, setFileContent] = useState<Record<string, string>>({});
  const [activeFile, setActiveFile] = useState<{ name: string; content: string; path: string } | null>(null);
  const [readme, setReadme] = useState<string | null>(null);
  const [stars, setStars] = useState<{ count: number; starred: boolean } | null>(null);
  const [issuesCount, setIssuesCount] = useState<number>(0);
  const [pullsCount, setPullsCount] = useState<number>(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const currentPath = searchParams.get("path") || "";

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

  // Helper to fetch tree at path
  async function fetchTreeAtPath(rootTreeHash: string, targetPath: string): Promise<TreeEntry[] | null> {
    if (!targetPath) {
      const treeObj = await Api.tree(owner, repo, rootTreeHash);
      if (!treeObj.ok) return null;
      const entries: TreeEntry[] = [];
      for (const line of treeObj.json.content.trim().split("\n")) {
        const m = line.trim().match(/^(\d{5,6})\s+([0-9a-f]{40,64})\s+(.+)$/);
        if (m) entries.push({ mode: m[1], hash: m[2], name: m[3] });
      }
      return entries;
    }
    // Walk path segments
    let curHash = rootTreeHash;
    const parts = targetPath.split("/").filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      const treeObj = await Api.tree(owner, repo, curHash);
      if (!treeObj.ok) return null;
      let found: TreeEntry | null = null;
      for (const line of treeObj.json.content.trim().split("\n")) {
        const m = line.trim().match(/^(\d{5,6})\s+([0-9a-f]{40,64})\s+(.+)$/);
        if (m && m[3] === parts[i]) {
          found = { mode: m[1], hash: m[2], name: m[3] };
          break;
        }
      }
      if (!found) return null;
      if (i === parts.length - 1) {
        // Last part: if it's a tree (dir), fetch its entries
        if (found.mode === "40000") {
          const sub = await Api.tree(owner, repo, found.hash);
          if (!sub.ok) return null;
          const entries: TreeEntry[] = [];
          for (const line of sub.json.content.trim().split("\n")) {
            const m2 = line.trim().match(/^(\d{5,6})\s+([0-9a-f]{40,64})\s+(.+)$/);
            if (m2) entries.push({ mode: m2[1], hash: m2[2], name: m2[3] });
          }
          return entries;
        } else {
          // It's a file, not a dir
          return null;
        }
      } else {
        if (found.mode !== "40000") return null;
        curHash = found.hash;
      }
    }
    return null;
  }

  // Load Tree when commits arrive or path changes
  useEffect(() => {
    async function loadTreeData() {
      if (!commits || commits.length === 0) return;
      const headHash = commits[0].hash;
      if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(headHash)) return;

      const commitObj = await Api.tree(owner, repo, headHash);
      if (!commitObj.ok) return;
      const th = parseTreeHash(commitObj.json.content);
      if (!th) return;

      // If currentPath is a file, we should not load tree but file content via /file/*
      // Check if currentPath points to a file by trying to fetch it via /file/*
      if (currentPath) {
        // Try to fetch as file
        const fileRes = await Api.getFile(owner, repo, currentPath, selectedBranch);
        if (fileRes.ok && fileRes.json.content !== undefined) {
          // It's a file, show it
          setActiveFile({ name: currentPath.split("/").pop() || currentPath, content: fileRes.json.content, path: currentPath });
          // Also load parent dir tree for navigation
          const parentPath = currentPath.split("/").slice(0, -1).join("/");
          const parentTree = await fetchTreeAtPath(th, parentPath);
          if (parentTree) setTree(parentTree);
          else setTree([]);
          return;
        }
        // Else it's a dir, load its tree
        const dirTree = await fetchTreeAtPath(th, currentPath);
        if (dirTree) {
          setTree(dirTree);
          setActiveFile(null);
          // Check for README in dir
          const readmeEntry = dirTree.find((e) => /^readme\.md$/i.test(e.name));
          if (readmeEntry) {
            const rContent = await Api.tree(owner, repo, readmeEntry.hash);
            if (rContent.ok) setReadme(rContent.json.content);
            else setReadme(null);
          } else setReadme(null);
          return;
        }
      }

      // Default: root
      const entries = await fetchTreeAtPath(th, "");
      if (entries) {
        setTree(entries);
        const readmeEntry = entries.find((e) => /^readme\.md$/i.test(e.name));
        if (readmeEntry && !currentPath) {
          const rContent = await Api.tree(owner, repo, readmeEntry.hash);
          if (rContent.ok) setReadme(rContent.json.content);
        } else if (!currentPath) setReadme(null);
      }
      if (!currentPath) setActiveFile(null);
    }
    loadTreeData();
  }, [commits, owner, repo, currentPath, selectedBranch]);

  async function handleSelectFile(hash: string, name: string) {
    const fullPath = currentPath ? `${currentPath}/${name}` : name;
    // Check if it's a dir (mode 40000) vs file
    const entry = tree?.find((e) => e.name === name);
    if (entry && entry.mode === "40000") {
      // Navigate into dir
      const newPath = fullPath;
      const params = new URLSearchParams(searchParams.toString());
      params.set("path", newPath);
      if (selectedBranch) params.set("branch", selectedBranch);
      router.push(`/${owner}/${repo}?${params.toString()}`);
      return;
    }
    // File: fetch via /file/* for proper content (handles subdir files)
    const r = await Api.getFile(owner, repo, fullPath, selectedBranch);
    if (r.ok && r.json.content !== undefined) {
      setFileContent((prev) => ({ ...prev, [fullPath]: r.json.content }));
      setActiveFile({ name, content: r.json.content, path: fullPath });
      return;
    }
    // Fallback to hash
    if (fileContent[name]) {
      setActiveFile({ name, content: fileContent[name], path: fullPath });
      return;
    }
    const r2 = await Api.tree(owner, repo, hash);
    if (r2.ok) {
      const content = r2.json.content;
      setFileContent((prev) => ({ ...prev, [name]: content }));
      setActiveFile({ name, content, path: fullPath });
    }
  }

  function handleBreadcrumbClick(targetPath: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (targetPath) params.set("path", targetPath);
    else params.delete("path");
    router.push(`/${owner}/${repo}?${params.toString()}`);
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

  const pathParts = currentPath ? currentPath.split("/").filter(Boolean) : [];
  const breadcrumbPaths = pathParts.map((_, idx) => pathParts.slice(0, idx + 1).join("/"));

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
                      const params = new URLSearchParams(searchParams.toString());
                      params.set("branch", b);
                      router.push(`/${owner}/${repo}?${params.toString()}`);
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

      {/* Breadcrumb */}
      {currentPath && (
        <div className="flex items-center gap-1 text-xs font-mono text-fg-muted">
          <button onClick={() => handleBreadcrumbClick("")} className="hover:text-fg flex items-center gap-1">
            <Folder className="h-3 w-3" /> {repo}
          </button>
          {pathParts.map((part, idx) => (
            <span key={idx} className="flex items-center gap-1">
              <span className="text-fg-subtle">/</span>
              <button
                onClick={() => handleBreadcrumbClick(breadcrumbPaths[idx])}
                className={`${idx === pathParts.length - 1 ? "text-fg font-medium" : "hover:text-fg"}`}
              >
                {part}
              </button>
            </span>
          ))}
          <button onClick={() => handleBreadcrumbClick(pathParts.slice(0, -1).join("/"))} className="ml-2 text-[11px] text-fg-muted hover:text-fg flex items-center gap-1">
            <ArrowLeft className="h-3 w-3" /> Up
          </button>
        </div>
      )}

      {/* Code Browser Stack */}
      <div className="space-y-4 pt-1">
        {activeFile && (
          <FileViewer
            fileName={activeFile.name}
            content={activeFile.content}
            filePath={activeFile.path}
            owner={owner}
            repo={repo}
            branch={selectedBranch}
            onClose={() => {
              setActiveFile(null);
              // Keep path as dir
              const dir = activeFile.path.split("/").slice(0, -1).join("/");
              handleBreadcrumbClick(dir);
            }}
          />
        )}

        <FileTree
          entries={tree || []}
          onSelectFile={handleSelectFile}
          selectedFileName={activeFile?.name}
          latestCommit={commits[0] || null}
          currentPath={currentPath}
          onNavigate={handleBreadcrumbClick}
        />

        {readme && !activeFile && <MarkdownViewer content={readme} title="README.md" />}
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
