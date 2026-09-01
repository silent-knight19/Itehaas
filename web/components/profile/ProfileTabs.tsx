"use client";
import React from "react";
import Link from "next/link";
import { LayoutDashboard, FolderGit2, Star, Activity } from "lucide-react";

interface ProfileTabsProps {
  username: string;
  active: string;
  reposCount?: number;
  starsCount?: number;
}

export function ProfileTabs({ username, active, reposCount, starsCount }: ProfileTabsProps) {
  const base = `/${username}`;
  const tabs = [
    { id: "overview", label: "Overview", href: base, icon: LayoutDashboard, badge: null },
    { id: "repositories", label: "Repositories", href: `${base}?tab=repositories`, icon: FolderGit2, badge: typeof reposCount === "number" ? reposCount : null },
    { id: "stars", label: "Starred", href: `${base}?tab=stars`, icon: Star, badge: typeof starsCount === "number" ? starsCount : null },
    { id: "activity", label: "Activity", href: `${base}?tab=activity`, icon: Activity, badge: null },
  ];

  return (
    <nav className="flex border-b border-border-subtle gap-1 overflow-x-auto select-none">
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        const Icon = tab.icon;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            className={`group relative flex items-center gap-1.5 px-3 py-2 text-xs transition-colors ${
              isActive ? "text-fg font-medium" : "text-fg-muted hover:text-fg"
            }`}
          >
            <Icon className={`h-3.5 w-3.5 ${isActive ? "text-fg" : "text-fg-muted group-hover:text-fg"}`} />
            <span>{tab.label}</span>
            {tab.badge !== null && (
              <span
                className={`ml-0.5 rounded-xs px-1.5 py-0.1 text-[10px] font-mono ${
                  isActive
                    ? "bg-surface-active text-fg border border-border-subtle"
                    : "bg-surface text-fg-muted border border-border-subtle"
                }`}
              >
                {tab.badge}
              </span>
            )}
            {isActive && <span className="absolute inset-x-0 bottom-0 h-[1.5px] bg-accent" />}
          </Link>
        );
      })}
    </nav>
  );
}
