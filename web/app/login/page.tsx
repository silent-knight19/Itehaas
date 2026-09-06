"use client";
import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, AlertCircle, Loader2 } from "lucide-react";
import { Api } from "../../lib/api";
import { useToast } from "../../components/Toast";
import { Logo } from "../../components/Logo";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  React.useEffect(() => {
    let active = true;
    Api.me().then((res) => {
      if (active && res.ok && res.json?.user) {
        router.replace("/");
      }
    });
    return () => {
      active = false;
    };
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleanUsername = username.trim();
    if (!cleanUsername || !password) {
      setErr("Please enter both username and password.");
      return;
    }

    setLoading(true);
    setErr(null);

    try {
      const res = await Api.login({ username: cleanUsername, password });
      if (res.ok) {
        toast("Signed in successfully", "success");
        router.push("/");
        router.refresh();
      } else {
        setLoading(false);
        const errMsg = res.json?.error || "Invalid username or password.";
        console.error("[Login] Authentication failed:", errMsg, res.status);
        setErr(errMsg);
      }
    } catch (e: any) {
      setLoading(false);
      const errMsg = e.message || "Failed to connect to authentication server.";
      console.error("[Login] Exception during sign in:", e);
      setErr(errMsg);
    }
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

          <form
            onSubmit={handleSubmit}
            className="space-y-3"
            autoComplete="on"
          >
            <div className="space-y-1">
              <label htmlFor="login-username" className="text-xs font-medium text-fg-secondary">
                Username or Email
              </label>
              <input
                id="login-username"
                name="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username or email"
                required
                autoFocus
                className="w-full rounded-sm border border-border-default bg-bg-subtle px-3 py-1.5 text-xs text-fg placeholder-fg-subtle focus:border-border-emphasis focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="login-password" className="text-xs font-medium text-fg-secondary">
                Password
              </label>
              <input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
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
              {loading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Signing in…</span>
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="h-3 w-3" />
                </>
              )}
            </button>
          </form>

          <div className="text-center text-xs text-fg-muted pt-1 border-t border-border-subtle">
            No account yet?{" "}
            <Link href="/register" className="text-fg-secondary hover:text-fg underline font-medium">
              Create account
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
