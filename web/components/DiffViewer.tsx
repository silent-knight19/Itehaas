"use client";
import React, { useState, useEffect, useMemo } from "react";
import {
  GitCompare,
  Plus,
  Minus,
  FileCode,
  File,
  Eye,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Columns,
  Rows,
  Image as ImageIcon,
} from "lucide-react";

export interface FileDiff {
  path: string;
  newPath?: string | null;
  status: string;
  similarity?: number | null;
  patch: string;
  additions: number;
  deletions: number;
  isBinary: boolean;
  isImage: boolean;
  oldHash?: string;
  newHash?: string;
}

interface DiffViewerProps {
  diffText?: string;
  files?: FileDiff[];
  stats?: { changedFiles: number; additions: number; deletions: number };
  hideStatsBar?: boolean;
  onFileClick?: (path: string) => void;
}

// Helper: File icon
function getStatusColor(status: string) {
  switch (status) {
    case "added":
      return "text-success bg-success-subtle border-success/20";
    case "deleted":
      return "text-danger bg-danger-subtle border-danger/20";
    case "renamed":
      return "text-accent bg-accent-subtle border-accent/20";
    case "modified":
      return "text-warning bg-warning/10 border-warning/20";
    default:
      return "text-fg-muted bg-surface border-border-subtle";
  }
}
function getStatusDot(status: string) {
  switch (status) {
    case "added":
      return "bg-success";
    case "deleted":
      return "bg-danger";
    case "renamed":
      return "bg-accent";
    default:
      return "bg-warning";
  }
}

// Parse hunk header @@ -a,b +c,d @@
function parseHunkHeader(line: string): { oldStart: number; newStart: number } | null {
  const m = line.match(/^@@ -(\d+),?\d* \+(\d+),?\d* @@/);
  if (!m) return null;
  return { oldStart: parseInt(m[1], 10), newStart: parseInt(m[2], 10) };
}

// Word-level highlight helper (simple)
function highlightInline(oldLine: string, newLine: string) {
  // Tokenize by words
  const oldWords = oldLine.split(/(\W+)/);
  const newWords = newLine.split(/(\W+)/);
  // Simple LCS for demo: highlight words not in common
  // For now, return plain (future: inline highlight)
  return { oldHighlighted: oldLine, newHighlighted: newLine };
}

