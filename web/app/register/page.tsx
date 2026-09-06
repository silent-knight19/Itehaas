"use client";
import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  AlertCircle,
  Loader2,
  Eye,
  EyeOff,
  User,
  Mail,
  Lock,
  Check,
  ShieldCheck,
} from "lucide-react";
import { Api } from "../../lib/api";
import { useToast } from "../../components/Toast";
import { Logo } from "../../components/Logo";

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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

  // Real-time validation checks
  const hasMinLength = password.length >= 8;
  const hasMixedChars = /(?=.*[a-zA-Z])(?=.*[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?])/.test(password);
  const isUsernameValid = /^[a-zA-Z0-9._-]{3,32}$/.test(username);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleanUsername = username.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanUsername || !cleanEmail || !password) {
      setErr("All fields are required.");
      return;
    }

    if (!isUsernameValid) {
      setErr("Username must be 3–32 characters (letters, numbers, dot, dash, underscore).");
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
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("itehaas-auth-change"));
        }
        router.push("/");
        router.refresh();
      } else {
        setLoading(false);
        const errMsg = res.json?.error || "Registration failed.";
        console.error("[Register] Account creation failed:", errMsg, res.status);
        setErr(errMsg);
      }
    } catch (e: any) {
      setLoading(false);
      const errMsg = e.message || "Failed to connect to registration server.";
      console.error("[Register] Exception during registration:", e);
      setErr(errMsg);
    }
  }

  return (
    <div className="relative w-full min-h-[90vh] flex flex-col items-center justify-center p-4 sm:p-6 my-auto select-none">
      {/* Background Architectural Grid & Subtle Ambient Glow */}
      <div className="absolute inset-0 bg-grid-pattern opacity-70 pointer-events-none" />
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] h-[320px] ambient-glow-radial pointer-events-none" />

      <div className="relative w-full max-w-[420px] space-y-6 z-10">
        {/* Brand Header */}
        <div className="text-center space-y-3">
          <Link
            href="/"
            className="inline-flex items-center justify-center p-2.5 rounded-2xl bg-surface/50 border border-border-default/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_8px_16px_-4px_rgba(0,0,0,0.5)] hover:border-border-emphasis transition-all duration-normal group"
          >
            <Logo variant="full" size="lg" priority />
          </Link>
          <div className="space-y-1">
            <h1 className="text-xl sm:text-2xl font-semibold text-fg tracking-tight">
              Create your account
            </h1>
            <p className="text-xs text-fg-muted max-w-xs mx-auto leading-relaxed">
              Join Itehaas to host code, collaborate, and manage repositories.
            </p>
          </div>
        </div>

        {/* Glassmorphic Precision Card */}
        <div className="relative rounded-2xl border border-border-default/80 bg-surface/90 backdrop-blur-xl p-6 sm:p-7 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_24px_48px_-12px_rgba(0,0,0,0.85)] space-y-5">
          {/* Error Alert */}
          {err && (
            <div className="flex items-start gap-2.5 rounded-lg border border-danger-border bg-danger-subtle/80 p-3 text-xs text-danger shadow-xs animate-in fade-in duration-normal">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span className="font-mono leading-relaxed">{err}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" autoComplete="on">
            {/* Username Input */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="reg-username"
                  className="block text-xs font-medium text-fg-secondary"
                >
                  Username
                </label>
                {username.length > 0 && (
                  <span
                    className={`text-[10px] font-mono ${
                      isUsernameValid ? "text-success" : "text-fg-subtle"
                    }`}
                  >
                    {isUsernameValid ? "Valid handle" : "3–32 chars"}
                  </span>
                )}
              </div>
              <div className="relative flex items-center rounded-lg border border-border-default bg-[#0b0d12]/90 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 transition-all duration-fast shadow-inner">
                <User className="absolute left-3 h-4 w-4 text-fg-muted pointer-events-none" />
                <input
                  id="reg-username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. silentknight"
                  pattern="^[a-zA-Z0-9._-]+$"
                  required
                  autoFocus
                  className="w-full bg-transparent py-2.5 pl-9 pr-3 text-xs text-fg placeholder:text-fg-subtle focus:outline-none"
                />
              </div>
            </div>

            {/* Email Input */}
            <div className="space-y-1.5">
              <label
                htmlFor="reg-email"
                className="block text-xs font-medium text-fg-secondary"
              >
                Email Address
              </label>
              <div className="relative flex items-center rounded-lg border border-border-default bg-[#0b0d12]/90 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 transition-all duration-fast shadow-inner">
                <Mail className="absolute left-3 h-4 w-4 text-fg-muted pointer-events-none" />
                <input
                  id="reg-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  required
                  className="w-full bg-transparent py-2.5 pl-9 pr-3 text-xs text-fg placeholder:text-fg-subtle focus:outline-none"
                />
              </div>
            </div>

            {/* Password Input */}
            <div className="space-y-1.5">
              <label
                htmlFor="reg-password"
                className="block text-xs font-medium text-fg-secondary"
              >
                Password
              </label>
              <div className="relative flex items-center rounded-lg border border-border-default bg-[#0b0d12]/90 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 transition-all duration-fast shadow-inner">
                <Lock className="absolute left-3 h-4 w-4 text-fg-muted pointer-events-none" />
                <input
                  id="reg-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create a strong password"
                  required
                  minLength={8}
                  className="w-full bg-transparent py-2.5 pl-9 pr-10 text-xs font-mono text-fg placeholder:text-fg-subtle focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-2.5 p-1 text-fg-muted hover:text-fg rounded transition-colors focus:outline-none"
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>

              {/* Real-time Requirement Checks */}
              <div className="flex items-center gap-4 pt-1 text-[11px] text-fg-muted">
                <div
                  className={`flex items-center gap-1.5 transition-colors ${
                    hasMinLength ? "text-success" : "text-fg-subtle"
                  }`}
                >
                  <div
                    className={`h-3 w-3 rounded-full flex items-center justify-center text-[9px] ${
                      hasMinLength ? "bg-success/20 text-success" : "bg-surface-active text-fg-subtle"
                    }`}
                  >
                    <Check className="h-2 w-2" />
                  </div>
                  <span>8+ characters</span>
                </div>
                <div
                  className={`flex items-center gap-1.5 transition-colors ${
                    hasMixedChars ? "text-success" : "text-fg-subtle"
                  }`}
                >
                  <div
                    className={`h-3 w-3 rounded-full flex items-center justify-center text-[9px] ${
                      hasMixedChars ? "bg-success/20 text-success" : "bg-surface-active text-fg-subtle"
                    }`}
                  >
                    <Check className="h-2 w-2" />
                  </div>
                  <span>Letters & numbers</span>
                </div>
              </div>
            </div>

            {/* Elevated Action Button */}
            <button
              type="submit"
              disabled={loading}
              className="relative w-full flex items-center justify-center gap-2 rounded-lg bg-gradient-to-b from-blue-500 to-blue-600 px-4 py-2.5 text-xs font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.18)] hover:from-blue-400 hover:to-blue-500 active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none transition-all duration-fast cursor-pointer mt-2"
            >
              {loading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Creating account…</span>
                </>
              ) : (
                <>
                  <span>Create account</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </button>
          </form>

          {/* Card Footer */}
          <div className="border-t border-border-subtle/80 pt-4 text-center text-xs text-fg-muted">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-medium text-fg hover:text-white underline underline-offset-4 decoration-border-emphasis hover:decoration-fg transition-colors"
            >
              Sign in
            </Link>
          </div>
        </div>

        {/* Security / System Footer */}
        <div className="flex items-center justify-center gap-2 text-[11px] text-fg-subtle font-mono tracking-tight select-none">
          <ShieldCheck className="h-3.5 w-3.5 text-fg-subtle" />
          <span>Argon2id Encrypted • Zero-Knowledge • Distributed VCS</span>
        </div>
      </div>
    </div>
  );
}
