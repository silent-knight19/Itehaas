"use client";
import React, { useState, useEffect } from "react";
import { Copy, X, FileCode, Clock, User, History } from "lucide-react";
import { useToast } from "./Toast";
import { Api } from "../lib/api";

interface FileViewerProps {
  fileName: string;
  content: string;
  onClose?: () => void;
  filePath?: string;
  owner?: string;
  repo?: string;
  branch?: string;
}

type Tab = "code" | "history" | "blame" | "raw";

export function FileViewer({ fileName, content, onClose, filePath, owner, repo, branch }: FileViewerProps) {
  const [activeTab, setActiveTab] = useState<Tab>("code");
  const [history, setHistory] = useState<any[] | null>(null);
  const [blame, setBlame] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const lines = content.split("\n");
  const sizeBytes = new Blob([content]).size;
  const { toast } = useToast();

  const canFetchExtras = !!(filePath && owner && repo);

  useEffect(() => {
    setActiveTab("code");
    setHistory(null);
    setBlame(null);
  }, [filePath, content]);

  async function fetchHistory() {
    if (!canFetchExtras || history) return;
    setLoading(true);
    try {
      const res = await Api.getFileHistory(owner!, repo!, filePath!, branch);
      if (res.ok) setHistory(res.json.commits || res.json.history || []);
      else setHistory([]);
    } catch { setHistory([]); }
    finally { setLoading(false); }
  }

  async function fetchBlame() {
    if (!canFetchExtras || blame) return;
    setLoading(true);
    try {
      const res = await Api.getBlame(owner!, repo!, filePath!, branch);
      if (res.ok) {
        // server returns { lines: [{hash, author, line, content}] } or { blame: [...] }
        const data = res.json.lines || res.json.blame || res.json;
        if (Array.isArray(data)) setBlame(data);
        else if (Array.isArray(data.lines)) setBlame(data.lines);
        else setBlame([]);
      } else setBlame([]);
    } catch { setBlame([]); }
    finally { setLoading(false); }
  }

  function handleTab(tab: Tab) {
    setActiveTab(tab);
    if (tab === "history") fetchHistory();
    if (tab === "blame") fetchBlame();
  }

  function copyCode() {
    navigator.clipboard.writeText(content);
    toast("File contents copied", "info");
  }

  function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return (
    <div className="rounded-sm border border-border-subtle bg-bg-subtle overflow-hidden">
      {/* File Header */}
      <div className="flex items-center justify-between border-b border-border-subtle bg-surface px-3 py-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <FileCode className="h-3.5 w-3.5 text-fg-muted" />
          <span className="font-mono text-xs font-medium text-fg truncate">
            {fileName}
          </span>
          {filePath && <span className="hidden sm:inline text-[11px] text-fg-muted font-mono truncate">{filePath}</span>}
          <span className="text-fg-subtle hidden sm:inline">•</span>
          <span className="text-[11px] text-fg-muted font-mono">
            {lines.length} {lines.length === 1 ? "line" : "lines"}
          </span>
          <span className="text-fg-subtle hidden sm:inline">•</span>
          <span className="text-[11px] text-fg-muted font-mono">
            {formatBytes(sizeBytes)}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={copyCode}
            className="flex items-center gap-1 rounded-xs border border-border-default bg-surface px-2 py-0.5 text-xs text-fg-secondary hover:border-border-emphasis hover:text-fg transition-colors"
            title="Copy file contents"
          >
            <Copy className="h-3 w-3" />
            <span>Copy</span>
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="rounded-xs p-0.5 text-fg-muted hover:bg-surface-hover hover:text-fg transition-colors"
              title="Close viewer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      {canFetchExtras && (
        <div className="flex items-center gap-1 border-b border-border-subtle bg-surface-hover/30 px-2 py-1">
          {(["code", "history", "blame", "raw"] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => handleTab(tab)}
              className={`rounded-xs px-2.5 py-1 text-[11px] font-mono capitalize transition-colors ${
                activeTab === tab
                  ? "bg-surface text-fg border border-border-default"
                  : "text-fg-muted hover:text-fg hover:bg-surface"
              }`}
            >
              {tab === "history" && <History className="inline h-3 w-3 mr-1" />}
              {tab}
            </button>
          ))}
          <span className="ml-auto text-[10px] text-fg-subtle font-mono hidden sm:inline">
            {branch && `ref: ${branch}`}
          </span>
        </div>
      )}

      {/* Content */}
      {activeTab === "code" && (
        <div className="overflow-x-auto p-3 text-xs font-mono leading-relaxed select-text max-h-[550px] overflow-y-auto">
          <table className="w-full border-collapse">
            <tbody>
              {lines.map((line, idx) => (
                <tr key={idx} className="hover:bg-surface-hover/40">
                  <td className="w-10 select-none pr-3 text-right text-fg-subtle font-mono text-[11px] tabular-nums">
                    {idx + 1}
                  </td>
                  <td className="whitespace-pre text-fg font-mono text-xs">
                    {line || " "}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "raw" && (
        <div className="p-3 bg-surface">
          <pre className="text-xs font-mono whitespace-pre-wrap break-all text-fg max-h-[550px] overflow-y-auto">{content}</pre>
        </div>
      )}

      {activeTab === "history" && (
        <div className="p-3 max-h-[550px] overflow-y-auto">
          {loading && <div className="text-xs text-fg-muted font-mono animate-pulse">Loading history…</div>}
          {!loading && history && history.length === 0 && <div className="text-xs text-fg-muted">No history found for this file.</div>}
          {!loading && history && history.length > 0 && (
            <div className="space-y-1.5">
              {history.map((c: any, i: number) => (
                <div key={c.hash || i} className="flex items-center justify-between rounded-xs border border-border-subtle bg-surface px-2.5 py-1.5">
                  <div className="min-w-0">
                    <div className="text-xs font-mono text-fg truncate">{c.message || c.hash?.slice(0,7)}</div>
                    <div className="text-[11px] text-fg-muted font-mono">{c.hash?.slice(0,7)} {c.author && `• ${c.author}`}</div>
                  </div>
                  <Clock className="h-3 w-3 text-fg-subtle shrink-0" />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "blame" && (
        <div className="overflow-x-auto p-3 text-xs font-mono leading-relaxed max-h-[550px] overflow-y-auto">
          {loading && <div className="text-xs text-fg-muted font-mono animate-pulse">Loading blame…</div>}
          {!loading && blame && blame.length === 0 && <div className="text-xs text-fg-muted">No blame data. Ensure file exists in repo.</div>}
          {!loading && blame && blame.length > 0 && (
            <table className="w-full border-collapse">
              <tbody>
                {blame.map((b: any, idx: number) => (
                  <tr key={idx} className="hover:bg-surface-hover/30">
                    <td className="pr-2 text-[11px] text-fg-muted font-mono whitespace-nowrap select-none">
                      <span className="rounded-xs bg-surface-hover px-1">{b.hash?.slice(0,7) || b.commit?.slice(0,7) || "?"}</span>
                    </td>
                    <td className="pr-2 text-[11px] text-fg-secondary whitespace-nowrap max-w-[120px] truncate">
                      <span className="inline-flex items-center gap-1"><User className="h-3 w-3" />{b.author || "unknown"}</span>
                    </td>
                    <td className="w-8 text-right pr-3 text-[11px] text-fg-subtle tabular-nums select-none">{b.line || idx+1}</td>
                    <td className="whitespace-pre text-fg text-xs">{b.content || b.lineContent || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!loading && blame && lines.length !== blame.length && blame.length > 0 && (
            <div className="mt-2 text-[11px] text-fg-muted">Showing blame for {blame.length} lines (file has {lines.length}).</div>
          )}
        </div>
      )}
    </div>
  );
}
