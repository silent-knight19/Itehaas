"use client";
import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, AlertCircle, Loader2 } from "lucide-react";
import { Api } from "../../lib/api";
import { useToast } from "../../components/Toast";
import { Logo } from "../../components/Logo";

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
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
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanUsername || !cleanEmail || !password) {
      setErr("All fields are required.");
      return;
    }

    if (password.length < 8) {
      setErr("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    setErr(null);

    try {
      const res = await Api.register({
        username: cleanUsername,
        email: cleanEmail,
        password,
      });

      if (res.ok) {
        toast("Account created successfully", "success");
        router.push("/");
        router.refresh();
      } else {
        setLoading(false);
        setErr(res.json?.error || "Registration failed.");
      }
    } catch (e: any) {
      setLoading(false);
      setErr(e.message || "Failed to connect to registration server.");
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
            Create your account to start hosting code
          </p>
        </div>

        {/* Register Card */}
        <div className="rounded-md border border-border-default bg-surface p-5 space-y-4 shadow-sm">
          {err && (
            <div className="flex items-center gap-2 rounded-xs border border-danger-border bg-danger-subtle p-2.5 text-xs text-danger font-mono">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>{err}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3" autoComplete="on">
            <div className="space-y-1">
              <label htmlFor="reg-username" className="text-xs font-medium text-fg-secondary">
                Username
              </label>
              <input
                id="reg-username"
                name="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. johndoe"
                pattern="^[a-zA-Z0-9._-]+$"
                required
                autoFocus
                className="w-full rounded-sm border border-border-default bg-bg-subtle px-3 py-1.5 text-xs font-mono text-fg placeholder-fg-subtle focus:border-border-emphasis focus:outline-none"
              />
              <p className="text-[11px] text-fg-subtle">
                3–32 characters (alphanumeric, dot, underscore, dash)
              </p>
            </div>

            <div className="space-y-1">
              <label htmlFor="reg-email" className="text-xs font-medium text-fg-secondary">
                Email Address
              </label>
              <input
                id="reg-email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="john@example.com"
                required
                className="w-full rounded-sm border border-border-default bg-bg-subtle px-3 py-1.5 text-xs text-fg placeholder-fg-subtle focus:border-border-emphasis focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="reg-password" className="text-xs font-medium text-fg-secondary">
                Password
              </label>
              <input
                id="reg-password"
                name="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                minLength={8}
                required
                className="w-full rounded-sm border border-border-default bg-bg-subtle px-3 py-1.5 text-xs font-mono text-fg placeholder-fg-subtle focus:border-border-emphasis focus:outline-none"
              />
              <p className="text-[11px] text-fg-subtle">
                At least 8 characters. Avoid common passwords like &quot;password123&quot;.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-1.5 rounded-sm bg-accent py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
            >
              {loading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Creating account…</span>
                </>
              ) : (
                <>
                  <span>Create Account</span>
                  <ArrowRight className="h-3 w-3" />
                </>
              )}
            </button>
          </form>

          <div className="text-center text-xs text-fg-muted pt-1 border-t border-border-subtle">
            Already have an account?{" "}
            <Link href="/login" className="text-fg-secondary hover:text-fg underline font-medium">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
