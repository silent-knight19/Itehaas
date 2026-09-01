"use client";
import React, { useState } from "react";
import {
  Cpu,
  Database,
  Search,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Terminal,
} from "lucide-react";
import { Api } from "../lib/api";

interface VCSInspectorProps {
  owner: string;
  repo: string;
}

export function VCSInspector({ owner, repo }: VCSInspectorProps) {
  const [objectHash, setObjectHash] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function inspectObject(e: React.FormEvent) {
    e.preventDefault();
    if (!objectHash.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);

    const hash = objectHash.trim();
    if (!/^[0-9a-f]{64}$/.test(hash)) {
      setError("Please provide a valid 64-character SHA-256 object hash.");
      setLoading(false);
      return;
    }

    const res = await Api.tree(owner, repo, hash);
    setLoading(false);
    if (res.ok) {
      setResult(res.json.content);
    } else {
      setError(res.json?.error || "Object not found in repository storage.");
    }
  }

  function handleCopy() {
    if (!result) return;
    navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-6">
      {/* Architecture Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-white/[0.08] bg-[#11131c] p-4 shadow-lg">
          <div className="flex items-center gap-2 text-indigo-400 text-xs font-semibold mb-2">
            <Cpu className="h-4 w-4" />
            <span>Object Model Invariant</span>
          </div>
          <p className="text-xs text-zinc-400 font-mono bg-zinc-950/60 p-2.5 rounded-lg border border-white/[0.04] leading-relaxed">
            H(header || 0x00 || body) → SHA-256 uncompressed bytes
          </p>
        </div>

        <div className="rounded-xl border border-white/[0.08] bg-[#11131c] p-4 shadow-lg">
          <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold mb-2">
            <Database className="h-4 w-4" />
            <span>Fanout Storage</span>
          </div>
          <p className="text-xs text-zinc-400 font-mono bg-zinc-950/60 p-2.5 rounded-lg border border-white/[0.04] leading-relaxed">
            .itehaas/objects/ab/cdef... (2/62 fanout, zlib stored)
          </p>
        </div>

        <div className="rounded-xl border border-white/[0.08] bg-[#11131c] p-4 shadow-lg">
          <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold mb-2">
            <Terminal className="h-4 w-4" />
            <span>Integrity Guard</span>
          </div>
          <p className="text-xs text-zinc-400 font-mono bg-zinc-950/60 p-2.5 rounded-lg border border-white/[0.04] leading-relaxed">
            itehaas fsck (DAG traversal & hash validation)
          </p>
        </div>
      </div>

      {/* CAS Object Inspector */}
      <div className="rounded-xl border border-white/[0.08] bg-[#11131c] p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
          <div>
            <h3 className="text-sm font-semibold text-white">
              Direct CAS Object Lookup (cat-file)
            </h3>
            <p className="text-xs text-zinc-400">
              Query raw uncompressed bytes for any commit, tree, blob, or tag by SHA-256 hash.
            </p>
          </div>
        </div>

        <form onSubmit={inspectObject} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
            <input
              value={objectHash}
              onChange={(e) => setObjectHash(e.target.value)}
              placeholder="e.g. 0a3fdc0aa008c03a57a34f68ed7afcda7a50a34af12c8097a58bff6ecac4b742"
              className="w-full rounded-lg border border-zinc-700/60 bg-zinc-950/80 py-2 pl-9 pr-3 font-mono text-xs text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white shadow-md shadow-indigo-600/20 hover:bg-indigo-500 disabled:opacity-50"
          >
            {loading ? "Reading…" : "Inspect"}
          </button>
        </form>

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {result && (
          <div className="rounded-xl border border-white/[0.08] bg-zinc-950 overflow-hidden shadow-inner">
            <div className="flex items-center justify-between border-b border-white/[0.08] bg-zinc-900/60 px-4 py-2 text-xs">
              <span className="font-mono text-zinc-400">Object Output</span>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 text-zinc-400 hover:text-white"
              >
                {copied ? (
                  <Check className="h-3 w-3 text-emerald-400" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                <span>{copied ? "Copied" : "Copy"}</span>
              </button>
            </div>
            <pre className="p-4 font-mono text-xs text-zinc-200 overflow-auto max-h-72">
              {result}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
