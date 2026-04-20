"use client";

import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Unified modal for Done / Partial / Dismiss chips on the Next Move hero.
 * Renders different fields based on `action`.
 *
 *   took:     optional "Why / what you did" textarea
 *   partial:  "How much" text input + optional "Why that amount" textarea
 *   ignored:  "Why?" textarea (still optional — encouraged)
 *
 * Caller supplies the recommendation context so the modal can show it
 * inline. On Save, caller POSTs to /api/journal/strategy-action.
 */

export type ActionModalPayload = {
  action: "took" | "partial" | "ignored";
  note: string;
  selfReportedAmount?: string;
};

export function ActionModal({
  open,
  action,
  recommendation,
  ticker,
  onClose,
  onSave,
}: {
  open: boolean;
  action: "took" | "partial" | "ignored";
  recommendation: string;
  ticker: string | null;
  onClose: () => void;
  onSave: (payload: ActionModalPayload) => Promise<void> | void;
}) {
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const title =
    action === "took"
      ? "Mark as done"
      : action === "partial"
        ? "You did some — tell us what"
        : "Skip today's recommendation";

  const prompt =
    action === "took"
      ? "Any note?"
      : action === "partial"
        ? "Why that amount?"
        : "Why? (helps your pattern insights)";

  const placeholder =
    action === "partial"
      ? "Still bullish on the thesis, didn't want to fully exit"
      : action === "ignored"
        ? "Disagree with the target — I want to hold a bigger position"
        : "Rebalanced via a couple of small trades over two days";

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({
        action,
        note: note.trim(),
        selfReportedAmount:
          action === "partial" && amount.trim() !== "" ? amount.trim() : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <h2 className="text-[18px] font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-[12px] text-muted-foreground">
          {ticker && <span className="font-mono font-semibold">{ticker}</span>}
          {ticker && " · "}
          {recommendation}
        </p>

        {action === "partial" && (
          <div className="mt-4">
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider">
              How much did you actually do?
            </label>
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value.slice(0, 200))}
              placeholder="Reduced to 36% (trimmed 15%)"
              disabled={saving}
            />
          </div>
        )}

        <div className="mt-4">
          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider">
            {prompt}{" "}
            <span className="font-normal text-muted-foreground normal-case">(optional)</span>
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 500))}
            rows={3}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-primary/40"
            placeholder={placeholder}
            disabled={saving}
          />
          <div className="mt-1 text-[10px] text-muted-foreground">
            {note.length} / 500
          </div>
        </div>

        <div className="mt-5 flex items-center gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className={
              action === "ignored"
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : ""
            }
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {action === "ignored" ? "Dismiss" : "Save to journal"}
          </Button>
        </div>
      </div>
    </div>
  );
}
