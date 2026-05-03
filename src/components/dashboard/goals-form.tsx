"use client";

// src/components/dashboard/goals-form.tsx
// Phase 3 Batch F goals form — controlled fields for target wealth /
// target date / monthly contribution / current age / risk tolerance,
// plus a live preview of the glidepath target allocation derived from
// (currentAge, riskTolerance). Submits to POST /api/goals; on success
// the caller's parent server component re-fetches via router.refresh.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Check } from "lucide-react";
import {
  targetAllocation,
  type RiskTolerance,
} from "@/lib/dashboard/goals";
import type { UserGoals } from "@/lib/dashboard/goals-loader";

const RISK_OPTIONS: {
  value: RiskTolerance;
  label: string;
  desc: string;
}[] = [
  {
    value: "conservative",
    label: "Conservative",
    desc: "Capital preservation first. Lower volatility, lower returns.",
  },
  {
    value: "moderate",
    label: "Moderate",
    desc: "Balanced risk / return. Comfortable with normal drawdowns.",
  },
  {
    value: "aggressive",
    label: "Aggressive",
    desc: "Higher long-term returns. Willing to accept large drawdowns.",
  },
];

export default function GoalsForm({ initialGoals }: { initialGoals: UserGoals }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [targetWealth, setTargetWealth] = useState<string>(
    initialGoals.targetWealth !== null ? String(initialGoals.targetWealth) : "",
  );
  const [targetDate, setTargetDate] = useState<string>(
    initialGoals.targetDate ?? "",
  );
  const [monthlyContribution, setMonthlyContribution] = useState<string>(
    initialGoals.monthlyContribution !== null
      ? String(initialGoals.monthlyContribution)
      : "",
  );
  const [currentAge, setCurrentAge] = useState<string>(
    initialGoals.currentAge !== null ? String(initialGoals.currentAge) : "",
  );
  const [risk, setRisk] = useState<RiskTolerance | null>(
    initialGoals.riskTolerance,
  );

  const ageNum = Number(currentAge);
  const previewAllocation =
    Number.isFinite(ageNum) && ageNum >= 18 && ageNum <= 120 && risk
      ? targetAllocation(ageNum, risk)
      : null;

  async function save() {
    setError(null);
    setSaved(false);
    setSaving(true);

    const targetWealthNum = targetWealth === "" ? null : Number(targetWealth);
    const monthlyNum =
      monthlyContribution === "" ? null : Number(monthlyContribution);
    const ageVal = currentAge === "" ? null : Number(currentAge);

    if (
      targetWealthNum !== null &&
      (!Number.isFinite(targetWealthNum) || targetWealthNum < 0)
    ) {
      setError("Target wealth must be a positive number.");
      setSaving(false);
      return;
    }
    if (
      ageVal !== null &&
      (!Number.isInteger(ageVal) || ageVal < 18 || ageVal > 120)
    ) {
      setError("Current age must be between 18 and 120.");
      setSaving(false);
      return;
    }
    if (monthlyNum !== null && (!Number.isFinite(monthlyNum) || monthlyNum < 0)) {
      setError("Monthly contribution must be zero or positive.");
      setSaving(false);
      return;
    }

    try {
      const res = await fetch("/api/goals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetWealth: targetWealthNum,
          targetDate: targetDate === "" ? null : targetDate,
          monthlyContribution: monthlyNum,
          currentAge: ageVal,
          riskTolerance: risk,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `save_failed_${res.status}`);
        setSaving(false);
        return;
      }
      setSaved(true);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "network_error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your goals</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">
          We use these to compute your target allocation and tell you whether
          your portfolio is on pace. Informational only, not investment advice.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label
              htmlFor="goals-target-wealth"
              className="text-sm font-medium"
            >
              Target wealth ($)
            </label>
            <Input
              id="goals-target-wealth"
              type="number"
              min={0}
              step={1000}
              placeholder="e.g. 1,000,000"
              value={targetWealth}
              onChange={(e) => setTargetWealth(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="goals-target-date" className="text-sm font-medium">
              Target date
            </label>
            <Input
              id="goals-target-date"
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="goals-monthly-contribution"
              className="text-sm font-medium"
            >
              Monthly contribution ($)
            </label>
            <Input
              id="goals-monthly-contribution"
              type="number"
              min={0}
              step={50}
              placeholder="0"
              value={monthlyContribution}
              onChange={(e) => setMonthlyContribution(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="goals-current-age" className="text-sm font-medium">
              Current age
            </label>
            <Input
              id="goals-current-age"
              type="number"
              min={18}
              max={120}
              step={1}
              placeholder="e.g. 42"
              value={currentAge}
              onChange={(e) => setCurrentAge(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <span className="text-sm font-medium">Risk tolerance</span>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {RISK_OPTIONS.map((opt) => {
              const selected = risk === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setRisk(opt.value)}
                  aria-pressed={selected}
                  className={`text-left rounded-md border p-3 transition-colors ${
                    selected
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <div className="text-sm font-medium">{opt.label}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {opt.desc}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {previewAllocation && (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
            <div className="font-medium mb-1">Glidepath preview</div>
            <div className="text-muted-foreground">
              Target allocation: {previewAllocation.stocksPct}% stocks /{" "}
              {previewAllocation.bondsPct}% bonds /{" "}
              {previewAllocation.cashPct}% cash
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving || pending}>
            {saving || pending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving
              </>
            ) : (
              "Save goals"
            )}
          </Button>
          {saved && (
            <span className="text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              <Check className="h-4 w-4" /> Saved
            </span>
          )}
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
