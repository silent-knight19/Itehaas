"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Api } from "../lib/api";

type Repo = { id: string; name: string; description: string; visibility: string; owner: string; updated_at?: string };

export default function Dashboard() {
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newVis, setNewVis] = useState<"private" | "public">("private");
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    const me = await Api.me();
    if (me.ok) setUser(me.json.user);
    else setUser(null);
    const res = await Api.listRepos();
    if (res.ok) setRepos(res.json.repos);
    else setError(res.json?.error || "failed to list");
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function createRepo(e: React.FormEvent) {
    e.preventDefault();
    if (!newName) return;
    setCreating(true);
    const res = await Api.createRepo({ name: newName, description: newDesc, visibility: newVis });
    setCreating(false);
    if (res.ok) {
      setNewName(""); setNewDesc("");
      load();
    } else {
      alert(res.json?.error || "create failed");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <div className="text-sm text-gray-500">
          {user ? <>Signed in as <span className="font-medium text-gray-900">{user.username}</span></> : <>Not signed in — <Link href="/login" className="text-brand-600">login</Link></>}
        </div>
      </div>

      {user && (
        <form onSubmit={createRepo} className="border rounded-lg p-4 bg-gray-50 space-y-3">
          <h2 className="font-medium">Create repository</h2>
          <div className="flex gap-2">
            <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="repo name (a-z, 0-9, ._-)" className="flex-1 border rounded px-3 py-2 text-sm" required pattern="^[a-zA-Z0-9._-]+$" />
            <select value={newVis} onChange={e=>setNewVis(e.target.value as any)} className="border rounded px-2 py-2 text-sm">
              <option value="private">private</option><option value="public">public</option>
            </select>
            <button disabled={creating} className="bg-brand-600 text-white px-4 py-2 rounded text-sm hover:bg-brand-700 disabled:opacity-50">{creating?"Creating…":"Create"}</button>
          </div>
          <input value={newDesc} onChange={e=>setNewDesc(e.target.value)} placeholder="description (optional)" className="w-full border rounded px-3 py-2 text-sm" maxLength={500} />
          <p className="text-xs text-gray-500">Creates <code>data/repos/&lt;owner&gt;/&lt;name&gt;/.itehaas</code> via <code>POST /api/repos</code> → <code>execItehaas init</code>.</p>
        </form>
      )}

      <section>
        <h2 className="font-medium mb-2">Repositories</h2>
        {loading ? <p className="text-sm text-gray-500">Loading…</p> : error ? <p className="text-sm text-red-600">{error}</p> : repos?.length===0 ? <p className="text-sm text-gray-500">No repositories. {user ? "Create one above." : <Link href="/register" className="text-brand-600">Register</Link>}</p> : (
          <ul className="divide-y border rounded-lg bg-white">
            {repos!.map(r=>(
              <li key={r.id} className="p-4 flex justify-between items-center hover:bg-gray-50">
                <div>
                  <Link href={`/${r.owner}/${r.name}`} className="font-mono text-brand-600 hover:underline">{r.owner}/{r.name}</Link>
                  <span className={`ml-2 text-xs px-2 py-0.5 rounded ${r.visibility==='public'?'bg-green-100 text-green-700':'bg-gray-200 text-gray-600'}`}>{r.visibility}</span>
                  {r.description && <p className="text-sm text-gray-600">{r.description}</p>}
                </div>
                <Link href={`/${r.owner}/${r.name}`} className="text-sm border px-3 py-1.5 rounded hover:bg-white">Browse</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="prose prose-sm max-w-none border rounded-lg p-4 bg-white">
        <h3>How it works</h3>
        <p>Web reads <strong>VCS objects</strong> via <code>server/src/lib/vcs.ts</code> spawn, not upload dir. <code>GET /api/repos/:owner/:repo/branches</code> → <code>itehaas branch</code>, <code>/log</code> → <code>itehaas log --oneline</code>, <code>/tree/:hash</code> → <code>cat-file -p</code>. See <code>docs/api.md</code>.</p>
      </section>
    </div>
  );
}