function UnifiedFileView({ file, hideWhitespace }: { file: FileDiff; hideWhitespace: boolean }) {
  let content = file.patch || "";
  if (hideWhitespace) {
    // Hide whitespace changes: normalize patch for display? Simple: filter lines where trimmed content same
    // For MVP, just don't highlight whitespace-only changes - we keep patch as is but could hide
  }
  const lines = content.split("\n");
  // Find first hunk to skip file headers for line numbers? Keep all
  return (
    <div className="overflow-x-auto text-xs font-mono leading-5">
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((line, idx) => {
            let rowStyle = "text-fg-secondary";
            let lineNum: string | number = idx + 1;
            // Determine style
            if (line.startsWith("diff --itehaas") || line.startsWith("+++") || line.startsWith("---")) {
              rowStyle = "bg-surface text-fg-muted font-medium text-[11px]";
              lineNum = "";
            } else if (line.startsWith("@@")) {
              rowStyle = "bg-accent-subtle text-accent font-medium";
              lineNum = "";
            } else if (line.startsWith("+")) {
              rowStyle = "bg-success-subtle text-success";
            } else if (line.startsWith("-")) {
              rowStyle = "bg-danger-subtle text-danger";
            } else if (line.startsWith(" ")) {
              rowStyle = "text-fg-secondary";
            }

            // For real line numbers, parse hunk headers - simplified: show idx for now but with hunk awareness
            return (
              <tr key={idx} className={`${rowStyle} hover:bg-surface-hover/20`}>
                <td className="w-10 select-none pr-2 text-right text-fg-subtle font-mono text-[10px] tabular-nums border-r border-border-subtle/50">
                  {typeof lineNum === "number" ? lineNum : ""}
                </td>
                <td className="whitespace-pre px-3 font-mono text-xs">
                  {line || " "}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SplitFileView({ file }: { file: FileDiff }) {
  const lines = (file.patch || "").split("\n");
  // Build split rows
  type SplitRow = {
    leftNum: string | number;
    rightNum: string | number;
    leftContent: string;
    rightContent: string;
    leftStyle: string;
    rightStyle: string;
    isHunk: boolean;
  };
  const rows: SplitRow[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const line of lines) {
    if (line.startsWith("diff --itehaas") || line.startsWith("---") || line.startsWith("+++")) {
      rows.push({
        leftNum: "",
        rightNum: "",
        leftContent: line,
        rightContent: "",
        leftStyle: "bg-surface text-fg-muted",
        rightStyle: "bg-surface text-fg-muted",
        isHunk: false,
      });
      continue;
    }
    if (line.startsWith("@@")) {
      const parsed = parseHunkHeader(line);
      if (parsed) {
        oldLine = parsed.oldStart;
        newLine = parsed.newStart;
      }
      rows.push({
        leftNum: "",
        rightNum: "",
        leftContent: line,
        rightContent: line,
        leftStyle: "bg-accent-subtle text-accent",
        rightStyle: "bg-accent-subtle text-accent",
        isHunk: true,
      });
      inHunk = true;
      continue;
    }
    if (!inHunk && (line.startsWith("+") || line.startsWith("-") || line.startsWith(" "))) {
      // Before first hunk, treat as unified
    }
    if (line.startsWith(" ")) {
      const content = line.slice(1);
      rows.push({
        leftNum: oldLine,
        rightNum: newLine,
        leftContent: content,
        rightContent: content,
        leftStyle: "text-fg-secondary",
        rightStyle: "text-fg-secondary",
        isHunk: false,
      });
      oldLine++;
      newLine++;
    } else if (line.startsWith("-")) {
      const content = line.slice(1);
      rows.push({
        leftNum: oldLine,
        rightNum: "",
        leftContent: content,
        rightContent: "",
        leftStyle: "bg-danger-subtle text-danger",
        rightStyle: "bg-surface",
        isHunk: false,
      });
      oldLine++;
    } else if (line.startsWith("+")) {
      const content = line.slice(1);
      rows.push({
        leftNum: "",
        rightNum: newLine,
        leftContent: "",
        rightContent: content,
        leftStyle: "bg-surface",
        rightStyle: "bg-success-subtle text-success",
        isHunk: false,
      });
      newLine++;
    } else if (line === "") {
      rows.push({
        leftNum: "",
        rightNum: "",
        leftContent: "",
        rightContent: "",
        leftStyle: "",
        rightStyle: "",
        isHunk: false,
      });
    } else {
      rows.push({
        leftNum: "",
        rightNum: "",
        leftContent: line,
        rightContent: line,
        leftStyle: "text-fg-muted",
        rightStyle: "text-fg-muted",
        isHunk: false,
      });
    }
  }

  return (
    <div className="overflow-x-auto border-t border-border-subtle">
      <table className="w-full border-collapse text-xs font-mono leading-5">
        <tbody>
          {rows.map((r, idx) => (
            <tr key={idx} className="hover:bg-surface-hover/20">
              <td className="w-10 select-none pr-2 text-right text-fg-subtle text-[10px] tabular-nums border-r border-border-subtle/30 bg-surface/50">
                {r.leftNum}
              </td>
              <td className={`whitespace-pre px-2 w-1/2 border-r border-border-subtle/30 ${r.leftStyle}`}>
                {r.leftContent || (r.rightContent ? "" : " ")}
              </td>
              <td className="w-10 select-none pr-2 text-right text-fg-subtle text-[10px] tabular-nums border-r border-border-subtle/30 bg-surface/50">
                {r.rightNum}
              </td>
              <td className={`whitespace-pre px-2 w-1/2 ${r.rightStyle}`}>
                {r.rightContent || (r.leftContent ? "" : " ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ImageDiffView({ file }: { file: FileDiff }) {
  const [mode, setMode] = useState<"2up" | "swipe" | "onion">("2up");
  const [swipe, setSwipe] = useState(50);
  const [onionOpacity, setOnionOpacity] = useState(50);
  // For MVP, show placeholder since we don't have blob URLs. In real, fetch via /file or /objects
  return (
    <div className="p-4 bg-surface">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[11px] font-mono text-fg-muted">Image diff:</span>
        {(["2up", "swipe", "onion"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-2 py-1 text-xs rounded-sm border font-medium capitalize ${
              mode === m ? "bg-accent text-white border-accent" : "bg-surface border-border-subtle text-fg-muted hover:bg-surface-hover"
            }`}
          >
            {m === "2up" ? "2-up" : m}
          </button>
        ))}
      </div>
      {mode === "2up" && (
        <div className="grid grid-cols-2 gap-4">
          <div className="border border-border-subtle rounded-sm bg-bg-subtle p-8 text-center">
            <ImageIcon className="h-8 w-8 mx-auto text-fg-muted mb-2" />
            <div className="text-xs text-fg-muted font-mono">Old: {file.path}</div>
            <div className="text-[10px] text-fg-subtle">Binary image • use raw view to download</div>
          </div>
          <div className="border border-border-subtle rounded-sm bg-bg-subtle p-8 text-center">
            <ImageIcon className="h-8 w-8 mx-auto text-fg-muted mb-2" />
            <div className="text-xs text-fg-muted font-mono">New: {file.newPath || file.path}</div>
            <div className="text-[10px] text-fg-subtle">Binary image</div>
          </div>
        </div>
      )}
      {mode === "swipe" && (
        <div className="space-y-3">
          <div className="relative h-64 border border-border-subtle rounded-sm overflow-hidden bg-bg-subtle">
            <div className="absolute inset-0 flex items-center justify-center bg-success/10 border border-success/20">
              <span className="text-xs font-mono text-success">New image</span>
            </div>
            <div
              className="absolute inset-y-0 left-0 flex items-center justify-center bg-danger/10 border-r-2 border-danger/30 overflow-hidden"
              style={{ width: `${swipe}%` }}
            >
              <span className="text-xs font-mono text-danger">Old image</span>
            </div>
            <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-accent/50 pointer-events-none" style={{ display: "none" }} />
          </div>
          <input type="range" min={0} max={100} value={swipe} onChange={(e) => setSwipe(parseInt(e.target.value, 10))} className="w-full" />
        </div>
      )}
      {mode === "onion" && (
        <div className="space-y-3">
          <div className="relative h-64 border border-border-subtle rounded-sm overflow-hidden bg-bg-subtle flex items-center justify-center">
            <div className="absolute inset-0 flex items-center justify-center bg-danger/10">
              <span className="text-xs font-mono text-danger">Old</span>
            </div>
            <div className="absolute inset-0 flex items-center justify-center bg-success/10" style={{ opacity: onionOpacity / 100 }}>
              <span className="text-xs font-mono text-success">New (opacity {onionOpacity}%)</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-fg-muted">Opacity</span>
            <input type="range" min={0} max={100} value={onionOpacity} onChange={(e) => setOnionOpacity(parseInt(e.target.value, 10))} className="flex-1" />
            <span className="text-xs font-mono text-fg-muted">{onionOpacity}%</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function DiffViewer({ diffText, files, stats, hideStatsBar }: DiffViewerProps) {
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified");
  const [hideWhitespace, setHideWhitespace] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [viewed, setViewed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  // Load viewed from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`viewed:${typeof window !== "undefined" ? window.location.pathname : ""}`);
      if (saved) setViewed(new Set(JSON.parse(saved)));
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(`viewed:${typeof window !== "undefined" ? window.location.pathname : ""}`, JSON.stringify([...viewed]));
    } catch {}
  }, [viewed]);

  const toggleViewed = (path: string) => {
    setViewed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleExpanded = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setCopiedPath(path);
      setTimeout(() => setCopiedPath(null), 1500);
    } catch {}
  };

  // Legacy single diffText mode (for PRs)
  if (!files || files.length === 0) {
    if (!diffText || !diffText.trim()) {
      return (
        <div className="py-8 text-center text-xs text-fg-muted font-mono border border-border-subtle rounded-sm">
          No differences.
        </div>
      );
    }
    const lines = diffText.split("\n");
    let additions = 0;
    let deletions = 0;
    lines.forEach((line) => {
      if (line.startsWith("+") && !line.startsWith("+++")) additions++;
      if (line.startsWith("-") && !line.startsWith("---")) deletions++;
    });
    return (
      <div className="border border-border-subtle rounded-sm overflow-hidden bg-bg-subtle">
        <div className="flex items-center justify-between border-b border-border-subtle bg-surface px-3 py-1.5">
          <div className="flex items-center gap-1.5">
            <GitCompare className="h-3.5 w-3.5 text-fg-muted" />
            <span className="text-xs font-medium text-fg">Unified Diff</span>
          </div>
          <div className="flex items-center gap-2 font-mono text-[11px]">
            <span className="flex items-center gap-0.5 text-success">
              <Plus className="h-3 w-3" />
              <span>{additions}</span>
            </span>
            <span className="flex items-center gap-0.5 text-danger">
              <Minus className="h-3 w-3" />
              <span>{deletions}</span>
            </span>
          </div>
        </div>
        <div className="overflow-x-auto p-2 text-xs font-mono leading-relaxed select-text max-h-[600px] overflow-y-auto">
          <table className="w-full border-collapse">
            <tbody>
              {lines.map((line, idx) => {
                let rowStyle = "hover:bg-surface-hover/30 text-fg-secondary";
                if (line.startsWith("+++") || line.startsWith("---")) rowStyle = "bg-surface text-fg-muted font-medium";
                else if (line.startsWith("@@")) rowStyle = "bg-accent-subtle text-accent";
                else if (line.startsWith("+")) rowStyle = "bg-success-subtle text-success";
                else if (line.startsWith("-")) rowStyle = "bg-danger-subtle text-danger";
                return (
                  <tr key={idx} className={`${rowStyle} transition-colors`}>
                    <td className="w-8 select-none pr-2 text-right text-fg-subtle font-mono text-[10px] tabular-nums">{idx + 1}</td>
                    <td className="whitespace-pre px-2 font-mono text-xs">{line || " "}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // File-aware mode
  const filteredFiles = useMemo(() => {
    if (!filter.trim()) return files;
    const q = filter.toLowerCase();
    return files.filter((f) => f.path.toLowerCase().includes(q) || (f.newPath && f.newPath.toLowerCase().includes(q)));
  }, [files, filter]);

  const totalAdd = stats?.additions ?? files.reduce((a, f) => a + f.additions, 0);
  const totalDel = stats?.deletions ?? files.reduce((a, f) => a + f.deletions, 0);
  const totalChanged = stats?.changedFiles ?? files.length;
  const viewedCount = viewed.size;
  const percentViewed = totalChanged ? Math.round((viewedCount / totalChanged) * 100) : 0;

  return (
    <div className="border border-border-subtle rounded-sm overflow-hidden bg-bg-subtle">
      {/* Stats bar */}
      {!hideStatsBar && (
        <div className="border-b border-border-subtle bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
            <div className="flex items-center gap-3 text-xs">
              <span className="font-medium text-fg flex items-center gap-1.5">
                <GitCompare className="h-3.5 w-3.5 text-fg-muted" />
                {totalChanged} files changed
              </span>
              <span className="flex items-center gap-1 font-mono text-[11px]">
                <span className="text-success flex items-center gap-0.5">
                  <Plus className="h-3 w-3" /> {totalAdd}
                </span>
                <span className="text-danger flex items-center gap-0.5">
                  <Minus className="h-3 w-3" /> {totalDel}
                </span>
              </span>
              {/* Diff stat bar */}
              <div className="hidden sm:flex h-1.5 w-24 rounded-full overflow-hidden bg-border-subtle">
                <div className="bg-success h-full" style={{ width: `${totalAdd + totalDel ? (totalAdd / (totalAdd + totalDel)) * 100 : 0}%` }} />
                <div className="bg-danger h-full flex-1" />
              </div>
              {totalChanged > 0 && (
                <span className="hidden md:inline text-[11px] text-fg-muted font-mono">
                  {viewedCount}/{totalChanged} viewed ({percentViewed}%)
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex rounded-sm border border-border-subtle overflow-hidden">
                <button
                  onClick={() => setViewMode("unified")}
                  className={`px-2.5 py-1 text-xs font-medium flex items-center gap-1 ${viewMode === "unified" ? "bg-accent text-white" : "bg-surface text-fg-muted hover:bg-surface-hover"}`}
                >
                  <Rows className="h-3 w-3" /> Unified
                </button>
                <button
                  onClick={() => setViewMode("split")}
                  className={`px-2.5 py-1 text-xs font-medium flex items-center gap-1 border-l border-border-subtle ${viewMode === "split" ? "bg-accent text-white" : "bg-surface text-fg-muted hover:bg-surface-hover"}`}
                >
                  <Columns className="h-3 w-3" /> Split
                </button>
              </div>
              <label className="hidden sm:flex items-center gap-1.5 text-xs text-fg-muted cursor-pointer">
                <input type="checkbox" checked={hideWhitespace} onChange={(e) => setHideWhitespace(e.target.checked)} className="rounded-sm" />
                Hide whitespace
              </label>
            </div>
          </div>
          {/* Filter bar */}
          {files.length > 5 && (
            <div className="border-t border-border-subtle px-3 py-2 bg-bg-subtle flex items-center gap-2">
              <input
                placeholder="Filter changed files…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="flex-1 max-w-xs px-2 py-1 text-xs bg-surface border border-border-subtle rounded-sm placeholder:text-fg-subtle focus:outline-none focus:border-accent"
              />
              <span className="text-[11px] text-fg-subtle font-mono">
                {filteredFiles.length}/{files.length} files
              </span>
            </div>
          )}
        </div>
      )}

      {/* File list */}
      <div className="divide-y divide-border-subtle">
        {filteredFiles.length === 0 ? (
          <div className="p-8 text-center text-xs text-fg-muted font-mono">No files match filter.</div>
        ) : (
          filteredFiles.map((file) => {
            const key = file.path + (file.newPath || "");
            const isExpanded = expanded.has(key) || filteredFiles.length <= 8; // auto-expand first 8
            const isViewed = viewed.has(key);
            const displayPath = file.newPath ? `${file.path} → ${file.newPath}` : file.path;
            const isBinary = file.isBinary;
            const isImage = file.isImage;
            const patch = file.patch || "";
            const isLarge = patch.split("\n").length > 2000;

            return (
              <div key={key} className="bg-surface">
                {/* File header */}
                <div
                  className={`flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-surface-hover/50 border-l-2 ${isViewed ? "border-success/40 bg-success/5" : "border-transparent"}`}
                  onClick={() => toggleExpanded(key)}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <button className="shrink-0 text-fg-muted hover:text-fg">
                      {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </button>
                    <span className={`h-2 w-2 rounded-full shrink-0 ${getStatusDot(file.status)}`} />
                    <span className="font-mono text-xs truncate text-fg" title={displayPath}>
                      {displayPath}
                    </span>
                    <span className={`hidden sm:inline px-1.5 py-0.5 text-[10px] font-mono rounded-sm border ${getStatusColor(file.status)}`}>
                      {file.status}
                      {file.similarity ? ` ${file.similarity}%` : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="hidden sm:flex items-center gap-1 font-mono text-[11px]">
                      {file.additions > 0 && <span className="text-success">+{file.additions}</span>}
                      {file.deletions > 0 && <span className="text-danger">-{file.deletions}</span>}
                    </span>
                    <span className="hidden md:block h-1 w-12 rounded-full overflow-hidden bg-border-subtle">
                      <span className="block h-full bg-success" style={{ width: `${file.additions + file.deletions ? (file.additions / (file.additions + file.deletions)) * 100 : 0}%` }} />
                    </span>
                    <label
                      className="flex items-center gap-1 text-xs text-fg-muted hover:text-fg cursor-pointer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input type="checkbox" checked={isViewed} onChange={() => toggleViewed(key)} className="rounded-sm h-3 w-3" />
                      <span className="hidden sm:inline">Viewed</span>
                      <Eye className="h-3 w-3" />
                    </label>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        copyPath(displayPath);
                      }}
                      className="p-1 rounded-sm hover:bg-surface-hover text-fg-muted hover:text-fg"
                      title="Copy path"
                    >
                      {copiedPath === displayPath ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                    </button>
                  </div>
                </div>

                {/* File content */}
                {isExpanded && (
                  <div className="border-t border-border-subtle">
                    {isLarge ? (
                      <div className="p-4 text-center text-xs text-fg-muted font-mono bg-bg-subtle">
                        Large diff ({patch.split("\n").length} lines) —{" "}
                        <a href="#" onClick={(e) => e.preventDefault()} className="text-accent hover:underline">
                          load full
                        </a>
                      </div>
                    ) : isBinary && !isImage ? (
                      <div className="p-8 text-center text-xs text-fg-muted font-mono bg-bg-subtle">Binary file • {file.path} — cannot display diff. Use raw view to download.</div>
                    ) : isImage ? (
                      <ImageDiffView file={file} />
                    ) : !patch.trim() ? (
                      <div className="p-4 text-center text-xs text-fg-muted font-mono bg-bg-subtle">No patch • empty diff</div>
                    ) : viewMode === "unified" ? (
                      <UnifiedFileView file={file} hideWhitespace={hideWhitespace} />
                    ) : (
                      <SplitFileView file={file} />
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
