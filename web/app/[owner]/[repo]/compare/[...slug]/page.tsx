"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Loader2, GitCompare, Columns } from "lucide-react";
import { Api } from "../../../../../lib/api";
import { RepoHeader } from "../../../../../components/RepoHeader";
import { RepoTabs } from "../../../../../components/RepoTabs";
import { DiffViewer } from "../../../../../components/DiffViewer";

export default function ComparePage({
  params,
}: {
  params: { owner: string; repo: string; slug?: string[] };
}) {
  const { owner, repo, slug } = params as any;
  const searchParams = useSearchParams();
  // Support both /compare/a...b (slug) and ?from=&to= or ?base=&head=
  const slugSpec = slug ? slug.join("/") : null;
  const fromQuery = searchParams.get("from") || searchParams.get("base");
  const toQuery = searchParams.get("to") || searchParams.get("head");
  // Parse slugSpec if contains ... or ..
  let baseFromSlug: string | null = null;
  let headFromSlug: string | null = null;
  let threeDot = true;
  if (slugSpec) {
    // slug is like ["a...b"] or ["a", "...", "b"]? For catch-all, it will be single entry "a...b"
    const joined = Array.isArray(slugSpec) ? slugSpec.join("/") : slugSpec;
    // Our file is [...slug] so slug is array; we already joined, but original is slugSpec string already
    // Actually for [...slug], params.slug is string[]; we joined to string, so check again
    const spec = Array.isArray(slug) ? slug.join("/") : slugSpec;
    if (typeof spec === "string") {
      if (spec.includes("...")) {
        const parts = spec.split("...");
        baseFromSlug = decodeURIComponent(parts[0]);
        headFromSlug = decodeURIComponent(parts.slice(1).join("..."));
        threeDot = true;
      } else if (spec.includes("..")) {
        const parts = spec.split("..");
        baseFromSlug = decodeURIComponent(parts[0]);
        headFromSlug = decodeURIComponent(parts.slice(1).join(".."));
        threeDot = false;
      }
    }
  }
  const base = baseFromSlug || fromQuery || "";
  const head = headFromSlug || toQuery || "";
  const isThreeDot = searchParams.get("threeDot") ? searchParams.get("threeDot") === "true" : threeDot;

  const [repoInfo, setRepoInfo] = useState<any>(null);
  const [data, setData] = useState<any>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [baseInput, setBaseInput] = useState(base);
  const [headInput, setHeadInput] = useState(head);

  useEffect(() => {
    setBaseInput(base);
    setHeadInput(head);
  }, [base, head]);

  useEffect(() => {
    async function loadBranches() {
      const r = await Api.getRepo(owner, repo);
      if (r.ok) setRepoInfo(r.json.repo);
      const b = await Api.listBranches(owner, repo);
      if (b.ok && b.json.branches) setBranches(b.json.branches);
    }
    loadBranches();
  }, [owner, repo]);

  useEffect(() => {
    if (!base || !head) return;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        // Prefer compare endpoint if threeDot, else diff
        let res: any;
        if (base && head) {
          // Use diff query for direct two-dot; use compare for three-dot ancestor
          if (isThreeDot) {
            res = await Api.getCompare(owner, repo, base, head, true);
          } else {
            res = await Api.getDiff(owner, repo, base, head);
          }
        }
        if (res?.ok) setData(res.json);
        else setError(res?.json?.error || "Failed to compare");
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [owner, repo, base, head, isThreeDot]);

  if (!base || !head) {
    return (
      <div className="space-y-4">
        {repoInfo && <RepoHeader owner={owner} repo={repo} visibility={repoInfo.visibility} defaultBranch={repoInfo.default_branch} description={repoInfo.description} />}
        <RepoTabs owner={owner} repo={repo} />
        <div className="pt-4 border border-border-subtle rounded-sm p-6 bg-surface">
          <h2 className="text-sm font-semibold text-fg flex items-center gap-2">
            <GitCompare className="h-4 w-4" /> Compare changes
          </h2>
          <p className="text-xs text-fg-muted mt-1">Select two commits or branches to see what changed. You can also select 2 commits from the commits list.</p>
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
              <input
                placeholder="or commit hash"
                value={baseInput}
                onChange={(e) => setBaseInput(e.target.value)}
                className="mt-2 w-full px-2 py-1 text-xs font-mono bg-bg-subtle border border-border-subtle rounded-sm"
              />
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
              <input
                placeholder="or commit hash"
                value={headInput}
                onChange={(e) => setHeadInput(e.target.value)}
                className="mt-2 w-full px-2 py-1 text-xs font-mono bg-bg-subtle border border-border-subtle rounded-sm"
              />
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

  return (
    <div className="space-y-4">
      {repoInfo && <RepoHeader owner={owner} repo={repo} visibility={repoInfo.visibility} defaultBranch={repoInfo.default_branch} description={repoInfo.description} />}
      <RepoTabs owner={owner} repo={repo} />
      <div className="pt-2">
        <Link href={`/${owner}/${repo}/commits`} className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg mb-3">
          <ArrowLeft className="h-3 w-3" /> Back
        </Link>

        {/* Header */}
        <div className="border border-border-subtle rounded-sm overflow-hidden bg-surface mb-4">
          <div className="px-4 py-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="font-mono text-fg-muted">Comparing</span>
            <span className="font-mono px-1.5 py-0.5 bg-bg-subtle border border-border-subtle rounded-sm">{base.slice(0, 7)}</span>
            <ArrowRight className="h-3 w-3 text-fg-muted" />
            <span className="font-mono px-1.5 py-0.5 bg-bg-subtle border border-border-subtle rounded-sm">{head.slice(0, 7)}</span>
            <span className="ml-2 text-fg-muted">{isThreeDot ? "three-dot" : "two-dot"}</span>
            <Link
              href={`/${owner}/${repo}/compare/${encodeURIComponent(head)}...${encodeURIComponent(base)}`}
              className="ml-auto text-xs border border-border-subtle rounded-sm px-2 py-1 hover:bg-surface-hover"
            >
              Swap
            </Link>
            <Link
              href={`/${owner}/${repo}/compare/${encodeURIComponent(base)}..${encodeURIComponent(head)}`}
              className={`text-xs border rounded-sm px-2 py-1 ${!isThreeDot ? "bg-accent text-white border-accent" : "border-border-subtle hover:bg-surface-hover"}`}
            >
              Two-dot
            </Link>
            <Link
              href={`/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`}
              className={`text-xs border rounded-sm px-2 py-1 ${isThreeDot ? "bg-accent text-white border-accent" : "border-border-subtle hover:bg-surface-hover"}`}
            >
              Three-dot
            </Link>
          </div>
          {data?.stats && (
            <div className="px-4 py-2 border-t border-border-subtle bg-bg-subtle flex items-center gap-2 text-xs font-mono">
              <span className="text-fg">{data.stats.changedFiles} files changed</span>
              <span className="text-success">+{data.stats.additions}</span>
              <span className="text-danger">-{data.stats.deletions}</span>
            </div>
          )}
        </div>

        {loading ? (
          <div className="py-12 flex items-center justify-center gap-2 text-xs text-fg-muted font-mono border border-border-subtle rounded-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Comparing…
          </div>
        ) : error ? (
          <div className="rounded-sm border border-danger-border bg-danger-subtle p-4 text-xs text-danger font-mono">{error}</div>
        ) : data ? (
          <DiffViewer files={data.files} stats={data.stats} />
        ) : null}
      </div>
    </div>
  );
}
