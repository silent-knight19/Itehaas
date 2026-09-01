"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Api } from "../../lib/api";

export default function Register() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setErr(null);
    const res = await Api.register({ username, email, password });
    setLoading(false);
    if (res.ok) router.push("/");
    else setErr(res.json?.error || "register failed");
  }

  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Register</h1>
      <form onSubmit={submit} className="space-y-3 border rounded-lg p-4 bg-white">
        <input value={username} onChange={e=>setUsername(e.target.value)} placeholder="username (3-32, a-z 0-9 ._-)" className="w-full border rounded px-3 py-2 text-sm" required pattern="^[a-zA-Z0-9._-]{3,32}$" />
        <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="email" className="w-full border rounded px-3 py-2 text-sm" required />
        <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="password (8+)" className="w-full border rounded px-3 py-2 text-sm" required minLength={8} />
        {err && <p className="text-sm text-red-600">{err}</p>}
        <button disabled={loading} className="w-full bg-brand-600 text-white py-2 rounded hover:bg-brand-700 disabled:opacity-50">{loading?"Creating…":"Create account"}</button>
        <p className="text-sm text-center text-gray-500">Have account? <Link href="/login" className="text-brand-600">Login</Link></p>
      </form>
    </div>
  );
}
