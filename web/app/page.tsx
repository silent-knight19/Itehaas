"use client";
import React, { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
  FolderGit2,
  Plus,
  Search,
  Lock,
  Globe,
  GitBranch,
  X,
  Compass,
  ArrowUpRight,
  LogIn,
  UserPlus,
} from "lucide-react";
import { Api } from "../lib/api";
import { useToast } from "../components/Toast";
import { Logo } from "../components/Logo";

interface Repo {
  id: string;
  name: string;
  description: string;
  visibility: "public" | "private";
  owner: string;
  default_branch: string;
  created_at?: string;
  updated_at?: string;
}

function DashboardContent() {
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterVis, setFilterVis] = useState<"all" | "public" | "private">("all");
  const [scope, setScope] = useState<"mine" | "explore">("mine");

  // Create Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newVis, setNewVis] = useState<"public" | "private">("public");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const me = await Api.me();
      let currentUser = null;
      if (me.ok && me.json?.user) {
        currentUser = me.json.user;
        setUser(currentUser);
      } else {
        setUser(null);
      }

      // Fetch user's own repos if logged in and scope is mine; otherwise fetch public repos
      const shouldFetchMine = currentUser && scope === "mine";
      const res = await Api.listRepos(shouldFetchMine ? { mine: true } : { all: true });

      if (res.ok && res.json?.repos) {
        setRepos(res.json.repos);
      } else {
        setError(res.json?.error || "Failed to load repositories");
      }
    } catch (e: any) {
      setError(e.message || "Connection error to server");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    if (searchParams.get("create") === "true") {
      setModalOpen(true);
    }
  }, [searchParams, scope]);

  async function handleCreateRepo(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setCreateError(null);

    const res = await Api.createRepo({
      name: newName.trim(),
      description: newDesc.trim(),
      visibility: newVis,
    });

    setCreating(false);
    if (res.ok) {
      setNewName("");
      setNewDesc("");
      setModalOpen(false);
      toast(`Repository ${res.json.repo.name} created`, "success");
      loadData();
      router.push(`/${res.json.repo.owner}/${res.json.repo.name}`);
    } else {
      setCreateError(res.json?.error || "Failed to create repository");
    }
  }

  const filteredRepos = (repos || []).filter((r) => {
    const matchesSearch =
      r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.owner.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (r.description || "").toLowerCase().includes(searchQuery.toLowerCase());
    const matchesVis = filterVis === "all" || r.visibility === filterVis;
    return matchesSearch && matchesVis;
  });

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Workspace Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border-subtle pb-4">
        <div>
          <h1 className="text-base font-semibold text-fg tracking-tight">
            {user ? (scope === "mine" ? "Your Repositories" : "Explore Repositories") : "Repositories"}
          </h1>
          <p className="text-xs text-fg-muted">
            {user
              ? (scope === "mine"
                  ? "Repositories you own or collaborate on."
                  : "Discover public repositories across the platform.")
              : "Sign in to manage your repositories and track revision history."}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {user ? (
            <>
              {/* Scope Switcher (Your Repos vs Explore) */}
              <div className="flex items-center rounded-sm border border-border-default bg-surface p-0.5 text-xs">
                <button
                  onClick={() => setScope("mine")}
                  className={`px-2.5 py-1 rounded-xs text-[11px] transition-colors ${
                    scope === "mine"
                      ? "bg-surface-active text-fg font-medium"
                      : "text-fg-muted hover:text-fg"
                  }`}
                >
                  Your Repos
                </button>
                <button
                  onClick={() => setScope("explore")}
                  className={`px-2.5 py-1 rounded-xs text-[11px] transition-colors ${
                    scope === "explore"
                      ? "bg-surface-active text-fg font-medium"
                      : "text-fg-muted hover:text-fg"
                  }`}
                >
                  Explore All
                </button>
              </div>

              <button
                onClick={() => setModalOpen(true)}
                className="flex items-center gap-1.5 rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover transition-colors shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>New repository</span>
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href="/login"
                className="flex items-center gap-1.5 rounded-sm bg-surface border border-border-default px-3 py-1.5 text-xs text-fg hover:border-border-emphasis transition-colors"
              >
                <LogIn className="h-3.5 w-3.5" />
                <span>Sign in</span>
              </Link>
              <Link
                href="/register"
                className="flex items-center gap-1.5 rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover transition-colors"
              >
                <UserPlus className="h-3.5 w-3.5" />
                <span>Create account</span>
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-fg-subtle" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              user && scope === "mine"
                ? "Filter your repositories… (or ⌘K to search all)"
                : "Search all public repositories…"
            }
            className="w-full rounded-sm border border-border-default bg-surface py-1.5 pl-8 pr-3 text-xs text-fg placeholder-fg-subtle focus:border-border-emphasis focus:outline-none"
          />
        </div>

        <div className="flex items-center rounded-sm border border-border-default bg-surface p-0.5 text-xs">
          {(["all", "public", "private"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilterVis(tab)}
              className={`px-2.5 py-1 rounded-xs capitalize text-[11px] transition-colors ${
                filterVis === tab
                  ? "bg-surface-active text-fg font-medium"
                  : "text-fg-muted hover:text-fg"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Unboxed Repository List */}
      {loading ? (
        <div className="divide-y divide-border-subtle border-t border-b border-border-subtle">
          {[1, 2, 3].map((i) => (
            <div key={i} className="py-4 space-y-2 animate-pulse">
              <div className="h-3.5 bg-surface-hover rounded-xs w-1/4" />
              <div className="h-2.5 bg-surface-hover rounded-xs w-1/2" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="rounded-sm border border-danger-border bg-danger-subtle p-3.5 text-xs text-danger font-mono">
          {error}
        </div>
      ) : filteredRepos.length === 0 ? (
        <div className="py-16 text-center space-y-2 border-t border-b border-border-subtle">
          <p className="text-xs text-fg font-medium">
            {searchQuery
              ? "No matching repositories found."
              : user && scope === "mine"
              ? "You haven't created any repositories yet."
              : "No public repositories available."}
          </p>
          <p className="text-xs text-fg-muted max-w-sm mx-auto">
            {searchQuery
              ? "Try adjusting your search query or press ⌘K to search globally."
              : user && scope === "mine"
              ? "Create your first repository to start version controlling your code."
              : "Sign in and create a repository to get started."}
          </p>
          {user && !searchQuery && scope === "mine" && (
            <button
              onClick={() => setModalOpen(true)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Create repository</span>
            </button>
          )}
        </div>
      ) : (
        <div className="divide-y divide-border-subtle border-t border-b border-border-subtle">
          {filteredRepos.map((repo) => (
            <div
              key={repo.id}
              className="group flex items-start justify-between gap-4 py-3.5 hover:bg-surface-hover/30 px-2 -mx-2 rounded-sm transition-colors"
            >
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/${repo.owner}/${repo.name}`}
                    className="text-xs font-medium text-fg hover:text-accent transition-colors truncate"
                  >
                    <span className="text-fg-muted font-normal">{repo.owner}</span>
                    <span className="text-fg-subtle mx-1">/</span>
                    <span className="font-semibold text-fg group-hover:text-accent">{repo.name}</span>
                  </Link>

                  <span className="inline-flex items-center gap-1 text-[11px] text-fg-subtle">
                    {repo.visibility === "public" ? (
                      <Globe className="h-2.5 w-2.5 text-fg-muted" />
                    ) : (
                      <Lock className="h-2.5 w-2.5 text-fg-muted" />
                    )}
                    <span className="capitalize">{repo.visibility}</span>
                  </span>
                </div>

                {repo.description ? (
                  <p className="text-xs text-fg-muted line-clamp-1">
                    {repo.description}
                  </p>
                ) : (
                  <p className="text-xs text-fg-subtle italic">No description</p>
                )}

                <div className="flex items-center gap-3 text-[11px] text-fg-subtle pt-0.5">
                  <span className="flex items-center gap-1 font-mono text-[10px]">
                    <GitBranch className="h-3 w-3 text-fg-muted" />
                    <span>{repo.default_branch || "main"}</span>
                  </span>
                  <span>•</span>
                  <span>Revision tracked</span>
                </div>
              </div>

              <div className="shrink-0 pt-0.5">
                <Link
                  href={`/${repo.owner}/${repo.name}`}
                  className="flex items-center gap-1 text-xs text-fg-muted group-hover:text-fg transition-colors"
                >
                  <span>Open</span>
                  <ArrowUpRight className="h-3 w-3 text-fg-subtle group-hover:text-fg" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Repository Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 animate-fast">
          <div className="fixed inset-0" onClick={() => setModalOpen(false)} />
          <div className="relative w-full max-w-md rounded-md border border-border-default bg-surface-overlay p-5 shadow-2xl z-10 space-y-4">
            <div className="flex items-center justify-between border-b border-border-subtle pb-3">
              <h2 className="text-xs font-semibold text-fg">
                Create a new repository
              </h2>
              <button
                onClick={() => setModalOpen(false)}
                className="text-fg-muted hover:text-fg"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {createError && (
              <div className="rounded-xs border border-danger-border bg-danger-subtle p-2 text-xs text-danger font-mono">
                {createError}
              </div>
            )}

            <form onSubmit={handleCreateRepo} className="space-y-3.5">
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-secondary">
                  Repository Name <span className="text-danger">*</span>
                </label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. distributed-store"
                  pattern="^[a-zA-Z0-9._-]+$"
                  required
                  autoFocus
                  className="w-full rounded-sm border border-border-default bg-surface px-3 py-1.5 text-xs text-fg placeholder-fg-subtle focus:border-border-emphasis focus:outline-none font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-secondary">
                  Description <span className="text-fg-subtle font-normal">(optional)</span>
                </label>
                <input
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Short description of the repository"
                  maxLength={500}
                  className="w-full rounded-sm border border-border-default bg-surface px-3 py-1.5 text-xs text-fg placeholder-fg-subtle focus:border-border-emphasis focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-secondary">
                  Visibility
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewVis("public")}
                    className={`flex items-center gap-2 rounded-sm border p-2 text-xs text-left transition-colors ${
                      newVis === "public"
                        ? "border-accent bg-accent-subtle text-fg font-medium"
                        : "border-border-default bg-surface text-fg-muted hover:border-border-emphasis"
                    }`}
                  >
                    <Globe className="h-3.5 w-3.5 text-fg-muted" />
                    <span>Public</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setNewVis("private")}
                    className={`flex items-center gap-2 rounded-sm border p-2 text-xs text-left transition-colors ${
                      newVis === "private"
                        ? "border-accent bg-accent-subtle text-fg font-medium"
                        : "border-border-default bg-surface text-fg-muted hover:border-border-emphasis"
                    }`}
                  >
                    <Lock className="h-3.5 w-3.5 text-fg-muted" />
                    <span>Private</span>
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border-subtle">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-sm border border-border-default bg-surface px-3 py-1.5 text-xs text-fg-secondary hover:bg-surface-hover"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  {creating ? "Creating…" : "Create repository"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-xs text-fg-muted">Loading repositories…</div>}>
      <DashboardContent />
    </Suspense>
  );
}
