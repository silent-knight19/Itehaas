"use client";
import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Code2,
  GitCommit,
  GitBranch,
  CircleDot,
  GitPullRequest,
  PlayCircle,
} from "lucide-react";

interface RepoTabsProps {
  owner: string;
  repo: string;
  issuesCount?: number;
  pullsCount?: number;
  ciStatus?: string;
}

export function RepoTabs({
  owner,
  repo,
  issuesCount,
  pullsCount,
  ciStatus,
}: RepoTabsProps) {
  const pathname = usePathname();
  const basePath = `/${owner}/${repo}`;

  const isCode = pathname === basePath;
  const isCommits = pathname.startsWith(`${basePath}/commits`);
  const isBranches = pathname.startsWith(`${basePath}/branches`);
  const isIssues = pathname.startsWith(`${basePath}/issues`);
  const isPulls = pathname.startsWith(`${basePath}/pulls`);
  const isCi = pathname.startsWith(`${basePath}/ci`);

  const tabs = [
    {
      id: "code",
      label: "Code",
      href: basePath,
      icon: Code2,
      active: isCode,
      badge: null,
    },
    {
      id: "commits",
      label: "Commits",
      href: `${basePath}/commits`,
      icon: GitCommit,
      active: isCommits,
      badge: null,
    },
    {
      id: "branches",
      label: "Branches",
      href: `${basePath}/branches`,
      icon: GitBranch,
      active: isBranches,
      badge: null,
    },
    {
      id: "issues",
      label: "Issues",
      href: `${basePath}/issues`,
      icon: CircleDot,
      active: isIssues,
      badge: typeof issuesCount === "number" ? issuesCount : null,
    },
    {
      id: "pulls",
      label: "Pull Requests",
      href: `${basePath}/pulls`,
      icon: GitPullRequest,
      active: isPulls,
      badge: typeof pullsCount === "number" ? pullsCount : null,
    },
    {
      id: "ci",
      label: "CI",
      href: `${basePath}/ci`,
      icon: PlayCircle,
      active: isCi,
      badge: ciStatus ? (
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            ciStatus === "success"
              ? "bg-success"
              : ciStatus === "failed"
              ? "bg-danger"
              : "bg-warning"
          }`}
        />
      ) : null,
    },
  ];

  return (
    <nav className="flex border-b border-border-subtle gap-1 overflow-x-auto select-none">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            className={`group relative flex items-center gap-1.5 px-3 py-2 text-xs transition-colors ${
              tab.active
                ? "text-fg font-medium"
                : "text-fg-muted hover:text-fg"
            }`}
          >
            <Icon
              className={`h-3.5 w-3.5 ${
                tab.active ? "text-fg" : "text-fg-muted group-hover:text-fg"
              }`}
            />
            <span>{tab.label}</span>

            {tab.badge !== null && (
              <span
                className={`ml-0.5 rounded-xs px-1.5 py-0.1 text-[10px] font-mono ${
                  tab.active
                    ? "bg-surface-active text-fg border border-border-subtle"
                    : "bg-surface text-fg-muted border border-border-subtle"
                }`}
              >
                {tab.badge}
              </span>
            )}

            {tab.active && (
              <span className="absolute inset-x-0 bottom-0 h-[1.5px] bg-accent" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
