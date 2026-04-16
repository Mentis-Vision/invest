"use client";

import { useState } from "react";
import { Loader2, Check } from "lucide-react";

export default function WaitlistForm({ source }: { source?: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setError("");

    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Something went wrong");
        setStatus("error");
        return;
      }

      setStatus("success");
    } catch {
      setError("Network error. Try again.");
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className="flex items-center gap-3 rounded-md border border-[var(--buy)]/25 bg-[var(--buy)]/5 px-4 py-3 text-sm">
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--buy)] text-white">
          <Check className="h-3.5 w-3.5" />
        </div>
        <div>
          <p className="font-medium text-foreground">You&rsquo;re on the list.</p>
          <p className="text-muted-foreground">
            We&rsquo;ll email you when access opens.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="flex-1 rounded-md border border-input bg-card px-4 py-3 text-[14px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-foreground/40"
        disabled={status === "loading"}
      />
      <button
        type="submit"
        disabled={status === "loading" || !email}
        className="flex items-center justify-center gap-2 rounded-md bg-[var(--buy)] px-6 py-3 text-[14px] font-semibold text-[var(--primary-foreground)] transition-all hover:bg-[var(--buy)]/90 disabled:opacity-60"
      >
        {status === "loading" && <Loader2 className="h-4 w-4 animate-spin" />}
        Request access
      </button>
      {error && (
        <div className="mt-2 text-sm text-[var(--destructive)] sm:absolute sm:-bottom-6 sm:left-0">
          {error}
        </div>
      )}
    </form>
  );
}
