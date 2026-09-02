"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  FolderGit2,
  Plus,
  Search,
  LogOut,
  LogIn,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  Compass,
  Layers,
  Bell,
  CheckCheck,
} from "lucide-react";
import { Api } from "../lib/api";
import { CommandPalette } from "./CommandPalette";
import { Logo } from "./Logo";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<{ id: string; username: string; email: string } | null>(null);
  const [recentRepos, setRecentRepos] = useState<any[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifLoading, setNotifLoading] = useState(false);

  const pathname = usePathname();
  const router = useRouter();

  async function loadState() {
    try {
      const me = await Api.me();
      if (me.ok && me.json?.user) {
        setUser(me.json.user);
        const r = await Api.listRepos({ mine: true });
        if (r.ok && r.json?.repos) {
          setRecentRepos(r.json.repos.slice(0, 8));
        } else {
          setRecentRepos([]);
        }
      } else {
        setUser(null);
        setRecentRepos([]);
      }
    } catch {
      setUser(null);
      setRecentRepos([]);
    }
  }

  useEffect(() => {
    loadState();
  }, [pathname]);

  async function loadNotifications() {
    if (!user) { setNotifications([]); return; }
    setNotifLoading(true);
    try {
      const res = await Api.getNotifications();
      if (res.ok && res.json?.notifications) setNotifications(res.json.notifications);
    } catch {}
    finally { setNotifLoading(false); }
  }

  useEffect(() => {
    if (user) loadNotifications();
    else setNotifications([]);
  }, [user?.id, pathname]);

  // Poll notifications every 30s when logged in
  useEffect(() => {
    if (!user) return;
    const id = setInterval(loadNotifications, 30000);
    return () => clearInterval(id);
  }, [user?.id]);

  // Global ⌘K keyboard shortcut
  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  async function handleLogout() {
    await Api.logout();
    setUser(null);
    setRecentRepos([]);
    router.push("/login");
  }

  // Parse path breadcrumb
  const pathParts = pathname.split("/").filter(Boolean);
  const reservedTop = new Set(["login", "register", "api", "health", "settings", "explore"]);
  const isRepoContext =
    pathParts.length >= 2 && !reservedTop.has(pathParts[0]) && pathParts[0] !== "_next";
  const repoOwner = isRepoContext ? pathParts[0] : null;
  const repoName = isRepoContext ? pathParts[1] : null;
  const isProfileContext =
    pathParts.length === 1 && !reservedTop.has(pathParts[0]) && pathParts[0] !== "_next";
  const isAuthPage = pathname === "/login" || pathname === "/register";

  if (isAuthPage) {
    return (
      <div className="min-h-screen w-screen overflow-y-auto bg-canvas text-fg-secondary flex flex-col justify-center items-center">
        {children}
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-canvas text-fg-secondary">
      {/* Command Palette */}
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />

      {/* Left Sidebar (Desktop) */}
      <aside
        className={`hidden md:flex flex-col border-r border-border-subtle bg-sidebar transition-all duration-normal ease-snappy select-none z-20 ${
          sidebarCollapsed ? "w-14" : "w-52"
        }`}
      >
        {/* Brand Header */}
        <div className="flex h-12 items-center justify-between border-b border-border-subtle px-3">
          <Link href="/" className="flex items-center gap-2.5 overflow-hidden" title="Itehaas">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-xs bg-surface border border-border-subtle">
              <Logo variant="mark" size="sm" priority />
            </div>
            {!sidebarCollapsed && (
              <span className="font-sans font-semibold text-xs text-fg tracking-tight truncate">
                Itehaas
              </span>
            )}
          </Link>

          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="rounded-xs p-1 text-fg-muted hover:bg-surface-hover hover:text-fg transition-colors"
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronLeft className="h-3 w-3" />}
          </button>
        </div>

        {/* Sidebar Navigation */}
        <div className="flex-1 overflow-y-auto px-2 py-2.5 space-y-4">
          <div className="space-y-0.5">
            <Link
              href="/"
              className={`flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs transition-colors ${
                pathname === "/"
                  ? "bg-surface-active text-fg font-medium"
                  : "text-fg-secondary hover:bg-surface-hover hover:text-fg"
              }`}
              title="Overview"
            >
              <Compass className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
              {!sidebarCollapsed && <span>Overview</span>}
            </Link>

            <button
              onClick={() => setCmdOpen(true)}
              className="w-full flex items-center justify-between rounded-sm px-2 py-1.5 text-xs text-fg-secondary hover:bg-surface-hover hover:text-fg transition-colors"
              title="Command Palette (⌘K)"
            >
              <div className="flex items-center gap-2">
                <Search className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
                {!sidebarCollapsed && <span>Search</span>}
              </div>
              {!sidebarCollapsed && (
                <kbd className="rounded-xs border border-border-subtle bg-bg-subtle px-1 py-0.2 text-[10px] font-mono text-fg-muted">
                  ⌘K
                </kbd>
              )}
            </button>
          </div>

          {/* Repositories List */}
          {!sidebarCollapsed && (
            <div className="space-y-1 pt-2 border-t border-border-subtle">
              <div className="flex items-center justify-between px-2 text-[11px] font-medium text-fg-muted">
                <span>Repositories</span>
                {user && (
                  <Link href="/?create=true" className="text-fg-muted hover:text-fg transition-colors" title="New repository">
                    <Plus className="h-3 w-3" />
                  </Link>
                )}
              </div>

              <div className="space-y-0.5">
                {recentRepos.length === 0 ? (
                  <span className="block px-2 text-[11px] text-fg-subtle italic">No repositories yet</span>
                ) : (
                  recentRepos.map((r) => {
                    const isCurrent = repoOwner === r.owner && repoName === r.name;
                    return (
                      <Link
                        key={r.id}
                        href={`/${r.owner}/${r.name}`}
                        className={`flex items-center gap-2 rounded-sm px-2 py-1 text-xs truncate transition-colors ${
                          isCurrent
                            ? "bg-surface-active text-fg font-medium"
                            : "text-fg-secondary hover:bg-surface-hover hover:text-fg"
                        }`}
                        title={`${r.owner}/${r.name}`}
                      >
                        <FolderGit2 className="h-3 w-3 shrink-0 text-fg-muted" />
                        <span className="truncate">{r.name}</span>
                      </Link>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* User Account / Auth Section */}
        <div className="border-t border-border-subtle p-2 bg-sidebar">
          {user ? (
            <div className={`flex items-center justify-between ${sidebarCollapsed ? "justify-center" : "px-1.5"}`}>
              <Link href={`/${user.username}`} className="flex items-center gap-2 min-w-0 hover:opacity-80 transition-opacity" title="View profile">
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-xs bg-surface border border-border-subtle font-mono text-[9px] font-medium text-fg">
                  {user.username.slice(0, 2).toUpperCase()}
                </div>
                {!sidebarCollapsed && (
                  <span className="text-xs text-fg font-medium truncate hover:text-accent">
                    {user.username}
                  </span>
                )}
              </Link>
              {!sidebarCollapsed && (
                <button
                  onClick={handleLogout}
                  className="rounded-xs p-1 text-fg-muted hover:bg-surface-hover hover:text-fg transition-colors"
                  title="Sign out"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              <Link
                href="/login"
                className={`flex items-center justify-center gap-1.5 rounded-sm border border-border-default bg-surface px-2 py-1 text-xs text-fg hover:bg-surface-hover transition-colors ${
                  sidebarCollapsed ? "px-0" : ""
                }`}
                title="Sign in"
              >
                <LogIn className="h-3.5 w-3.5" />
                {!sidebarCollapsed && <span>Sign In</span>}
              </Link>
            </div>
          )}
        </div>
      </aside>

      {/* Main Workspace Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Context Bar (44px) */}
        <header className="flex h-11 shrink-0 items-center justify-between border-b border-border-subtle bg-sidebar px-4 select-none z-10">
          {/* Breadcrumbs with Slash Hierarchy */}
          <div className="flex items-center gap-2 text-xs min-w-0">
            <button
              onClick={() => setMobileDrawerOpen(true)}
              className="md:hidden rounded-xs p-1 text-fg-muted hover:text-fg"
            >
              <Menu className="h-4 w-4" />
            </button>

            <Link href="/" className="flex items-center gap-1.5 font-medium text-fg hover:text-accent transition-colors shrink-0">
              <Logo variant="mark" size="sm" />
              <span>Itehaas</span>
            </Link>

            {isRepoContext && (
              <>
                <span className="text-fg-subtle font-normal">/</span>
                <Link href={`/${repoOwner}`} className="text-fg-muted hover:text-fg transition-colors">
                  {repoOwner}
                </Link>
                <span className="text-fg-subtle font-normal">/</span>
                <Link
                  href={`/${repoOwner}/${repoName}`}
                  className="font-medium text-fg hover:text-accent truncate transition-colors"
                >
                  {repoName}
                </Link>
              </>
            )}
            {isProfileContext && (
              <>
                <span className="text-fg-subtle font-normal">/</span>
                <Link href={`/${pathParts[0]}`} className="font-medium text-fg hover:text-accent truncate transition-colors">
                  {pathParts[0]}
                </Link>
                <span className="rounded-xs bg-surface border border-border-subtle px-1 py-0.2 text-[9px] font-mono text-fg-muted">profile</span>
              </>
            )}
          </div>

          {/* Right Header Controls */}
          <div className="flex items-center gap-2.5">
            {user && (
              <div className="relative">
                <button
                  onClick={() => { setNotifOpen(!notifOpen); if (!notifOpen) loadNotifications(); }}
                  className="relative flex items-center gap-1.5 rounded-sm border border-border-default bg-surface px-2 py-1 text-xs text-fg-muted hover:border-border-emphasis hover:text-fg transition-colors"
                  title="Notifications"
                >
                  <Bell className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline text-[11px]">Inbox</span>
                  {notifications.filter((n:any)=>!n.is_read).length > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[10px] font-mono text-white">
                      {notifications.filter((n:any)=>!n.is_read).length}
                    </span>
                  )}
                </button>
                {notifOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setNotifOpen(false)} />
                    <div className="absolute right-0 top-full mt-1.5 z-40 w-80 rounded-sm border border-border-default bg-surface-overlay shadow-xl overflow-hidden animate-fast">
                      <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
                        <span className="text-xs font-medium text-fg">Notifications</span>
                        <span className="text-[11px] font-mono text-fg-muted">{notifications.filter((n:any)=>!n.is_read).length} unread</span>
                      </div>
                      <div className="max-h-[320px] overflow-y-auto divide-y divide-border-subtle">
                        {notifLoading ? (
                          <div className="p-6 text-center text-xs text-fg-muted animate-pulse">Loading…</div>
                        ) : notifications.length === 0 ? (
                          <div className="p-6 text-center text-xs text-fg-muted">No notifications</div>
                        ) : (
                          notifications.slice(0, 20).map((n:any) => {
                            let payload: any = {};
                            try { payload = typeof n.payload === 'string' ? JSON.parse(n.payload) : n.payload; } catch {}
                            const title = n.type === 'mention' ? `Mentioned by @${payload.by || '?'}` :
                                         n.type === 'pr_open' ? `PR opened: ${payload.title || ''}` :
                                         n.type === 'pr_review_requested' ? `Review requested by @${payload.requested_by || '?'}` :
                                         n.type === 'issue_assigned' ? `Assigned: ${payload.title || ''}` :
                                         n.type;
                            const repo = payload.repo || payload.repo_owner || "";
                            return (
                              <div key={n.id} className={`px-3 py-2 hover:bg-surface-hover/50 ${!n.is_read ? "bg-accent-subtle/30" : ""}`}>
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="text-xs text-fg truncate">{title}</div>
                                    <div className="text-[11px] text-fg-muted font-mono truncate">{repo} • {new Date(n.created_at).toLocaleDateString()}</div>
                                  </div>
                                  {!n.is_read && (
                                    <button
                                      onClick={async () => { await Api.markNotificationRead(n.id); setNotifications(prev=>prev.map(x=>x.id===n.id?{...x,is_read:true}:x)); }}
                                      className="rounded-xs border border-border-subtle bg-surface px-1.5 py-0.5 text-[10px] text-fg-muted hover:text-fg"
                                      title="Mark read"
                                    >
                                      <CheckCheck className="h-3 w-3" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                      <div className="border-t border-border-subtle bg-bg-subtle px-3 py-1.5 text-center">
                        <Link href="/notifications" onClick={()=>setNotifOpen(false)} className="text-xs text-fg-muted hover:text-fg">View all →</Link>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
            <button
              onClick={() => setCmdOpen(true)}
              className="flex items-center gap-2 rounded-sm border border-border-default bg-surface px-2 py-1 text-xs text-fg-muted hover:border-border-emphasis hover:text-fg transition-colors"
            >
              <Search className="h-3 w-3" />
              <span className="text-[11px] hidden sm:inline">Search…</span>
              <kbd className="rounded-xs border border-border-subtle bg-bg-subtle px-1 py-0.2 text-[9px] font-mono">
                ⌘K
              </kbd>
            </button>
          </div>
        </header>

        {/* Main Workspace Canvas */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 bg-canvas">
          <div className="max-w-5xl mx-auto w-full">
            {children}
          </div>
        </main>
      </div>

      {/* Mobile Drawer */}
      {mobileDrawerOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden bg-black/70 animate-fast">
          <div className="fixed inset-0" onClick={() => setMobileDrawerOpen(false)} />
          <div className="relative w-60 bg-sidebar border-r border-border-default p-4 flex flex-col h-full z-10">
            <div className="flex items-center justify-between border-b border-border-subtle pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Logo variant="mark" size="sm" />
                <span className="font-semibold text-xs text-fg">Itehaas</span>
              </div>
              <button onClick={() => setMobileDrawerOpen(false)} className="text-fg-muted">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 space-y-1 text-xs">
              <Link
                href="/"
                onClick={() => setMobileDrawerOpen(false)}
                className="block px-2 py-1.5 rounded-sm hover:bg-surface text-fg"
              >
                Overview
              </Link>
              <div className="text-[10px] text-fg-muted uppercase pt-3 px-2">Repositories</div>
              {recentRepos.map((r) => (
                <Link
                  key={r.id}
                  href={`/${r.owner}/${r.name}`}
                  onClick={() => setMobileDrawerOpen(false)}
                  className="block px-2 py-1 text-fg-secondary truncate hover:text-fg"
                >
                  {r.name}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
