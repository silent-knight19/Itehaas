"use client";
import React from "react";
import {
  Folder,
  FileCode,
  FileText,
  FileSpreadsheet,
  File,
  Code,
  Clock,
} from "lucide-react";
import { formatCommitDate } from "../lib/formatDate";

export interface TreeEntry {
  mode: string;
  hash: string;
  name: string;
}

interface FileTreeProps {
  entries: TreeEntry[];
  onSelectFile: (hash: string, name: string) => void;
  selectedFileName?: string | null;
  latestCommit?: { hash: string; message: string; author?: string; date?: string } | null;
}

function getFileIcon(name: string, mode: string) {
  if (mode === "040000" || mode.startsWith("04")) {
    return <Folder className="h-3.5 w-3.5 text-fg-muted" />;
  }
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "rs":
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
      return <FileCode className="h-3.5 w-3.5 text-fg-muted" />;
    case "md":
    case "txt":
      return <FileText className="h-3.5 w-3.5 text-fg-muted" />;
    case "json":
    case "toml":
    case "yaml":
    case "yml":
      return <FileSpreadsheet className="h-3.5 w-3.5 text-fg-muted" />;
    default:
      return <File className="h-3.5 w-3.5 text-fg-muted" />;
  }
}

export function FileTree({
  entries,
  onSelectFile,
  selectedFileName,
  latestCommit,
}: FileTreeProps) {
  return (
    <div className="border border-border-subtle rounded-sm overflow-hidden bg-surface">
      {/* Latest Commit Bar */}
      {latestCommit && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle bg-bg-subtle px-3 py-2 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-medium text-fg text-xs shrink-0">
              {latestCommit.author?.split("<")[0].trim() || "Author"}
            </span>
            <span className="truncate text-fg-muted text-[11px]">
              {latestCommit.message}
            </span>
          </div>

          <div className="flex items-center gap-2 font-mono text-[11px] text-fg-subtle">
            <span className="rounded-xs border border-border-subtle bg-bg-subtle px-1 py-0.5">
              {latestCommit.hash.slice(0, 7)}
            </span>
            {latestCommit.date &&
              (() => {
                const { relative, absolute, hasDate } = formatCommitDate(latestCommit.date);
                return (
                  <span
                    className="hidden items-center gap-1 sm:inline-flex text-fg-muted"
                    title={hasDate ? absolute : latestCommit.date!}
                  >
                    <span>•</span>
                    <Clock className="h-3 w-3 text-fg-subtle" />
                    <span>{relative}</span>
                  </span>
                );
              })()}
          </div>
        </div>
      )}

      {/* Files List */}
      {entries.length === 0 ? (
        <div className="p-8 text-center text-xs text-fg-muted font-mono">
          No files present in repository tree.
        </div>
      ) : (
        <div className="divide-y divide-border-subtle">
          {entries.map((entry) => {
            const isSelected = selectedFileName === entry.name;
            return (
              <div
                key={entry.hash + entry.name}
                onClick={() => onSelectFile(entry.hash, entry.name)}
                className={`group flex items-center justify-between px-3 py-1.5 text-xs cursor-pointer transition-colors ${
                  isSelected
                    ? "bg-surface-active text-fg"
                    : "hover:bg-surface-hover/50 text-fg-secondary"
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="shrink-0">{getFileIcon(entry.name, entry.mode)}</div>
                  <span className="font-mono text-xs group-hover:text-fg transition-colors truncate">
                    {entry.name}
                  </span>
                  {entry.mode === "100755" && (
                    <span className="rounded-xs border border-border-subtle bg-bg-subtle px-1 py-0.1 text-[9px] font-mono text-fg-muted">
                      exec
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <span className="font-mono text-[11px] text-fg-subtle">
                    {entry.hash.slice(0, 7)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
