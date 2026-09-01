"use client";
import React from "react";
import { GitCompare, Plus, Minus } from "lucide-react";

interface DiffViewerProps {
  diffText: string;
}

export function DiffViewer({ diffText }: DiffViewerProps) {
  if (!diffText || !diffText.trim()) {
    return (
      <div className="py-8 text-center text-xs text-fg-muted font-mono border border-border-subtle rounded-sm">
        No differences between branches.
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
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-subtle bg-surface px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <GitCompare className="h-3.5 w-3.5 text-fg-muted" />
          <span className="text-xs font-medium text-fg">
            Unified Diff
          </span>
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

      {/* Diff Table */}
      <div className="overflow-x-auto p-2 text-xs font-mono leading-relaxed select-text max-h-[500px] overflow-y-auto">
        <table className="w-full border-collapse">
          <tbody>
            {lines.map((line, idx) => {
              let rowStyle = "hover:bg-surface-hover/30 text-fg-secondary";

              if (line.startsWith("+++") || line.startsWith("---")) {
                rowStyle = "bg-surface text-fg-muted font-medium";
              } else if (line.startsWith("@@")) {
                rowStyle = "bg-accent-subtle text-accent";
              } else if (line.startsWith("+")) {
                rowStyle = "bg-success-subtle text-success";
              } else if (line.startsWith("-")) {
                rowStyle = "bg-danger-subtle text-danger";
              }

              return (
                <tr key={idx} className={`${rowStyle} transition-colors`}>
                  <td className="w-8 select-none pr-2 text-right text-fg-subtle font-mono text-[10px] tabular-nums">
                    {idx + 1}
                  </td>
                  <td className="whitespace-pre px-2 font-mono text-xs">
                    {line || " "}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
