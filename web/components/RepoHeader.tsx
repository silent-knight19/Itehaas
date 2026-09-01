"use client";
import React, { useState } from "react";
import Link from "next/link";
import {
  FolderGit2,
  Lock,
  Globe,
  Star,
  Copy,
  ChevronDown,
  Terminal,
} from "lucide-react";
import { Api } from "../lib/api";
import { useToast } from "./Toast";

interface RepoHeaderProps {
  owner: string;
  repo: string;
  visibility: "public" | "private";
  defaultBranch?: string;
  description?: string;
  starsCount?: number;
  isStarred?: boolean;
  onStarChange?: (newCount: number, isStarred: boolean) => void;
}

export function RepoHeader({
  owner,
  repo,
  visibility,
  defaultBranch = "main",
  description,
  starsCount = 0,
  isStarred = false,
  onStarChange,
}: RepoHeaderProps) {
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneTab, setCloneTab] = useState<"cli" | "http">("cli");
  const [starring, setStarring] = useState(false);
  const [currentStars, setCurrentStars] = useState(starsCount);
  const [starred, setStarred] = useState(isStarred);

  const { toast } = useToast();

  const cliCloneCmd = `itehaas clone data/repos/${owner}/${repo} ${repo}`;
  const httpCloneCmd = `itehaas clone http://localhost:3001/api/repos/${owner}/${repo} ${repo}`;

  async function handleToggleStar() {
    if (starring) return;
    setStarring(true);
    const nextStarred = !starred;
    const nextCount = nextStarred ? currentStars + 1 : Math.max(0, currentStars - 1);

    setStarred(nextStarred);
    setCurrentStars(nextCount);
    if (onStarChange) onStarChange(nextCount, nextStarred);

    try {
      if (nextStarred) {
        await Api.starRepo(owner, repo);
        toast("Starred repository", "info");
      } else {
        await Api.unstarRepo(owner, repo);
        toast("Unstarred repository", "info");
      }
      const s = await Api.getStars(owner, repo);
      if (s.ok) {
        setCurrentStars(s.json.count);
        setStarred(s.json.starred);
      }
    } catch {
      setStarred(!nextStarred);
      setCurrentStars(starsCount);
    } finally {
      setStarring(false);
    }
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text);
    toast("Copied clone command", "info");
  }

  return (
    <div className="space-y-2 border-b border-border-subtle pb-3">
      {/* Top Identity Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <FolderGit2 className="h-4 w-4 text-fg-muted shrink-0" />
          <div className="flex items-center gap-1 text-sm font-medium">
            <span className="text-fg-muted font-normal">{owner}</span>
            <span className="text-fg-subtle font-normal mx-0.5">/</span>
            <span className="font-semibold text-fg tracking-tight">{repo}</span>
          </div>

          <span className="inline-flex items-center gap-1 text-[11px] text-fg-subtle ml-1">
            {visibility === "public" ? (
              <Globe className="h-2.5 w-2.5 text-fg-muted" />
            ) : (
              <Lock className="h-2.5 w-2.5 text-fg-muted" />
            )}
            <span className="capitalize">{visibility}</span>
          </span>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {/* Star Button */}
          <button
            onClick={handleToggleStar}
            disabled={starring}
            className={`flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-xs transition-colors ${
              starred
                ? "border-warning-border bg-warning-subtle text-warning font-medium"
                : "border-border-default bg-surface text-fg-secondary hover:border-border-emphasis hover:text-fg"
            }`}
          >
            <Star className={`h-3.5 w-3.5 ${starred ? "fill-warning text-warning" : "text-fg-muted"}`} />
            <span>{starred ? "Starred" : "Star"}</span>
            <span className="ml-0.5 text-[10px] text-fg-muted font-mono">
              {currentStars}
            </span>
          </button>

          {/* Clone Popover Trigger */}
          <div className="relative">
            <button
              onClick={() => setCloneOpen(!cloneOpen)}
              className="flex items-center gap-1.5 rounded-sm border border-border-default bg-surface px-2.5 py-1 text-xs text-fg-secondary hover:border-border-emphasis hover:text-fg transition-colors"
            >
              <Terminal className="h-3.5 w-3.5 text-fg-muted" />
              <span>Clone</span>
              <ChevronDown className="h-3 w-3 text-fg-subtle" />
            </button>

            {cloneOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setCloneOpen(false)} />
                <div className="absolute right-0 top-full mt-1.5 z-50 w-72 rounded-md border border-border-default bg-surface-overlay p-3 shadow-xl space-y-2 animate-fast">
                  <div className="flex items-center justify-between border-b border-border-subtle pb-1.5">
                    <span className="text-[11px] font-medium text-fg">Clone repository</span>
                    <div className="flex gap-1 text-[10px]">
                      <button
                        onClick={() => setCloneTab("cli")}
                        className={`px-1.5 py-0.5 rounded-xs ${
                          cloneTab === "cli" ? "bg-surface-active text-fg font-medium" : "text-fg-muted hover:text-fg"
                        }`}
                      >
                        Local
                      </button>
                      <button
                        onClick={() => setCloneTab("http")}
                        className={`px-1.5 py-0.5 rounded-xs ${
                          cloneTab === "http" ? "bg-surface-active text-fg font-medium" : "text-fg-muted hover:text-fg"
                        }`}
                      >
                        HTTPS
                      </button>
                    </div>
                  </div>

                  <div
                    onClick={() => copyText(cloneTab === "cli" ? cliCloneCmd : httpCloneCmd)}
                    className="flex items-center justify-between rounded-xs border border-border-subtle bg-bg-subtle p-2 font-mono text-[11px] text-fg-secondary cursor-pointer hover:border-border-emphasis"
                    title="Click to copy"
                  >
                    <span className="truncate select-all">{cloneTab === "cli" ? cliCloneCmd : httpCloneCmd}</span>
                    <Copy className="h-3 w-3 text-fg-muted shrink-0 ml-2" />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Description */}
      {description && (
        <p className="text-xs text-fg-muted leading-relaxed">
          {description}
        </p>
      )}
    </div>
  );
}
