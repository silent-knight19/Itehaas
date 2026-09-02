"use client";
import React, { useState } from "react";
import Link from "next/link";
import { GitCommit, Copy, Check, Calendar, User, ArrowRight, Clock, FileCode } from "lucide-react";
import { formatCommitDate } from "../lib/formatDate";

interface CommitHeaderProps {
  owner: string;
  repo: string;
  commit: {
    hash: string;
    author: string;
    committer?: string;
    message: string;
    parents: string[];
    tree?: string;
    date?: string;
  };
  stats?: { changedFiles: number; additions: number; deletions: number };
  parent?: string | null;
}

export function CommitHeader({ owner, repo, commit, stats, parent }: CommitHeaderProps) {
  const [copied, setCopied] = useState(false);
  const short = commit.hash.slice(0, 7);
  const authorName = commit.author?.split("<")[0]?.trim() || "Author";
  const authorEmail = commit.author?.match(/<([^>]+)>/)?.[1] || "";
  const msgFirst = commit.message.split("\n")[0] || "No message";
  const msgBody = commit.message.split("\n").slice(1).join("\n").trim();

  const copyHash = async () => {
    await navigator.clipboard.writeText(commit.hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="border border-border-subtle rounded-sm overflow-hidden bg-surface">
      {/* Title */}
      <div className="px-4 py-3 border-b border-border-subtle bg-bg-subtle">
        <h1 className="text-sm font-semibold text-fg leading-tight">{msgFirst}</h1>
        {msgBody && <p className="mt-1.5 text-xs text-fg-muted whitespace-pre-wrap">{msgBody}</p>}
      </div>

      {/* Meta */}
      <div className="px-4 py-3 bg-surface flex flex-wrap items-center gap-3 text-xs">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-full bg-gradient-to-br from-accent to-purple-600 flex items-center justify-center text-white font-mono text-[10px]">
            {authorName.slice(0, 2).toUpperCase()}
          </div>
          <span className="font-medium text-fg">{authorName}</span>
          {authorEmail && <span className="text-fg-muted hidden sm:inline">{authorEmail}</span>}
        </div>
        <span className="text-fg-subtle">•</span>
        <span className="flex items-center gap-1 text-fg-muted">
          <GitCommit className="h-3.5 w-3.5" />
          <span className="font-mono text-[11px] bg-bg-subtle border border-border-subtle rounded-sm px-1.5 py-0.5">{short}</span>
          <button onClick={copyHash} className="p-1 hover:bg-surface-hover rounded-sm">
            {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3 text-fg-muted" />}
          </button>
        </span>
        {commit.date && (
          <>
            <span className="text-fg-subtle hidden sm:inline">•</span>
            <span className="flex items-center gap-1 text-fg-muted">
              <Clock className="h-3 w-3" />
              {formatCommitDate(commit.date).relative}
            </span>
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Link
            href={`/${owner}/${repo}?branch=${commit.hash}`}
            className="px-2.5 py-1 text-xs font-medium border border-border-subtle rounded-sm bg-bg-subtle hover:bg-surface-hover text-fg"
          >
            Browse files
          </Link>
        </div>
      </div>

      {/* Parents & stats */}
      <div className="px-4 py-2 border-t border-border-subtle bg-bg-subtle flex flex-wrap items-center gap-3 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="text-fg-muted">Parents:</span>
          {commit.parents.length === 0 ? (
            <span className="font-mono text-fg-subtle">root • no parent</span>
          ) : (
            <div className="flex items-center gap-1.5">
              {commit.parents.map((p) => (
                <Link
                  key={p}
                  href={`/${owner}/${repo}/commit/${p}`}
                  className="font-mono text-[11px] px-1.5 py-0.5 rounded-sm bg-surface border border-border-subtle hover:border-accent text-accent"
                >
                  {p.slice(0, 7)}
                </Link>
              ))}
              {commit.parents.length > 1 && <span className="text-[11px] text-fg-muted">• merge</span>}
            </div>
          )}
        </div>
        {stats && (
          <div className="ml-auto flex items-center gap-2 font-mono text-[11px]">
            <span className="text-fg-muted">{stats.changedFiles} files changed</span>
            <span className="text-success">+{stats.additions}</span>
            <span className="text-danger">-{stats.deletions}</span>
          </div>
        )}
      </div>
    </div>
  );
}
