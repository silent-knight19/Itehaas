"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Layers,
  Terminal,
  Activity,
  User as UserIcon,
  LogOut,
  LogIn,
  Plus,
  GitBranch,
  Shield,
  Search,
  ExternalLink,
} from "lucide-react";
import { Api } from "../lib/api";

export function Navbar() {
  const [user, setUser] = useState<{ id: string; username: string; email: string } | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [isHealthy, setIsHealthy] = useState<boolean>(true);
  const pathname = usePathname();
  const router = useRouter();

  async function checkUserAndHealth() {
    const start = performance.now();
    try {
      const h = await Api.health();
      const end = performance.now();
      if (h.ok) {
        setIsHealthy(true);
        setLatency(Math.round(end - start));
      } else {
        setIsHealthy(false);
      }
    } catch {
      setIsHealthy(false);
    }

    try {
      const me = await Api.me();
      if (me.ok && me.json?.user) {
        setUser(me.json.user);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    }
  }

  useEffect(() => {
    checkUserAndHealth();
    const interval = setInterval(checkUserAndHealth, 15000);
    return () => clearInterval(interval);
  }, [pathname]);

  async function handleLogout() {
    await Api.logout();
    setUser(null);
    router.push("/login");
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/[0.08] bg-[#090a0f]/80 backdrop-blur-xl transition-all">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Left: Brand & Navigation */}
        <div className="flex items-center gap-8">
          <Link href="/" className="group flex items-center gap-3">
            <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-purple-500 shadow-md shadow-indigo-500/20 ring-1 ring-white/20 transition-all group-hover:scale-105 group-hover:shadow-indigo-500/40">
              <Layers className="h-5 w-5 text-white" />
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="font-bold tracking-tight text-white font-sans text-lg">
                  Itehaas
                </span>
                <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium tracking-wide text-indigo-400">
                  CAS v1.0
                </span>
              </div>
              <span className="text-[11px] font-mono text-zinc-400">
                Rust VCS Core
              </span>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            <Link
              href="/"
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                pathname === "/"
                  ? "bg-zinc-800/80 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
              }`}
            >
              Dashboard
            </Link>
            <a
              href="http://localhost:3001/health"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40 rounded-lg transition-colors"
            >
              <span>API</span>
              <ExternalLink className="h-3.5 w-3.5 opacity-60" />
            </a>
          </nav>
        </div>

        {/* Right: Server Health & User Actions */}
        <div className="flex items-center gap-3">
          {/* Health Pill */}
          <div
            className="hidden sm:flex items-center gap-2 rounded-full border border-white/[0.08] bg-zinc-900/60 px-3 py-1 text-xs font-mono text-zinc-300"
            title="Fastify Backend Server Connection"
          >
            <span className="relative flex h-2 w-2">
              {isHealthy && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              )}
              <span
                className={`relative inline-flex h-2 w-2 rounded-full ${
                  isHealthy ? "bg-emerald-500" : "bg-rose-500"
                }`}
              ></span>
            </span>
            <span className="text-zinc-400">Engine:</span>
            <span className={isHealthy ? "text-emerald-400 font-medium" : "text-rose-400"}>
              {isHealthy ? (latency !== null ? `${latency}ms` : "Live") : "Offline"}
            </span>
          </div>

          {user ? (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2.5 rounded-full border border-white/[0.08] bg-zinc-900/80 py-1 pl-1.5 pr-3 shadow-inner">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-tr from-purple-600 to-indigo-600 font-mono text-xs font-semibold text-white shadow-sm ring-1 ring-white/20">
                  {user.username.slice(0, 2).toUpperCase()}
                </div>
                <span className="text-xs font-medium text-zinc-200">
                  {user.username}
                </span>
              </div>

              <button
                onClick={handleLogout}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-700/60 bg-zinc-800/60 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-700/60 hover:text-white"
                title="Sign out"
              >
                <LogOut className="h-3.5 w-3.5 text-zinc-400" />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href="/login"
                className="flex items-center gap-1.5 rounded-lg border border-zinc-700/60 bg-zinc-800/60 px-3.5 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-700/60 hover:text-white"
              >
                <LogIn className="h-3.5 w-3.5 text-zinc-400" />
                <span>Log In</span>
              </Link>
              <Link
                href="/register"
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-medium text-white shadow-md shadow-indigo-600/20 transition-all hover:bg-indigo-500 hover:shadow-indigo-600/40"
              >
                <span>Register</span>
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
