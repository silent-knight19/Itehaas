"use client";
import React, { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  FolderGit2,
  Plus,
  Layers,
  CircleDot,
  GitPullRequest,
  PlayCircle,
  LogOut,
  LogIn,
  ExternalLink,
  Terminal,
  ArrowRight,
} from "lucide-react";
import { Api } from "../lib/api";

interface CommandItem {
  id: string;
  title: string;
  category: "Repositories" | "Navigation" | "Actions";
  icon: any;
  shortcut?: string;
  action: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [repos, setRepos] = useState<any[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      Api.listRepos({ all: true }).then((res) => {
        if (res.ok && res.json?.repos) {
          setRepos(res.json.repos);
        }
      });
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery("");
      setSelectedIndex(0);
    }
  }, [open]);

  // Build items
  const items: CommandItem[] = [
    // Repositories
    ...repos.map((r) => ({
      id: `repo-${r.owner}-${r.name}`,
      title: `${r.owner}/${r.name}`,
      category: "Repositories" as const,
      icon: FolderGit2,
      action: () => {
        router.push(`/${r.owner}/${r.name}`);
        onClose();
      },
    })),
    // Navigation
    {
      id: "nav-dashboard",
      title: "Go to Dashboard",
      category: "Navigation",
      icon: Layers,
      shortcut: "G D",
      action: () => {
        router.push("/");
        onClose();
      },
    },
    {
      id: "nav-api",
      title: "Fastify Engine Health (/health)",
      category: "Navigation",
      icon: ExternalLink,
      action: () => {
        window.open("http://localhost:3001/health", "_blank");
        onClose();
      },
    },
    // Actions
    {
      id: "action-new-repo",
      title: "Create New Repository",
      category: "Actions",
      icon: Plus,
      shortcut: "C R",
      action: () => {
        router.push("/?create=true");
        onClose();
      },
    },
  ];

  const filtered = items.filter((item) =>
    item.title.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(1, filtered.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filtered.length) % Math.max(1, filtered.length));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filtered[selectedIndex]) {
          filtered[selectedIndex].action();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, filtered, selectedIndex, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-black/60 backdrop-blur-xs animate-fast">
      <div
        className="fixed inset-0"
        onClick={onClose}
      />
      <div className="relative w-full max-w-xl rounded-lg border border-border bg-surface-overlay shadow-2xl overflow-hidden z-10 flex flex-col max-h-[70vh]">
        {/* Search Input */}
        <div className="flex items-center gap-2.5 border-b border-border-muted px-3.5 py-2.5 bg-surface">
          <Search className="h-4 w-4 text-fg-muted shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or search repositories…"
            className="w-full bg-transparent text-xs text-fg placeholder-fg-subtle focus:outline-none font-sans"
          />
          <kbd className="rounded-xs border border-border-muted bg-bg-subtle px-1.5 py-0.5 text-[10px] font-mono text-fg-muted">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-1.5 divide-y divide-border-muted/30">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-xs text-fg-muted font-mono">
              No matching commands or repositories found.
            </div>
          ) : (
            filtered.map((item, idx) => {
              const Icon = item.icon;
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={item.id}
                  onClick={() => item.action()}
                  className={`flex items-center justify-between rounded-sm px-2.5 py-2 text-xs cursor-pointer transition-colors ${
                    isSelected
                      ? "bg-accent-subtle text-fg"
                      : "text-fg-secondary hover:bg-surface-hover hover:text-fg"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon className={`h-3.5 w-3.5 shrink-0 ${isSelected ? "text-accent" : "text-fg-muted"}`} />
                    <span className="font-mono text-xs truncate">{item.title}</span>
                  </div>

                  <div className="flex items-center gap-2 text-[10px] font-mono text-fg-muted">
                    <span className="text-fg-subtle">{item.category}</span>
                    {item.shortcut && (
                      <kbd className="rounded-xs border border-border-muted bg-bg-subtle px-1 py-0.5">
                        {item.shortcut}
                      </kbd>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Command Footer */}
        <div className="flex items-center justify-between border-t border-border-muted bg-bg-subtle px-3 py-1.5 text-[10px] font-mono text-fg-muted">
          <span>Navigate with ↑ ↓ • Select with ↵</span>
          <span>Itehaas Command Engine</span>
        </div>
      </div>
    </div>
  );
}
