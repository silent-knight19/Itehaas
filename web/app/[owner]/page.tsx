"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Globe,
  Lock,
  GitBranch,
  Star,
  Search,
  X,
  ArrowUpRight,
  Clock,
  GitCommit,
  AlertCircle,
} from "lucide-react";
import { Api } from "../../lib/api";
import { useToast } from "../../components/Toast";
import { ProfileHeader } from "../../components/profile/ProfileHeader";
import { ProfileTabs } from "../../components/profile/ProfileTabs";
import { ContributionGrid } from "../../components/profile/ContributionGrid";
import { PinnedRepos } from "../../components/profile/PinnedRepos";
import { formatCommitDate } from "../../lib/formatDate";

interface Props {
  params: { owner: string };
}

type Tab = "overview" | "repositories" | "stars" | "activity";

const RESERVED = new Set(["login", "register", "api", "health", "settings", "explore", "_next"]);

function isReserved(name: string): boolean {
  return RESERVED.has(name.toLowerCase());
}

function ProfilePageContent({ params }: Props) {
  const username = params.owner;
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const rawTab = searchParams.get("tab") as Tab | null;
  const activeTab: Tab =
    rawTab && ["overview", "repositories", "stars", "activity"].includes(rawTab) ? rawTab : "overview";

  const [user, setUser] = useState<any>(null);
  const [counts, setCounts] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOwn, setIsOwn] = useState(false);

  // Overview data
  const [repos, setRepos] = useState<any[]>([]);
  const [contributions, setContributions] = useState<any[]>([]);
  const [contribTotal, setContribTotal] = useState(0);
  const [activity, setActivity] = useState<any[]>([]);
  const [stars, setStars] = useState<any[]>([]);

  // Repositories tab state
  const [repoSearch, setRepoSearch] = useState("");
  const [repoVis, setRepoVis] = useState<"all" | "public" | "private">("all");
  const [repoSort, setRepoSort] = useState<"updated" | "name" | "stars">("updated");
  const [repoLoading, setRepoLoading] = useState(false);

  // Starred tab search
  const [starSearch, setStarSearch] = useState("");

  // Edit modal
  const [editOpen, setEditOpen] = useState(false);
  const [editBio, setEditBio] = useState("");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  async function loadProfile() {
    if (isReserved(username)) {
      setError("Not found");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const me = await Api.me();
      const currentUser = me.ok && me.json?.user ? me.json.user : null;

      const res = await Api.getUser(username);
      if (!res.ok) {
        if (res.status === 404) setError("User not found.");
        else setError(res.json?.error || "Failed to load profile");
        setLoading(false);
        return;
      }
      const profile = res.json.user;
      const cnts = res.json.counts;
      setUser(profile);
      setCounts(cnts);
      setEditBio(profile.bio || "");
      setIsOwn(currentUser?.username === username);

      // Fetch repos, contributions, activity, stars in parallel
      const [reposRes, contribRes, actRes, starsRes] = await Promise.all([
        Api.getUserRepos(username, { sort: "updated", limit: 50 }),
        Api.getContributions(username, undefined, 365),
        Api.getUserActivity(username, 20),
        Api.getUserStars(username, { limit: 50 }),
      ]);
      if (reposRes.ok && reposRes.json?.repos) setRepos(reposRes.json.repos);
      if (contribRes.ok && contribRes.json?.contributions) {
        setContributions(contribRes.json.contributions);
        setContribTotal(contribRes.json.total ?? 0);
      }
      if (actRes.ok && actRes.json?.activity) setActivity(actRes.json.activity);
      if (starsRes.ok && starsRes.json?.repos) setStars(starsRes.json.repos);
    } catch (e: any) {
      setError(e.message || "Connection error");
    } finally {
      setLoading(false);
    }
  }

  async function reloadRepos() {
    setRepoLoading(true);
    try {
      const res = await Api.getUserRepos(username, {
        visibility: repoVis,
        sort: repoSort,
        search: repoSearch || undefined,
        limit: 50,
      });
      if (res.ok) setRepos(res.json.repos || []);
    } finally {
      setRepoLoading(false);
    }
  }

  useEffect(() => {
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  useEffect(() => {
    if (activeTab === "repositories" && !loading && user) {
      reloadRepos();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoVis, repoSort]);

  async function handleSaveBio(e: React.FormEvent) {
    e.preventDefault();
    if (editBio.length > 160) {
      setEditError("Bio must be at most 160 characters");
      return;
    }
    setSaving(true);
    setEditError(null);
    const res = await Api.updateProfile(username, { bio: editBio.trim() });
    setSaving(false);
    if (res.ok) {
      setUser(res.json.user);
      setEditOpen(false);
      toast("Profile updated", "success");
    } else {
      setEditError(res.json?.error || "Failed to update");
    }
  }

  // Filtered for client-side search debouncing
  const displayedRepos = repos;
  const filteredStars = stars.filter((r: any) => {
    if (!starSearch.trim()) return true;
    const q = starSearch.toLowerCase();
    return (
      r.name.toLowerCase().includes(q) ||
      r.owner.toLowerCase().includes(q) ||
      (r.description || "").toLowerCase().includes(q)
    );
  });

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6">
          <div className="space-y-3 animate-pulse">
            <div className="h-16 w-16 rounded-full bg-surface" />
            <div className="h-3 bg-surface rounded-xs w-2/3" />
            <div className="h-2 bg-surface rounded-xs w-full" />
          </div>
          <div className="space-y-3 animate-pulse">
            <div className="h-8 bg-surface rounded-xs" />
            <div className="h-40 bg-surface rounded-xs" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto py-12 text-center space-y-3">
        <div className="inline-flex items-center gap-2 rounded-sm border border-danger-border bg-danger-subtle px-3 py-2 text-xs text-danger font-mono">
          <AlertCircle className="h-3.5 w-3.5" />
          <span>{error}</span>
        </div>
        <p className="text-xs text-fg-muted">
          <Link href="/" className="text-accent hover:underline">
            Back to dashboard
          </Link>
        </p>
      </div>
    );
  }

  if (!user || !counts) return null;

  const pinnedRepos = [...repos].sort((a, b) => b.stars_count - a.stars_count || new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {/* Two-column: Identity sidebar + Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6 lg:gap-8">
        {/* Left Column: Identity */}
        <div className="lg:sticky lg:top-4 self-start space-y-4">
          <ProfileHeader user={user} counts={counts} isOwn={isOwn} onEdit={() => setEditOpen(true)} />
        </div>

        {/* Right Column: Tabbed Workspace */}
        <div className="min-w-0 space-y-4">
          <ProfileTabs username={username} active={activeTab} reposCount={counts.reposOwned} starsCount={counts.starsGiven} />

          {activeTab === "overview" && (
            <div className="space-y-6">
              <PinnedRepos repos={pinnedRepos} />

              <ContributionGrid contributions={contributions} total={contribTotal} />

              {/* Recent Activity Ledger */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-fg tracking-tight">Recent activity</h3>
                  <button
                    onClick={() => router.push(`/${username}?tab=activity`)}
                    className="text-[11px] text-fg-muted hover:text-fg transition-colors"
                  >
                    View all →
                  </button>
                </div>
                {activity.length === 0 ? (
                  <div className="rounded-sm border border-border-subtle bg-surface p-6 text-center">
                    <p className="text-xs text-fg-muted">No recent activity.</p>
                    <p className="text-[11px] text-fg-subtle mt-1">Pushes, issues and PRs appear here.</p>
                  </div>
                ) : (
                  <div className="border-t border-b border-border-subtle divide-y divide-border-subtle">
                    {activity.slice(0, 8).map((a: any) => {
                      const when = formatCommitDate(new Date(a.created_at).toISOString());
                      return (
                        <div key={`${a.repo_name}-${a.created_at}-${a.action}`} className="group flex items-start gap-3 py-3 px-2 -mx-2 hover:bg-surface-hover/30 rounded-sm transition-colors">
                          <div className="mt-0.5 text-fg-muted">
                            {a.action === "star" ? <Star className="h-3.5 w-3.5" /> : a.action?.startsWith("pr") ? <GitCommit className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                          </div>
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <p className="text-xs text-fg group-hover:text-accent truncate">
                              <span className="font-medium">{a.action}</span>
                              {a.repo_owner && a.repo_name ? (
                                <>
                                  <span className="text-fg-muted font-normal"> in </span>
                                  <Link href={`/${a.repo_owner}/${a.repo_name}`} className="font-mono text-[11px] hover:underline">
                                    {a.repo_owner}/{a.repo_name}
                                  </Link>
                                </>
                              ) : null}
                              {a.payload?.title ? <span className="text-fg-muted"> — {a.payload.title}</span> : null}
                            </p>
                            <div className="flex items-center gap-2 text-[11px] text-fg-muted">
                              <span title={when.absolute} className="inline-flex items-center gap-1">
                                <Clock className="h-3 w-3 text-fg-subtle" /> {when.relative}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "repositories" && (
            <div className="space-y-3">
              {/* Search & Filters */}
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-fg-subtle" />
                  <input
                    value={repoSearch}
                    onChange={(e) => setRepoSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") reloadRepos();
                    }}
                    placeholder="Search repositories…"
                    className="w-full rounded-sm border border-border-default bg-surface py-1.5 pl-8 pr-3 text-xs text-fg placeholder-fg-subtle focus:border-border-emphasis focus:outline-none"
                  />
                </div>
                <div className="flex gap-2">
                  <div className="flex rounded-sm border border-border-default bg-surface p-0.5 text-xs">
                    {(["all", "public", "private"] as const).map((v) => (
                      <button
                        key={v}
                        onClick={() => setRepoVis(v)}
                        className={`px-2.5 py-1 rounded-xs capitalize text-[11px] transition-colors ${repoVis === v ? "bg-surface-active text-fg font-medium" : "text-fg-muted hover:text-fg"}`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                  <select
                    value={repoSort}
                    onChange={(e) => setRepoSort(e.target.value as any)}
                    className="rounded-sm border border-border-default bg-surface px-2 py-1 text-xs text-fg focus:border-border-emphasis focus:outline-none"
                  >
                    <option value="updated">Last updated</option>
                    <option value="name">Name</option>
                    <option value="stars">Stars</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={reloadRepos}
                  className="rounded-sm border border-border-default bg-surface px-2.5 py-1 text-xs text-fg-muted hover:border-border-emphasis hover:text-fg"
                >
                  Search
                </button>
              </div>

              {/* Ledger */}
              {repoLoading ? (
                <div className="divide-y divide-border-subtle border-t border-b border-border-subtle">
                  {[1, 2].map((i) => (
                    <div key={i} className="py-4 space-y-2 animate-pulse">
                      <div className="h-3 bg-surface-hover rounded-xs w-1/3" />
                      <div className="h-2.5 bg-surface-hover rounded-xs w-1/2" />
                    </div>
                  ))}
                </div>
              ) : displayedRepos.length === 0 ? (
                <div className="py-10 text-center border-t border-b border-border-subtle space-y-1">
                  <p className="text-xs text-fg font-medium">No repositories found.</p>
                  <p className="text-[11px] text-fg-muted">Try adjusting filters.</p>
                </div>
              ) : (
                <div className="divide-y divide-border-subtle border-t border-b border-border-subtle">
                  {displayedRepos.map((r: any) => (
                    <div key={r.id} className="group flex items-start justify-between gap-4 py-3.5 px-2 -mx-2 hover:bg-surface-hover/30 rounded-sm transition-colors">
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <Link href={`/${r.owner}/${r.name}`} className="text-xs font-medium text-fg hover:text-accent truncate">
                            <span className="text-fg-muted font-normal">{r.owner}/</span>
                            <span className="font-semibold group-hover:text-accent">{r.name}</span>
                          </Link>
                          <span className="inline-flex items-center gap-1 text-[10px] text-fg-subtle shrink-0">
                            {r.visibility === "public" ? <Globe className="h-2.5 w-2.5 text-fg-muted" /> : <Lock className="h-2.5 w-2.5 text-fg-muted" />}
                            <span className="capitalize">{r.visibility}</span>
                          </span>
                        </div>
                        {r.description ? (
                          <p className="text-xs text-fg-muted line-clamp-1">{r.description}</p>
                        ) : (
                          <p className="text-xs text-fg-subtle italic">No description</p>
                        )}
                        <div className="flex items-center gap-3 text-[11px] text-fg-subtle pt-0.5">
                          <span className="inline-flex items-center gap-1 font-mono text-[10px]">
                            <GitBranch className="h-3 w-3 text-fg-muted" /> {r.default_branch || "main"}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Star className="h-3 w-3 text-fg-muted" /> {r.stars_count}
                          </span>
                          <span>•</span>
                          <span title={r.updated_at ? formatCommitDate(new Date(r.updated_at).toISOString()).absolute : ""} className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3 text-fg-subtle" /> {r.updated_at ? formatCommitDate(new Date(r.updated_at).toISOString()).relative : ""}
                          </span>
                        </div>
                      </div>
                      <Link href={`/${r.owner}/${r.name}`} className="shrink-0 flex items-center gap-1 text-xs text-fg-muted group-hover:text-fg">
                        <span>Open</span> <ArrowUpRight className="h-3 w-3 text-fg-subtle group-hover:text-fg" />
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "stars" && (
            <div className="space-y-3">
              <div className="relative max-w-md">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-fg-subtle" />
                <input
                  value={starSearch}
                  onChange={(e) => setStarSearch(e.target.value)}
                  placeholder="Filter starred repositories…"
                  className="w-full rounded-sm border border-border-default bg-surface py-1.5 pl-8 pr-3 text-xs text-fg placeholder-fg-subtle focus:border-border-emphasis focus:outline-none"
                />
              </div>
              {filteredStars.length === 0 ? (
                <div className="py-10 text-center border-t border-b border-border-subtle">
                  <p className="text-xs text-fg-muted">No starred repositories.</p>
                  <p className="text-[11px] text-fg-subtle mt-1">Star repositories to curate your bookmarks.</p>
                </div>
              ) : (
                <div className="divide-y divide-border-subtle border-t border-b border-border-subtle">
                  {filteredStars.map((r: any) => (
                    <div key={r.id} className="group flex items-start justify-between gap-4 py-3.5 px-2 -mx-2 hover:bg-surface-hover/30 rounded-sm transition-colors">
                      <div className="space-y-1 min-w-0">
                        <Link href={`/${r.owner}/${r.name}`} className="text-xs font-medium text-fg hover:text-accent truncate block">
                          <span className="text-fg-muted font-normal">{r.owner}/</span>
                          <span className="font-semibold group-hover:text-accent">{r.name}</span>
                        </Link>
                        <p className="text-xs text-fg-muted line-clamp-1">{r.description || <span className="italic text-fg-subtle">No description</span>}</p>
                        <div className="flex items-center gap-3 text-[11px] text-fg-subtle">
                          <span className="inline-flex items-center gap-1">
                            <Star className="h-3 w-3 text-fg-muted" /> {r.stars_count}
                          </span>
                          <span>• Starred {formatCommitDate(new Date(r.starred_at).toISOString()).relative}</span>
                        </div>
                      </div>
                      <Link href={`/${r.owner}/${r.name}`} className="shrink-0 flex items-center gap-1 text-xs text-fg-muted group-hover:text-fg">
                        Open <ArrowUpRight className="h-3 w-3" />
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "activity" && (
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-fg tracking-tight">Activity log</h3>
              {activity.length === 0 ? (
                <div className="py-10 text-center border-t border-b border-border-subtle">
                  <p className="text-xs text-fg-muted">No activity yet.</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Group by month */}
                  {(() => {
                    const groups: Record<string, typeof activity> = {};
                    activity.forEach((a) => {
                      const d = new Date(a.created_at);
                      const key = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(d);
                      if (!groups[key]) groups[key] = [];
                      groups[key].push(a);
                    });
                    return Object.entries(groups).map(([month, items]) => (
                      <div key={month} className="space-y-2">
                        <div className="text-[11px] font-medium text-fg-muted border-b border-border-subtle pb-1">{month}</div>
                        <div className="border-t border-b border-border-subtle divide-y divide-border-subtle">
                          {items.map((a: any) => {
                            const when = formatCommitDate(new Date(a.created_at).toISOString());
                            return (
                              <div key={`${a.repo_name}-${a.created_at}-${a.action}-${Math.random()}`} className="group flex items-start gap-3 py-3 px-2 -mx-2 hover:bg-surface-hover/30 rounded-sm transition-colors">
                                <div className="mt-0.5 text-fg-muted">
                                  {a.action === "star" ? <Star className="h-3.5 w-3.5" /> : a.action?.startsWith("pr") ? <GitCommit className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                                </div>
                                <div className="min-w-0 flex-1 space-y-0.5">
                                  <p className="text-xs text-fg break-words">
                                    <span className="font-mono text-[11px] text-fg-muted">{a.action}</span>
                                    {a.repo_owner && a.repo_name ? (
                                      <>
                                        <span className="text-fg-muted"> in </span>
                                        <Link href={`/${a.repo_owner}/${a.repo_name}`} className="font-medium hover:text-accent hover:underline">
                                          {a.repo_owner}/{a.repo_name}
                                        </Link>
                                      </>
                                    ) : null}
                                    {a.payload?.title ? <span className="text-fg-muted"> — {a.payload.title}</span> : null}
                                  </p>
                                  <div className="flex items-center gap-2 text-[11px] text-fg-muted">
                                    <span title={when.absolute} className="inline-flex items-center gap-1">
                                      <Clock className="h-3 w-3 text-fg-subtle" /> {when.relative}
                                    </span>
                                    <span>•</span>
                                    <span className="font-mono text-[10px] text-fg-subtle">{new Date(a.created_at).toLocaleDateString()}</span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Edit Profile Modal */}
      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="fixed inset-0" onClick={() => setEditOpen(false)} />
          <div className="relative w-full max-w-md rounded-md border border-border-default bg-surface-overlay p-5 shadow-2xl z-10 space-y-4">
            <div className="flex items-center justify-between border-b border-border-subtle pb-3">
              <h2 className="text-xs font-semibold text-fg">Edit profile</h2>
              <button onClick={() => setEditOpen(false)} className="text-fg-muted hover:text-fg">
                <X className="h-4 w-4" />
              </button>
            </div>

            {editError && (
              <div className="rounded-xs border border-danger-border bg-danger-subtle p-2 text-xs text-danger font-mono">{editError}</div>
            )}

            <form onSubmit={handleSaveBio} className="space-y-3.5">
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-secondary">Bio</label>
                <textarea
                  value={editBio}
                  onChange={(e) => setEditBio(e.target.value)}
                  maxLength={160}
                  rows={3}
                  placeholder="Short bio about your work (max 160 chars)"
                  className="w-full rounded-sm border border-border-default bg-surface px-3 py-2 text-xs text-fg placeholder-fg-subtle focus:border-border-emphasis focus:outline-none resize-none"
                />
                <div className="flex justify-between text-[11px]">
                  <span className="text-fg-subtle">{editBio.length}/160</span>
                  <span className="text-fg-muted">Visible on your profile</span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border-subtle">
                <button type="button" onClick={() => setEditOpen(false)} className="rounded-sm border border-border-default bg-surface px-3 py-1.5 text-xs text-fg-secondary hover:bg-surface-hover">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50">
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProfilePage(props: Props) {
  return (
    <React.Suspense fallback={<div className="py-12 text-center text-xs text-fg-muted">Loading profile…</div>}>
      <ProfilePageContent {...props} />
    </React.Suspense>
  );
}
