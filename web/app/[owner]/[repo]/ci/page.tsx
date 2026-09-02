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
  FileCode,
  Package,
  Shield,
  Key,
  History,
  Terminal,
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
  workflow_file?: string | null;
  duration_ms?: number | null;
  created_at: string;
  updated_at?: string;
}

interface Job {
  id: string;
  name: string;
  status: "queued" | "running" | "success" | "failed";
  logs?: string;
  runner?: string;
  exit_code?: number | null;
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
  const [workflow, setWorkflow] = useState<any>(null);
  const [artifacts, setArtifacts] = useState<any[]>([]);
  const [statusChecks, setStatusChecks] = useState<any[]>([]);
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
      const wf = await Api.getWorkflows(owner, repo);
      if (wf.ok) setWorkflow(wf.json.workflow || wf.json);
      const sc = await Api.getStatusChecks(owner, repo);
      if (sc.ok) setStatusChecks(sc.json.checks || []);
    } finally {
      setLoading(false);
    }
  }

  async function selectPipeline(p: Pipeline) {
    setSelectedPipeline(p);
    const res = await Api.getPipeline(owner, repo, p.id);
    if (res.ok) {
      if (res.json.jobs) {
        setJobs(res.json.jobs);
        if (res.json.jobs.length > 0) setSelectedJob(res.json.jobs[0]);
      }
      if (res.json.artifacts) setArtifacts(res.json.artifacts);
      else {
        const art = await Api.getArtifacts(owner, repo, p.id);
        if (art.ok) setArtifacts(art.json.artifacts || []);
      }
      // Update selected pipeline with full data
      if (res.json.pipeline) setSelectedPipeline(res.json.pipeline);
    }
  }

  useEffect(() => {
    loadPipelines();
    const interval = setInterval(() => {
      loadPipelines();
      if (selectedPipeline) {
        Api.getPipeline(owner, repo, selectedPipeline.id).then((res) => {
          if (res.ok) {
            if (res.json.jobs) setJobs(res.json.jobs);
            if (res.json.pipeline) setSelectedPipeline(res.json.pipeline);
            if (res.json.artifacts) setArtifacts(res.json.artifacts);
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
      toast("Pipeline queued (YAML workflow + Docker runner)", "success");
      loadPipelines();
      selectPipeline(res.json.pipeline);
    } else {
      toast(res.json?.error || "Failed to queue", "error");
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
          <h2 className="text-xs font-semibold text-fg flex items-center gap-1.5">
            CI / CD Pipelines <span className="rounded-xs bg-surface border border-border-subtle px-1 py-0.2 text-[10px] font-mono text-fg-muted">YAML • Docker --network none</span>
          </h2>
          <p className="text-[11px] text-fg-muted">
            Workflow: <span className="font-mono text-fg-secondary">{workflow?.file || ".itehaas/workflows/ci.yml (default)"}</span> • {workflow?.jobs?.length || 3} jobs • secrets injected • artifacts • PR gating
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

      {/* Workflow + Status Checks Bar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 rounded-sm border border-border-subtle bg-surface p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-fg">
            <FileCode className="h-3.5 w-3.5 text-fg-muted" /> Workflow
            <span className="ml-auto text-[11px] font-mono text-fg-muted">{workflow?.name || "CI"}</span>
          </div>
          {workflow?.jobs ? (
            <div className="space-y-1">
              {workflow.jobs.map((j: any) => (
                <div key={j.name} className="rounded-xs border border-border-subtle bg-bg-subtle px-2.5 py-1.5">
                  <div className="text-xs font-mono text-fg">{j.name} <span className="text-[11px] text-fg-muted">• {j.steps?.length || 0} steps {j.runsOn && `• ${j.runsOn}`}</span></div>
                  <div className="mt-1 space-y-0.5">
                    {(j.steps || []).slice(0, 4).map((s: any, idx: number) => (
                      <div key={idx} className="text-[11px] font-mono text-fg-secondary truncate">
                        <span className="text-fg-muted">- {s.name || s.uses || "run"}:</span> {s.run ? s.run.slice(0, 80) : s.uses || ""}
                      </div>
                    ))}
                    {(j.steps || []).length > 4 && <div className="text-[11px] text-fg-muted">+ {(j.steps.length - 4)} more steps</div>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-fg-muted font-mono">No workflow file — using default install → test → build</div>
          )}
          <div className="text-[11px] text-fg-muted font-mono">File: {workflow?.file || "default (no .itehaas/workflows/ci.yml)"} • triggers: {Array.isArray(workflow?.on) ? workflow.on.join(", ") : workflow?.on || "push"}</div>
        </div>

        <div className="rounded-sm border border-border-subtle bg-surface p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-fg">
            <Shield className="h-3.5 w-3.5 text-fg-muted" /> Status checks
            <span className="ml-auto text-[11px] text-fg-muted">{statusChecks.length} required</span>
          </div>
          {statusChecks.length === 0 ? (
            <div className="text-xs text-fg-muted">No required checks. Add one to gate PR merges.</div>
          ) : (
            <div className="space-y-1">
              {statusChecks.map((c: any) => (
                <div key={c.id} className="flex items-center justify-between rounded-xs border border-border-subtle bg-bg-subtle px-2 py-1">
                  <span className="text-xs font-mono text-fg">{c.name}</span>
                  <span className={`text-[10px] px-1 py-0.5 rounded-xs border ${c.required ? "bg-accent-subtle border-accent text-accent" : "bg-surface border-border-subtle text-fg-muted"}`}>{c.required ? "required" : "optional"}</span>
                </div>
              ))}
            </div>
          )}
          <div className="text-[11px] text-fg-muted">PR merges blocked until latest pipeline <span className="font-mono text-success">success</span> when checks exist.</div>
          <div className="flex items-center gap-1.5 text-[11px] text-fg-muted">
            <Key className="h-3 w-3" /> Secrets injected as env (values hidden)
          </div>
        </div>
      </div>

      {/* Pipelines Split View */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Pipeline History List */}
        <div className="border border-border-subtle rounded-sm bg-surface overflow-hidden">
          <div className="border-b border-border-subtle bg-bg-subtle px-3 py-1.5 flex items-center justify-between">
            <span className="text-xs font-medium text-fg">
              Pipelines ({pipelines.length})
            </span>
            <span className="text-[11px] font-mono text-fg-muted flex items-center gap-1"><History className="h-3 w-3" /> queue→running→success</span>
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
                      <span className={`text-[10px] font-mono px-1 py-0.5 rounded-xs border capitalize ${p.status === "success" ? "bg-success-subtle border-success text-success" : p.status === "failed" ? "bg-danger-subtle border-danger text-danger" : p.status === "running" ? "bg-accent-subtle border-accent text-accent" : "bg-surface border-border-subtle text-fg-muted"}`}>
                        {p.status}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-[11px] font-mono text-fg-subtle">
                      <span className="text-fg-secondary">{p.ref}</span>
                      <span>@</span>
                      <span>{p.commit_hash.slice(0, 7)}</span>
                    </div>
                    {p.workflow_file && <div className="text-[10px] font-mono text-fg-muted truncate">{p.workflow_file}</div>}
                    {p.duration_ms != null && <div className="text-[10px] font-mono text-fg-muted">{p.duration_ms}ms • {p.workflow_file ? "docker" : "local"}</div>}
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
                  <span className="font-medium text-fg flex items-center gap-1.5">
                    Steps {selectedPipeline.workflow_file && <span className="text-[11px] font-mono text-fg-muted">• {selectedPipeline.workflow_file}</span>}
                  </span>
                  <span className="font-mono text-[11px] text-fg-muted">
                    #{selectedPipeline.id.slice(0, 6)} {selectedPipeline.duration_ms ? `• ${selectedPipeline.duration_ms}ms` : ""}
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
                          {job.status} {job.runner && `• ${job.runner}`} {job.exit_code != null && `• exit ${job.exit_code}`}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Artifacts */}
              {artifacts.length > 0 && (
                <div className="rounded-sm border border-border-subtle bg-surface p-3 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-fg">
                    <Package className="h-3.5 w-3.5 text-fg-muted" /> Artifacts ({artifacts.length})
                  </div>
                  <div className="divide-y divide-border-subtle rounded-xs border border-border-subtle overflow-hidden">
                    {artifacts.map((a: any) => (
                      <div key={a.id} className="flex items-center justify-between px-2.5 py-1.5 bg-bg-subtle">
                        <div className="min-w-0">
                          <div className="text-xs font-mono text-fg truncate">{a.name}</div>
                          <div className="text-[11px] text-fg-muted font-mono truncate">{a.path} • {a.size_bytes} bytes • job {a.job_name || a.job_id.slice(0,6)}</div>
                        </div>
                        <span className="text-[10px] font-mono text-fg-muted">{a.size_bytes > 1024 ? `${(a.size_bytes/1024).toFixed(1)}KB` : `${a.size_bytes}B`}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Terminal Log Container */}
              <div className="border border-border-subtle rounded-sm bg-bg-subtle overflow-hidden">
                <div className="flex items-center justify-between border-b border-border-subtle bg-surface px-3 py-1.5">
                  <span className="font-mono text-[11px] text-fg-muted flex items-center gap-1.5">
                    <Terminal className="h-3 w-3" /> Logs: {selectedJob ? `${selectedJob.name} (${selectedJob.runner || "docker"})` : "runner"}
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
