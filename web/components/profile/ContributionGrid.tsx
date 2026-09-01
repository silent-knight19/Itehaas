"use client";
import React from "react";

interface Contribution {
  date: string;
  count: number;
  level: number;
}

interface ContributionGridProps {
  contributions: Contribution[];
  total?: number;
}

function levelClass(level: number): string {
  switch (level) {
    case 0:
      return "bg-surface border border-border-subtle";
    case 1:
      return "bg-[rgba(59,130,246,0.25)] border border-[rgba(59,130,246,0.18)]";
    case 2:
      return "bg-[rgba(59,130,246,0.50)] border border-[rgba(59,130,246,0.35)]";
    case 3:
      return "bg-[rgba(59,130,246,0.85)] border border-[rgba(59,130,246,0.6)]";
    case 4:
      return "bg-accent border border-[rgba(59,130,246,1)]";
    default:
      return "bg-surface";
  }
}

export function ContributionGrid({ contributions, total }: ContributionGridProps) {
  if (!contributions || contributions.length === 0) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-fg tracking-tight">Contribution activity</h3>
          <span className="text-[11px] text-fg-muted font-mono">{total ?? 0} in last year</span>
        </div>
        <div className="rounded-sm border border-border-subtle bg-surface p-6 text-center">
          <p className="text-xs text-fg-muted">No contributions in this period.</p>
          <p className="text-[11px] text-fg-subtle mt-1">Commits, PRs and issues will appear here.</p>
        </div>
      </div>
    );
  }

  // contributions is 365 days ordered ascending; group into weeks (7 rows)
  // For display, we render 52 weeks columns with 7 rows, using flex cols
  const weeks: Contribution[][] = [];
  for (let i = 0; i < contributions.length; i += 7) {
    weeks.push(contributions.slice(i, i + 7));
  }

  // Month labels: map week index to month name if first day of week is 1st
  const monthLabels: { label: string; col: number }[] = [];
  let lastMonth = "";
  weeks.forEach((week, col) => {
    if (!week[0]) return;
    const d = new Date(week[0].date + "T00:00:00Z");
    const m = d.toLocaleString("en-US", { month: "short" });
    if (m !== lastMonth && col > 0) {
      monthLabels.push({ label: m, col });
      lastMonth = m;
    } else if (col === 0) {
      monthLabels.push({ label: m, col: 0 });
      lastMonth = m;
    }
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-fg tracking-tight">Contribution activity</h3>
        <span className="text-[11px] text-fg-muted font-mono">{total ?? contributions.reduce((a, b) => a + b.count, 0)} contributions</span>
      </div>

      {/* Month header */}
      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          <div className="flex text-[10px] font-mono text-fg-subtle ml-6 mb-1">
            {weeks.map((_, col) => {
              const lbl = monthLabels.find((m) => m.col === col);
              return (
                <div key={col} className="w-[13px] shrink-0">
                  {lbl ? <span className="-ml-1">{lbl.label}</span> : null}
                </div>
              );
            })}
          </div>

          <div className="flex gap-[3px]">
            {/* Day labels */}
            <div className="flex flex-col gap-[3px] text-[10px] font-mono text-fg-subtle pr-1">
              <span className="h-[10px] leading-none">Mon</span>
              <span className="h-[10px] leading-none">&nbsp;</span>
              <span className="h-[10px] leading-none">Wed</span>
              <span className="h-[10px] leading-none">&nbsp;</span>
              <span className="h-[10px] leading-none">Fri</span>
              <span className="h-[10px] leading-none">&nbsp;</span>
              <span className="h-[10px] leading-none">&nbsp;</span>
            </div>

            {/* Grid */}
            <div className="flex gap-[3px]">
              {weeks.map((week, wi) => (
                <div key={wi} className="flex flex-col gap-[3px]">
                  {Array.from({ length: 7 }).map((_, ri) => {
                    const item = week[ri];
                    if (!item) return <div key={ri} className="h-[10px] w-[10px]" />;
                    return (
                      <div
                        key={ri}
                        title={`${item.date}: ${item.count} contribution${item.count === 1 ? "" : "s"}`}
                        className={`h-[10px] w-[10px] rounded-xs ${levelClass(item.level)} transition-colors`}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Legend */}
          <div className="flex items-center justify-between mt-3 text-[11px] text-fg-muted">
            <span className="font-mono">Less</span>
            <div className="flex items-center gap-[3px]">
              {[0, 1, 2, 3, 4].map((l) => (
                <div key={l} className={`h-[10px] w-[10px] rounded-xs ${levelClass(l)}`} />
              ))}
            </div>
            <span className="font-mono">More</span>
          </div>
        </div>
      </div>
    </div>
  );
}
