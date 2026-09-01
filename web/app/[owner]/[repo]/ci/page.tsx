"use client";
import { useEffect, useState } from "react";

export default function Ci({ params }: { params: { owner: string; repo: string } }) {
  const { owner, repo } = params;
  const [pipelines, setPipelines] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [jobs, setJobs] = useState<any[]>([]);

  async function load() {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/repos/${owner}/${repo}/ci/pipelines`, { credentials: 'include' });
    if (res.ok) { const j = await res.json(); setPipelines(j.pipelines); }
  }

  useEffect(()=>{ load(); const i=setInterval(load, 5000); return ()=>clearInterval(i); }, []);

  async function trigger() {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/repos/${owner}/${repo}/ci/run`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: 'main' }) });
    if (res.ok) { alert("Pipeline queued"); load(); } else alert(await res.text());
  }

  async function view(id: string) {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/repos/${owner}/${repo}/ci/pipelines/${id}`, { credentials: 'include' });
    if (res.ok) { const j = await res.json(); setSelected(j.pipeline); setJobs(j.jobs); }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-xl font-semibold">{owner}/{repo} — CI</h1>
        <button onClick={trigger} className="bg-brand-600 text-white px-3 py-1 rounded text-sm">Run Pipeline</button>
      </div>
      <p className="text-xs text-gray-500">Phase 9: push → job queued → container runner (simulated via <code>execItehaas log</code>) → logs → status. Isolated runner would be <code>docker run --network none --memory 512m</code> (deferred).</p>
      <ul className="divide-y border rounded bg-white">
        {pipelines.map((p:any)=>(
          <li key={p.id} className="p-3 flex justify-between items-center hover:bg-gray-50 cursor-pointer" onClick={()=>view(p.id)}>
            <div>
              <span className="font-mono text-sm">{p.id.slice(0,8)}</span>
              <span className="ml-2 text-sm">{p.ref} @ {p.commit_hash.slice(0,7)}</span>
            </div>
            <span className={`text-xs px-2 py-1 rounded ${p.status==='success'?'bg-green-100 text-green-700': p.status==='failed'?'bg-red-100 text-red-700': p.status==='running'?'bg-blue-100 text-blue-700':'bg-gray-100'}`}>{p.status}</span>
          </li>
        ))}
        {pipelines.length===0 && <li className="p-3 text-sm text-gray-500">No pipelines. Trigger one.</li>}
      </ul>
      {selected && (
        <div className="border rounded p-4 bg-white">
          <h2 className="font-medium">Pipeline {selected.id.slice(0,8)} — {selected.status}</h2>
          <ul className="mt-2 space-y-2">
            {jobs.map((j:any)=>(
              <li key={j.id} className="border rounded p-2">
                <div className="flex justify-between">
                  <span className="font-medium text-sm">{j.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${j.status==='success'?'bg-green-100': j.status==='failed'?'bg-red-100':'bg-gray-100'}`}>{j.status}</span>
                </div>
                {j.logs && <pre className="mt-2 bg-gray-900 text-green-400 p-2 rounded text-xs overflow-auto max-h-40">{j.logs.slice(0,4000)}</pre>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
