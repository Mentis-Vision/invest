// src/app/app/year-outlook/page.tsx
//
// Server-rendered Year Outlook surface — Phase 3 Batch G.
//
// Wraps the existing AppShell so the user keeps the same chrome
// (top nav, ticker tape, trial banner, account dropdown) as the rest
// of the authenticated app, then composes the five Year Outlook
// section components in order:
//
//   1. YearPaceHeadline      — Portfolio YTD vs SPY YTD
//   2. PacingCard            — projected wealth + required CAGR
//   3. GlidepathVisualizer   — actual vs target stock/bond/cash split
//   4. RiskLandscape         — Sharpe/Sortino/MaxDD/β + VaR/CVaR
//   5. MacroOutlook          — regime + Buffett indicator
//
// All five loaders are kicked off in parallel via Promise.all so the
// surface renders in the time of the slowest one rather than serial-
// chaining the warehouse → goals → macro fetches.
//
// Each loader is wrapped in catch() so a single transient failure
// degrades the corresponding section to its own empty-state rather
// than crashing the page. Same defensive pattern as /app/page.tsx.

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import AppShell from "@/components/app-shell";
import { getUserGoals } from "@/lib/dashboard/goals-loader";
import {
  getPortfolioRisk,
  getPortfolioValue,
  getPortfolioVaR,
} from "@/lib/dashboard/metrics/risk-loader";
import { YearPaceHeadline } from "@/components/dashboard/year-outlook/year-pace-headline";
import { PacingCard } from "@/components/dashboard/year-outlook/pacing-card";
import { GlidepathVisualizer } from "@/components/dashboard/year-outlook/glidepath-visualizer";
import { RiskLandscape } from "@/components/dashboard/year-outlook/risk-landscape";
import { MacroOutlook } from "@/components/dashboard/year-outlook/macro-outlook";
import { FactorExposureCard } from "@/components/dashboard/year-outlook/factor-exposure-card";
import { getFactorExposure } from "@/lib/dashboard/metrics/fama-french-loader";
import { MonteCarloCard } from "@/components/dashboard/year-outlook/monte-carlo-card";
import { getMonteCarloProjection } from "@/lib/dashboard/metrics/monte-carlo-loader";
import { DamodaranCard } from "@/components/dashboard/year-outlook/damodaran-cost-of-capital-card";
import { MacroVitalsTile } from "@/components/dashboard/year-outlook/macro-vitals-tile";
import { BehavioralAuditCard } from "@/components/dashboard/year-outlook/behavioral-audit-card";
import { getBehavioralAudit } from "@/lib/dashboard/metrics/behavioral-audit-loader";
import { StressTestCard } from "@/components/dashboard/year-outlook/stress-test-card";
import { getStressScenarios } from "@/lib/dashboard/metrics/stress-test-loader";
import { AuditAiCard } from "@/components/dashboard/audit-ai-card";
import { getAuditAiTrackRecord } from "@/lib/dashboard/metrics/audit-ai-loader";
import { log, errorInfo } from "@/lib/log";

export const dynamic = "force-dynamic";

export default async function YearOutlookPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) redirect("/sign-in");
  const userId = session.user.id;

  const [goals, currentValue, risk, varResult, factorExposure] = await Promise.all([
    getUserGoals(userId).catch((err) => {
      log.warn("year-outlook.page", "goals load failed", {
        userId,
        ...errorInfo(err),
      });
      return null;
    }),
    getPortfolioValue(userId).catch((err) => {
      log.warn("year-outlook.page", "portfolio value failed", {
        userId,
        ...errorInfo(err),
      });
      return 0;
    }),
    getPortfolioRisk(userId).catch((err) => {
      log.warn("year-outlook.page", "risk load failed", {
        userId,
        ...errorInfo(err),
      });
      return null;
    }),
    getPortfolioVaR(userId).catch((err) => {
      log.warn("year-outlook.page", "VaR load failed", {
        userId,
        ...errorInfo(err),
      });
      return null;
    }),
    getFactorExposure(userId).catch((err) => {
      log.warn("year-outlook.page", "factor exposure load failed", {
        userId,
        ...errorInfo(err),
      });
      return { exposure: null, asOf: null, dataSource: "synthetic" as const };
    }),
  ]);

  // Monte-Carlo runs after the first wave because it needs the
  // resolved currentValue to seed the simulation. Cheap relative to
  // the warehouse round-trips above (pure CPU once goals load).
  // The Audit-AI track-record query is independent so it parallels.
  const [monteCarloResult, auditAiResult, behavioralAudit, stressScenarios] = await Promise.all([
    getMonteCarloProjection(userId, currentValue).catch((err) => {
      log.warn("year-outlook.page", "monte carlo load failed", {
        userId,
        ...errorInfo(err),
      });
      return null;
    }),
    getAuditAiTrackRecord({ userId, limit: 100, windowDays: 30 }).catch(
      (err) => {
        log.warn("year-outlook.page", "audit-ai load failed", {
          userId,
          ...errorInfo(err),
        });
        return null;
      },
    ),
    getBehavioralAudit(userId).catch((err) => {
      log.warn("year-outlook.page", "behavioral audit load failed", {
        userId,
        ...errorInfo(err),
      });
      return {
        homeBias: null,
        concentrationDrift: null,
        recencyChase: null,
      };
    }),
    getStressScenarios(userId).catch((err) => {
      log.warn("year-outlook.page", "stress test load failed", {
        userId,
        ...errorInfo(err),
      });
      return null;
    }),
  ]);

  const year = new Date().getUTCFullYear();

  return (
    <AppShell
      user={{ name: session.user.name ?? "", email: session.user.email }}
    >
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">
            {year} Year Outlook
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Where you stand year-to-date, where the long-horizon
            trajectory lands, and the macro context behind it.
          </p>
        </header>
        <YearPaceHeadline
          portfolioYtdPct={risk?.ytdPct ?? null}
          benchYtdPct={risk?.benchYtdPct ?? null}
        />
        <PacingCard goals={goals} currentValue={currentValue} />
        <MonteCarloCard result={monteCarloResult} />
        <GlidepathVisualizer userId={userId} goals={goals} />
        <RiskLandscape
          risk={risk}
          varResult={varResult}
          portfolioValue={currentValue}
        />
        <StressTestCard
          scenarios={stressScenarios}
          portfolioValue={currentValue}
        />
        <FactorExposureCard
          exposure={factorExposure.exposure}
          asOf={factorExposure.asOf}
          dataSource={factorExposure.dataSource}
        />
        <DamodaranCard />
        <MacroVitalsTile />
        <MacroOutlook />
        <BehavioralAuditCard audit={behavioralAudit} />
        <AuditAiCard result={auditAiResult} scope="user" />
      </main>
    </AppShell>
  );
}
