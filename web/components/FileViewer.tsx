"use client";
import React from "react";
import { Copy, X, FileCode } from "lucide-react";
import { useToast } from "./Toast";

interface FileViewerProps {
  fileName: string;
  content: string;
  onClose?: () => void;
  filePath?: string;
  owner?: string;
  repo?: string;
  branch?: string;
}

export function FileViewer({ fileName, content, onClose, filePath, owner, repo, branch }: FileViewerProps) {
  const lines = content.split("\n");
  const sizeBytes = new Blob([content]).size;
  const { toast } = useToast();

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
        <div className="flex items-center gap-2">
          <FileCode className="h-3.5 w-3.5 text-fg-muted" />
          <span className="font-mono text-xs font-medium text-fg">
            {fileName}
          </span>
          <span className="text-fg-subtle">•</span>
          <span className="text-[11px] text-fg-muted font-mono">
            {lines.length} {lines.length === 1 ? "line" : "lines"}
          </span>
          <span className="text-fg-subtle">•</span>
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

      {/* Code Display Table */}
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
    </div>
  );
}
