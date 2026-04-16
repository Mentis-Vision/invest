"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "motion/react";
import { authClient } from "@/lib/auth-client";
import AuthLayout from "@/components/auth-layout";
import { Loader2 } from "lucide-react";

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await authClient.signUp.email({ name, email, password });
    if (error) {
      setError(error.message ?? "Sign up failed");
      setLoading(false);
      return;
    }
    router.push("/");
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
          Create your account
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

      {/* Form */}
      <form onSubmit={handleSignUp} className="space-y-3.5">
        <div>
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.15em] text-white/25">
            Full Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2.5 text-[14px] text-white/90 outline-none transition-colors placeholder:text-white/15 focus:border-white/[0.18] focus:bg-white/[0.05]"
            placeholder="Jane Doe"
          />
        </div>
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
            minLength={8}
            className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2.5 text-[14px] text-white/90 outline-none transition-colors placeholder:text-white/15 focus:border-white/[0.18] focus:bg-white/[0.05]"
            placeholder="Minimum 8 characters"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-[13px] font-semibold text-[#0a0a0f] transition-all hover:bg-white/90 disabled:opacity-50"
        >
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Create Account
        </button>
      </form>

      {/* Footer */}
      <p className="mt-8 text-center text-[12px] text-white/20">
        Already have an account?{" "}
        <Link href="/sign-in" className="text-white/50 underline-offset-4 transition-colors hover:text-white/70 hover:underline">
          Sign in
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
