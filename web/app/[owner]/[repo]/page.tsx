"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Api } from "../../../lib/api";

type Params = { params: { owner: string; repo: string } };

function parseTreeHash(commitContent: string): string | null {
  const m = commitContent.match(/^tree ([0-9a-f]{64})$/m);
  return m ? m[1] : null;
}

export default function RepoPage({ params }: Params) {
  const { owner, repo } = params;
  const [repoInfo, setRepoInfo] = useState<any>(null);
  const [branches, setBranches] = useState<string[] | null>(null);
  const [commits, setCommits] = useState<any[] | null>(null);
  const [tree, setTree] = useState<{ mode: string; hash: string; name: string }[] | null>(null);
  const [treeHash, setTreeHash] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<Record<string,string>>({});
  const [readme, setReadme] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingsVis, setSettingsVis] = useState<string | null>(null);
  const [stars, setStars] = useState<{ count: number; starred: boolean } | null>(null);

  useEffect(() => {
    (async () => {
      const r = await Api.getRepo(owner, repo);
      if (!r.ok) { setError(r.json?.error || "not found"); return; }
      setRepoInfo(r.json.repo);
      setSettingsVis(r.json.repo.visibility);
      const b = await Api.listBranches(owner, repo);
      if (b.ok) setBranches(b.json.branches);
      const l = await Api.log(owner, repo);
      if (l.ok) setCommits(l.json.commits);
      // stars
      try {
        const s = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/repos/${owner}/${repo}/stars`, { credentials: 'include' });
        if (s.ok) setStars(await s.json());
      } catch {}
    })();
  }, [owner, repo]);

  // Attempt to load tree if we have a full 64 hash (maybe log returns short, so not). For demo, try to load tree for commits[0] if it's 64.
  useEffect(() => {
    (async () => {
      if (!commits || commits.length === 0) return;
      const h = commits[0].hash;
      if (!/^[0-9a-f]{64}$/.test(h)) {
        // short hash, cannot fetch; try to fetch branches and then use branch hash via new API? For now skip.
        return;
      }
      const c = await Api.tree(owner, repo, h);
      if (c.ok) {
        const th = parseTreeHash(c.json.content);
        if (th) {
          setTreeHash(th);
          const t = await Api.tree(owner, repo, th);
          if (t.ok) {
            // t.json.content is raw tree pretty: "100644 <hash> <name>" lines
            const entries: { mode: string; hash: string; name: string }[] = [];
            for (const line of t.json.content.trim().split("\n")) {
              const m = line.trim().match(/^(\d{5,6})\s+([0-9a-f]{64})\s+(.+)$/);
              if (m) entries.push({ mode: m[1], hash: m[2], name: m[3] });
            }
            setTree(entries);
            // Find README
            const readmeEntry = entries.find(e => /^readme\.md$/i.test(e.name));
            if (readmeEntry) {
              const rc = await Api.tree(owner, repo, readmeEntry.hash);
              if (rc.ok) setReadme(rc.json.content);
            }
          }
        }
      }
    })();
  }, [commits, owner, repo]);

  async function loadFile(hash: string, name: string) {
    if (fileContent[name]) return;
    const r = await Api.tree(owner, repo, hash);
    if (r.ok) setFileContent(prev => ({ ...prev, [name]: r.json.content }));
  }

  async function updateVisibility() {
    if (!settingsVis) return;
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/repos/${owner}/${repo}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visibility: settingsVis }),
    });
    if (res.ok) alert("Updated");
    else alert("Failed: " + (await res.text()));
  }

  async function toggleStar() {
    if (!stars) return;
    const method = stars.starred ? 'DELETE' : 'POST';
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/repos/${owner}/${repo}/star`, { method, credentials: 'include' });
    if (res.ok) {
      const j = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/repos/${owner}/${repo}/stars`, { credentials: 'include' }).then(r=>r.json());
      setStars(j);
    }
  }

  if (error) return <div className="text-red-600">Error: {error} — <Link href="/" className="text-brand-600">back</Link></div>;
  if (!repoInfo) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-mono"><Link href="/" className="text-gray-500">repos</Link> / <span className="font-semibold">{owner}/{repo}</span> <span className={`ml-2 text-xs px-2 py-1 rounded ${repoInfo.visibility==='public'?'bg-green-100 text-green-700':'bg-gray-200'}`}>{repoInfo.visibility}</span></h1>
        <div className="flex gap-2 items-center">
          <span className="text-xs text-gray-500">default: {repoInfo.default_branch}</span>
          {stars && <button onClick={toggleStar} className={`text-sm border px-3 py-1 rounded ${stars.starred ? 'bg-yellow-100 border-yellow-300' : 'bg-white'}`}>{stars.starred ? '★' : '☆'} {stars.count}</button>}
        </div>
      </div>
      <div className="flex gap-2 text-sm border-b pb-2">
        <Link href={`/${owner}/${repo}`} className="px-3 py-1 bg-gray-900 text-white rounded">Code</Link>
        <Link href={`/${owner}/${repo}/issues`} className="px-3 py-1 border rounded hover:bg-gray-50">Issues</Link>
        <Link href={`/${owner}/${repo}/pulls`} className="px-3 py-1 border rounded hover:bg-gray-50">Pulls</Link>
      </div>

      <div className="border rounded-lg bg-white p-4">
        <h2 className="font-medium mb-2">Branches</h2>
        {branches===null ? <p className="text-sm text-gray-500">Loading…</p> : branches.length===0 ? <p className="text-sm text-gray-500">No branches (empty repo)</p> : (
          <ul className="flex flex-wrap gap-2">
            {branches.map(b=><span key={b} className="px-2 py-1 bg-gray-100 rounded text-sm font-mono">{b}</span>)}
          </ul>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="border rounded-lg bg-white p-4">
          <h2 className="font-medium mb-2">Commits</h2>
          {commits===null ? <p className="text-sm text-gray-500">Loading…</p> : commits.length===0 ? <p className="text-sm text-gray-500">No commits yet. Clone and push:</p> : (
            <ul className="space-y-2 max-h-96 overflow-auto">
              {commits.map(c=>(
                <li key={c.hash} className="flex gap-2 text-sm">
                  <span className="font-mono text-gray-500">{c.hash.slice(0,7)}</span>
                  <span className="flex-1 truncate">{c.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border rounded-lg bg-white p-4">
          <h2 className="font-medium mb-2">Files {treeHash && <span className="text-xs font-mono text-gray-400">{treeHash.slice(0,7)}</span>}</h2>
          {tree===null ? <p className="text-sm text-gray-500">{treeHash ? "Loading…" : "No tree (empty or short hash). Push a commit to see files."}</p> : tree.length===0 ? <p className="text-sm text-gray-500">Empty tree</p> : (
            <ul className="divide-y">
              {tree.map(e=>(
                <li key={e.hash} className="py-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm"><span className="text-gray-400 font-mono text-xs mr-2">{e.mode}</span>{e.name}</span>
                    <button onClick={()=>loadFile(e.hash, e.name)} className="text-xs border px-2 py-1 rounded hover:bg-gray-50">view</button>
                  </div>
                  {fileContent[e.name] && (
                    <pre className="mt-2 bg-gray-900 text-gray-100 p-3 rounded text-xs overflow-auto max-h-64">{fileContent[e.name].slice(0,5000)}</pre>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {readme && (
        <div className="border rounded-lg bg-white p-4 prose max-w-none">
          <h2 className="font-medium">README</h2>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{readme}</ReactMarkdown>
        </div>
      )}

      <div className="border rounded-lg bg-white p-4 space-y-3">
        <h2 className="font-medium">Settings</h2>
        <div className="flex gap-2 items-center">
          <label className="text-sm">Visibility</label>
          <select value={settingsVis||'private'} onChange={e=>setSettingsVis(e.target.value)} className="border rounded px-2 py-1 text-sm">
            <option value="private">private</option><option value="public">public</option>
          </select>
          <button onClick={updateVisibility} className="text-sm bg-brand-600 text-white px-3 py-1 rounded">Save</button>
        </div>
        <p className="text-xs text-gray-500">PATCH /api/repos/:owner/:repo `visibility` (admin only). Members: `GET/POST /members` via API (see docs/api.md).</p>
      </div>
    </div>
  );
}
