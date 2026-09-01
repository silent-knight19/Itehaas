"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  RotateCw,
  GitBranch,
  Copy,
} from "lucide-react";
import { Api } from "../../../../lib/api";
import { RepoHeader } from "../../../../components/RepoHeader";
import { RepoTabs } from "../../../../components/RepoTabs";
import { useToast } from "../../../../components/Toast";

interface Pipeline {
  id: string;
  ref: string;
  commit_hash: string;
  status: "queued" | "running" | "success" | "failed";
  created_at: string;
  updated_at?: string;
}

interface Job {
  id: string;
  name: string;
  status: "queued" | "running" | "success" | "failed";
  logs?: string;
  started_at?: string;
  finished_at?: string;
}

export default function CIPage({
  params,
}: {
  params: { owner: string; repo: string };
}) {
  const { owner, repo } = params;

  const [repoInfo, setRepoInfo] = useState<any>(null);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<Pipeline | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);

  const { toast } = useToast();

  async function loadPipelines() {
    try {
      const r = await Api.getRepo(owner, repo);
      if (r.ok) setRepoInfo(r.json.repo);

      const res = await Api.listPipelines(owner, repo);
      if (res.ok && res.json.pipelines) {
        setPipelines(res.json.pipelines);
        if (!selectedPipeline && res.json.pipelines.length > 0) {
          selectPipeline(res.json.pipelines[0]);
        }
      }
    } finally {
      setLoading(false);
    }
  }

  async function selectPipeline(p: Pipeline) {
    setSelectedPipeline(p);
    const res = await Api.getPipeline(owner, repo, p.id);
    if (res.ok && res.json.jobs) {
      setJobs(res.json.jobs);
      if (res.json.jobs.length > 0) {
        setSelectedJob(res.json.jobs[0]);
      }
    }
  }

  useEffect(() => {
    loadPipelines();
    const interval = setInterval(() => {
      loadPipelines();
      if (selectedPipeline) {
        Api.getPipeline(owner, repo, selectedPipeline.id).then((res) => {
          if (res.ok && res.json.jobs) {
            setJobs(res.json.jobs);
            setSelectedPipeline(res.json.pipeline);
          }
        });
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [owner, repo, selectedPipeline?.id]);

  async function handleTriggerRun() {
    setTriggering(true);
    const res = await Api.runPipeline(owner, repo, { ref: "main" });
    setTriggering(false);
    if (res.ok && res.json.pipeline) {
      toast("Pipeline execution queued", "success");
      loadPipelines();
      selectPipeline(res.json.pipeline);
    }
  }

  function handleCopyLogs() {
    if (!selectedJob?.logs) return;
    navigator.clipboard.writeText(selectedJob.logs);
    toast("Logs copied to clipboard", "info");
  }

  return (
    <div className="space-y-4">
      {repoInfo && (
        <RepoHeader
          owner={owner}
          repo={repo}
          visibility={repoInfo.visibility}
          defaultBranch={repoInfo.default_branch || "main"}
          description={repoInfo.description}
        />
      )}

      <RepoTabs owner={owner} repo={repo} />

      {/* CI Header Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
        <div>
          <h2 className="text-xs font-semibold text-fg">
            CI / CD Pipelines
          </h2>
          <p className="text-[11px] text-fg-muted">
            Automated test and build verification.
          </p>
        </div>

        <button
          onClick={handleTriggerRun}
          disabled={triggering}
          className="flex items-center justify-center gap-1.5 rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
        >
          <Play className="h-3 w-3" />
          <span>{triggering ? "Queuing…" : "Run pipeline"}</span>
        </button>
      </div>

      {/* Pipelines Split View */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Pipeline History List */}
        <div className="border border-border-subtle rounded-sm bg-surface overflow-hidden">
          <div className="border-b border-border-subtle bg-bg-subtle px-3 py-1.5 flex items-center justify-between">
            <span className="text-xs font-medium text-fg">
              Pipelines ({pipelines.length})
            </span>
          </div>

          {loading ? (
            <div className="p-6 text-center text-xs text-fg-muted font-mono animate-pulse">
              Loading pipelines…
            </div>
          ) : pipelines.length === 0 ? (
            <div className="p-6 text-center text-xs text-fg-muted font-mono">
              No pipelines run yet.
            </div>
          ) : (
            <div className="divide-y divide-border-subtle max-h-[450px] overflow-y-auto">
              {pipelines.map((p) => {
                const isSelected = selectedPipeline?.id === p.id;
                return (
                  <div
                    key={p.id}
                    onClick={() => selectPipeline(p)}
                    className={`p-3 text-xs transition-colors cursor-pointer space-y-1 ${
                      isSelected
                        ? "bg-surface-active border-l-2 border-accent"
                        : "hover:bg-surface-hover/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-fg font-medium">
                        #{p.id.slice(0, 6)}
                      </span>
                      <span className="text-[10px] font-mono text-fg-muted capitalize">
                        {p.status}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-[11px] font-mono text-fg-subtle">
                      <span className="text-fg-secondary">{p.ref}</span>
                      <span>@</span>
                      <span>{p.commit_hash.slice(0, 7)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Selected Pipeline Steps + Log Stream */}
        <div className="lg:col-span-2 space-y-3">
          {selectedPipeline ? (
            <>
              {/* Step Progression Nodes */}
              <div className="border border-border-subtle rounded-sm bg-surface p-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-fg">
                    Steps
                  </span>
                  <span className="font-mono text-[11px] text-fg-muted">
                    #{selectedPipeline.id.slice(0, 6)}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {jobs.map((job) => {
                    const isJobActive = selectedJob?.id === job.id;
                    return (
                      <div
                        key={job.id}
                        onClick={() => setSelectedJob(job)}
                        className={`rounded-xs border p-2 cursor-pointer transition-colors ${
                          isJobActive
                            ? "border-accent bg-accent-subtle text-fg"
                            : "border-border-subtle bg-bg-subtle text-fg-secondary hover:border-border-emphasis"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="font-mono text-[11px] capitalize truncate">
                            {job.name}
                          </span>
                          {job.status === "success" ? (
                            <CheckCircle2 className="h-3 w-3 text-success" />
                          ) : job.status === "failed" ? (
                            <XCircle className="h-3 w-3 text-danger" />
                          ) : job.status === "running" ? (
                            <RotateCw className="h-3 w-3 text-accent animate-spin" />
                          ) : (
                            <Clock className="h-3 w-3 text-warning" />
                          )}
                        </div>
                        <div className="text-[9px] font-mono capitalize text-fg-muted">
                          {job.status}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Terminal Log Container */}
              <div className="border border-border-subtle rounded-sm bg-bg-subtle overflow-hidden">
                <div className="flex items-center justify-between border-b border-border-subtle bg-surface px-3 py-1.5">
                  <span className="font-mono text-[11px] text-fg-muted">
                    Logs: {selectedJob ? selectedJob.name : "runner"}
                  </span>

                  <button
                    onClick={handleCopyLogs}
                    className="flex items-center gap-1 rounded-xs border border-border-default bg-surface px-1.5 py-0.5 text-[10px] font-mono text-fg-muted hover:text-fg hover:border-border-emphasis"
                  >
                    <Copy className="h-3 w-3" />
                    <span>Copy</span>
                  </button>
                </div>

                <div className="p-3 font-mono text-xs leading-relaxed text-fg max-h-[350px] overflow-y-auto whitespace-pre-wrap select-text">
                  {selectedJob?.logs ? (
                    selectedJob.logs
                  ) : (
                    <span className="text-fg-subtle italic">No log output recorded.</span>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="border border-border-subtle rounded-sm bg-surface p-12 text-center text-xs text-fg-muted font-mono">
              Select a pipeline from history to view step progression and logs.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
