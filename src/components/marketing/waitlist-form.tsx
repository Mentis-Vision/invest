"use client";

import { useState } from "react";
import { Loader2, Check } from "lucide-react";

/**
 * Waitlist form.
 *
 * - `layout="horizontal"` (default) — side-by-side email + button, good
 *   for the landing hero / wide contexts.
 * - `layout="vertical"` — stacked email over button, used inside narrow
 *   pricing cards (~250-300px wide) where horizontal packing cropped
 *   the "Request access" label.
 */
export default function WaitlistForm({
  source,
  layout = "horizontal",
}: {
  source?: string;
  layout?: "horizontal" | "vertical";
}) {
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

  const horizontal = layout === "horizontal";

  return (
    <form
      onSubmit={handleSubmit}
      className={
        horizontal
          ? "flex flex-col gap-2 sm:flex-row"
          : "flex flex-col gap-2"
      }
    >
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="w-full flex-1 rounded-md border border-input bg-card px-4 py-2.5 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-foreground/40"
        disabled={status === "loading"}
      />
      <button
        type="submit"
        disabled={status === "loading" || !email}
        className={`flex items-center justify-center gap-2 rounded-md bg-[var(--buy)] text-[13px] font-semibold text-[var(--primary-foreground)] transition-all hover:bg-[var(--buy)]/90 disabled:opacity-60 ${
          horizontal ? "px-5 py-2.5" : "w-full px-4 py-2.5"
        }`}
      >
        {status === "loading" && <Loader2 className="h-4 w-4 animate-spin" />}
        <span className="whitespace-nowrap">Request access</span>
      </button>
      {error && (
        <div className="mt-1 text-[12px] text-[var(--destructive)]">
          {error}
        </div>
      )}
    </form>
  );
}
