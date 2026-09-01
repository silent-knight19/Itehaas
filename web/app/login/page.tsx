"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, AlertCircle } from "lucide-react";
import { Api } from "../../lib/api";
import { useToast } from "../../components/Toast";
import { Logo } from "../../components/Logo";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  React.useEffect(() => {
    Api.me().then((res) => {
      if (res.ok && res.json?.user) {
        router.replace("/");
      }
    });
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);

    const res = await Api.login({ username: username.trim(), password });
    setLoading(false);

    if (res.ok) {
      toast("Signed in", "success");
      router.push("/");
    } else {
      setErr(res.json?.error || "Invalid username or password.");
    }
  }

  function fillDemo() {
    setUsername("demo_user");
    setPassword("demopassword123");
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center py-8">
      <div className="w-full max-w-sm space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="mx-auto flex justify-center">
            <Logo variant="full" size="lg" priority />
          </div>
          <p className="text-xs text-fg-muted">
            Version control and code collaboration
          </p>
        </div>

        {/* Login Card */}
        <div className="rounded-md border border-border-default bg-surface p-5 space-y-4 shadow-sm">
          {err && (
            <div className="flex items-center gap-2 rounded-xs border border-danger-border bg-danger-subtle p-2.5 text-xs text-danger font-mono">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>{err}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-secondary">
                Username or Email
              </label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="demo_user"
                required
                autoFocus
                className="w-full rounded-sm border border-border-default bg-bg-subtle px-3 py-1.5 text-xs text-fg placeholder-fg-subtle focus:border-border-emphasis focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-secondary">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                required
                className="w-full rounded-sm border border-border-default bg-bg-subtle px-3 py-1.5 text-xs font-mono text-fg placeholder-fg-subtle focus:border-border-emphasis focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-1.5 rounded-sm bg-accent py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
            >
              <span>{loading ? "Signing in…" : "Sign In"}</span>
              <ArrowRight className="h-3 w-3" />
            </button>
          </form>

          {/* Demo helper */}
          <div className="rounded-xs border border-border-subtle bg-bg-subtle p-2 text-center">
            <button
              type="button"
              onClick={fillDemo}
              className="text-xs text-fg-muted hover:text-fg font-mono transition-colors"
            >
              Fill demo credentials (demo_user)
            </button>
          </div>

          <div className="text-center text-xs text-fg-muted">
            No account yet?{" "}
            <Link href="/register" className="text-fg-secondary hover:text-fg underline">
              Create account
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
