"use client";
import { useEffect, useState } from "react";

export default function Pulls({ params }: { params: { owner: string; repo: string } }) {
  const { owner, repo } = params;
  const [pulls, setPulls] = useState<any[]>([]);
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("main");
  const [branches, setBranches] = useState<string[]>([]);

  async function load() {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/repos/${owner}/${repo}/pulls`, { credentials: 'include' });
    if (res.ok) { const j = await res.json(); setPulls(j.pulls); }
    const b = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/repos/${owner}/${repo}/branches`, { credentials: 'include' });
    if (b.ok) { const j = await b.json(); setBranches(j.branches); }
  }

  useEffect(()=>{ load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/repos/${owner}/${repo}/pulls`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, source_branch: source, target_branch: target })
    });
    if (res.ok) { setTitle(""); setSource(""); load(); } else alert(await res.text());
  }

  async function merge(id: string) {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/repos/${owner}/${repo}/pulls/${id}/merge`, { method: 'POST', credentials: 'include' });
    if (res.ok) { alert("Merged"); load(); } else alert("Merge failed: " + await res.text());
  }

  async function diff(id: string) {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/repos/${owner}/${repo}/pulls/${id}/diff`, { credentials: 'include' });
    const j = await res.json();
    alert(j.diff?.slice(0,2000) || "no diff");
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{owner}/{repo} — Pull Requests</h1>
      <form onSubmit={create} className="border rounded p-3 bg-gray-50 space-y-2">
        <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="PR Title" className="w-full border rounded px-2 py-1 text-sm" required />
        <div className="flex gap-2">
          <select value={source} onChange={e=>setSource(e.target.value)} className="flex-1 border rounded px-2 py-1 text-sm" required>
            <option value="">source branch</option>
            {branches.map(b=><option key={b} value={b}>{b}</option>)}
          </select>
          <span className="py-1 text-sm">→</span>
          <select value={target} onChange={e=>setTarget(e.target.value)} className="flex-1 border rounded px-2 py-1 text-sm">
            {branches.map(b=><option key={b} value={b}>{b}</option>)}
            {!branches.includes("main") && <option value="main">main</option>}
          </select>
        </div>
        <button className="bg-brand-600 text-white px-3 py-1 rounded text-sm">Create PR</button>
      </form>
      <ul className="space-y-2">
        {pulls.map((pr:any)=>(
          <li key={pr.id} className="border rounded p-3 bg-white">
            <div className="flex justify-between">
              <span className="font-medium">{pr.title} <span className="text-xs font-mono text-gray-500">{pr.source_branch} → {pr.target_branch}</span></span>
              <span className={`text-xs px-2 py-0.5 rounded ${pr.status==='open'?'bg-green-100 text-green-700': pr.status==='merged'?'bg-purple-100 text-purple-700':'bg-gray-200'}`}>{pr.status}</span>
            </div>
            <p className="text-xs text-gray-500">by {pr.author} • {new Date(pr.created_at).toLocaleString()}</p>
            <div className="flex gap-2 mt-2">
              <button onClick={()=>diff(pr.id)} className="text-xs border px-2 py-1 rounded">Diff</button>
              {pr.status==='open' && <button onClick={()=>merge(pr.id)} className="text-xs bg-brand-600 text-white px-2 py-1 rounded">Merge</button>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
