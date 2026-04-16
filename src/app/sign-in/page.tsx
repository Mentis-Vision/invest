"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "motion/react";
import { authClient } from "@/lib/auth-client";
import AuthLayout from "@/components/auth-layout";
import { Loader2 } from "lucide-react";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleEmailSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await authClient.signIn.email({ email, password });
    if (error) {
      setError(error.message ?? "Sign in failed");
      setLoading(false);
      return;
    }
    router.push("/");
  }

  async function handleGoogleSignIn() {
    await authClient.signIn.social({ provider: "google", callbackURL: "/" });
  }

  return (
    <AuthLayout>
      {/* Logo / Brand */}
      <div className="mb-10 text-center">
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-sm">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 20 L8 10 L14 15 L22 4" className="text-emerald-400" />
            <path d="M18 4 L22 4 L22 8" className="text-emerald-400" />
          </svg>
        </div>
        <h1 className="text-[22px] font-light tracking-tight text-white">
          ClearPath <span className="text-white/40">Invest</span>
        </h1>
        <p className="mt-1.5 text-[13px] text-white/30">
          AI-verified portfolio intelligence
        </p>
      </div>

      {/* Error */}
      {error && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="mb-4 rounded-lg border border-red-500/20 bg-red-500/[0.06] px-3.5 py-2.5 text-[13px] text-red-300/80"
        >
          {error}
        </motion.div>
      )}

      {/* Google OAuth */}
      <button
        onClick={handleGoogleSignIn}
        className="group flex w-full items-center justify-center gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-[13px] font-medium text-white/70 transition-all hover:border-white/[0.15] hover:bg-white/[0.06] hover:text-white/90"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
        </svg>
        Continue with Google
      </button>

      {/* Divider */}
      <div className="my-6 flex items-center gap-3">
        <div className="h-px flex-1 bg-white/[0.06]" />
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/20">or</span>
        <div className="h-px flex-1 bg-white/[0.06]" />
      </div>

      {/* Email form */}
      <form onSubmit={handleEmailSignIn} className="space-y-3.5">
        <div>
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.15em] text-white/25">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2.5 text-[14px] text-white/90 outline-none transition-colors placeholder:text-white/15 focus:border-white/[0.18] focus:bg-white/[0.05]"
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.15em] text-white/25">
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2.5 text-[14px] text-white/90 outline-none transition-colors placeholder:text-white/15 focus:border-white/[0.18] focus:bg-white/[0.05]"
            placeholder="••••••••"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-[13px] font-semibold text-[#0a0a0f] transition-all hover:bg-white/90 disabled:opacity-50"
        >
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Sign In
        </button>
      </form>

      {/* Footer */}
      <p className="mt-8 text-center text-[12px] text-white/20">
        No account?{" "}
        <Link href="/sign-up" className="text-white/50 underline-offset-4 transition-colors hover:text-white/70 hover:underline">
          Create one
        </Link>
      </p>

      {/* Trust badges */}
      <div className="mt-8 flex items-center justify-center gap-4 text-[10px] font-mono uppercase tracking-[0.15em] text-white/15">
        <span>Multi-Model AI</span>
        <span className="text-white/10">·</span>
        <span>Data-Verified</span>
        <span className="text-white/10">·</span>
        <span>Zero Hallucination</span>
      </div>
    </AuthLayout>
  );
}
