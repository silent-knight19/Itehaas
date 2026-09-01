"use client";
import React, { useState } from "react";
import { Calendar, Star, FolderGit2 } from "lucide-react";
import { formatCommitDate } from "../../lib/formatDate";

interface ProfileHeaderProps {
  user: {
    id: string;
    username: string;
    email: string;
    bio: string;
    avatar_url: string | null;
    created_at: string;
  };
  counts: {
    reposOwned: number;
    starsReceived: number;
    starsGiven: number;
    activityCount: number;
  };
  isOwn: boolean;
  onEdit: () => void;
}

function getInitials(username: string): string {
  const clean = username.replace(/[^a-zA-Z0-9]/g, "");
  if (clean.length >= 2) return clean.slice(0, 2).toUpperCase();
  return username.slice(0, 2).toUpperCase();
}

export function ProfileHeader({ user, counts, isOwn, onEdit }: ProfileHeaderProps) {
  const joined = formatCommitDate(new Date(user.created_at).toISOString());
  // For created_at from DB, it's ISO string; format via existing helper fallback handles ISO
  const joinedLabel = (() => {
    try {
      const d = new Date(user.created_at);
      return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(d);
    } catch {
      return "";
    }
  })();

  return (
    <div className="space-y-3">
      {/* Avatar + Name */}
      <div className="flex gap-3">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-surface border border-border-subtle font-mono text-sm font-semibold text-fg select-none">
          {getInitials(user.username)}
        </div>
        <div className="min-w-0 flex-1 space-y-0.5 pt-0.5">
          <div className="text-sm font-semibold text-fg tracking-tight truncate">{user.username}</div>
          <div className="text-xs text-fg-muted truncate">@{user.username}</div>
          <div className="flex items-center gap-1.5 text-[11px] text-fg-muted pt-1">
            <Calendar className="h-3 w-3 text-fg-subtle" />
            <span>Joined {joinedLabel}</span>
          </div>
        </div>
      </div>

      {/* Bio */}
      {user.bio ? (
        <p className="text-xs text-fg-secondary leading-relaxed whitespace-pre-wrap break-words">
          {user.bio}
        </p>
      ) : isOwn ? (
        <p className="text-xs text-fg-subtle italic">No bio yet — add a short description of your work.</p>
      ) : null}

      {/* Edit */}
      {isOwn && (
        <button
          onClick={onEdit}
          className="w-full rounded-sm border border-border-default bg-surface px-2.5 py-1.5 text-xs font-medium text-fg-secondary hover:border-border-emphasis hover:text-fg transition-colors"
        >
          Edit profile
        </button>
      )}

      {/* Counters */}
      <div className="flex flex-wrap gap-3 pt-2 border-t border-border-subtle text-[11px]">
        <span className="inline-flex items-center gap-1 text-fg-muted">
          <FolderGit2 className="h-3 w-3 text-fg-subtle" />
          <span className="font-mono font-medium text-fg">{counts.reposOwned}</span>
          <span>repos</span>
        </span>
        <span className="inline-flex items-center gap-1 text-fg-muted">
          <Star className="h-3 w-3 text-fg-subtle" />
          <span className="font-mono font-medium text-fg">{counts.starsReceived}</span>
          <span>stars received</span>
        </span>
        <span className="inline-flex items-center gap-1 text-fg-muted">
          <Star className="h-3 w-3 text-fg-subtle" />
          <span className="font-mono font-medium text-fg">{counts.starsGiven}</span>
          <span>starred</span>
        </span>
      </div>
    </div>
  );
}
