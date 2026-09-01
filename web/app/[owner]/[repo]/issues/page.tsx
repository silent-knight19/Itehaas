"use client";
import { useEffect, useState } from "react";
import { Api } from "../../../../lib/api";

export default function Issues({ params }: { params: { owner: string; repo: string } }) {
  const { owner, repo } = params;
  const [issues, setIssues] = useState<any[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [comments, setComments] = useState<Record<string, any[]>>({});

  async function load() {
    const r = await Api.tree ? null : null; // placeholder to keep Api import
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/repos/${owner}/${repo}/issues`, { credentials: 'include' });
    if (res.ok) {
      const j = await res.json();
      setIssues(j.issues);
    }
  }

  useEffect(()=>{ load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/repos/${owner}/${repo}/issues`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body })
    });
    if (res.ok) { setTitle(""); setBody(""); load(); } else alert(await res.text());
  }

  async function loadComments(id: string) {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/repos/${owner}/${repo}/issues/${id}/comments`, { credentials: 'include' });
    if (res.ok) { const j = await res.json(); setComments(c=>({...c, [id]: j.comments})); }
  }

  async function addComment(id: string, text: string) {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/repos/${owner}/${repo}/issues/${id}/comments`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: text })
    });
    if (res.ok) loadComments(id);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{owner}/{repo} — Issues</h1>
      <form onSubmit={create} className="border rounded p-3 bg-gray-50 space-y-2">
        <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Title" className="w-full border rounded px-2 py-1 text-sm" required />
        <textarea value={body} onChange={e=>setBody(e.target.value)} placeholder="Body" className="w-full border rounded px-2 py-1 text-sm" />
        <button className="bg-brand-600 text-white px-3 py-1 rounded text-sm">New Issue</button>
      </form>
      <ul className="space-y-2">
        {issues.map((iss: any)=>(
          <li key={iss.id} className="border rounded p-3 bg-white">
            <div className="flex justify-between">
              <span className="font-medium">{iss.title}</span>
              <span className={`text-xs px-2 py-0.5 rounded ${iss.status==='open'?'bg-green-100 text-green-700':'bg-gray-200'}`}>{iss.status}</span>
            </div>
            <p className="text-sm text-gray-600">{iss.body}</p>
            <p className="text-xs text-gray-400">by {iss.author} • {new Date(iss.created_at).toLocaleString()}</p>
            <button onClick={()=>loadComments(iss.id)} className="text-xs border px-2 py-1 rounded mt-2">Comments {comments[iss.id]?.length ?? ''}</button>
            {comments[iss.id] && (
              <ul className="mt-2 space-y-1">
                {comments[iss.id].map((c:any)=><li key={c.id} className="text-sm bg-gray-50 p-2 rounded"><span className="font-medium">{c.author}:</span> {c.body}</li>)}
                <li><CommentBox onSubmit={(t)=>addComment(iss.id,t)} /></li>
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CommentBox({ onSubmit }: { onSubmit: (t:string)=>void }) {
  const [t, setT] = useState("");
  return (
    <form onSubmit={e=>{e.preventDefault(); if(t) {onSubmit(t); setT("");}}} className="flex gap-2">
      <input value={t} onChange={e=>setT(e.target.value)} placeholder="Comment" className="flex-1 border rounded px-2 py-1 text-sm" />
      <button className="border px-2 py-1 rounded text-sm">Send</button>
    </form>
  );
}
