// src/lib/dashboard/metrics/monte-carlo-loader.ts
//
// Wires the Monte-Carlo simulator into the Year-Outlook surface.
// Pulls the user's daily portfolio returns (already loaded for the
// risk + factor cards) and the user's goals; runs the simulation.
//
// Sample-size policy: ≥ 50 daily observations to bootstrap from
// the user's own series. Below that threshold we still want a
// useful answer, so the loader falls back to the SPY benchmark
// returns surfaced by loadPortfolioDailyReturns. Both arrays come
// from the same loader call so we don't pay for two warehouse
// round-trips.
//
// Returns null when:
//   - user has no goals row, OR
//   - goals.targetWealth / targetDate / monthlyContribution is null,
//   - OR neither portfolio nor benchmark history is large enough.

import { loadPortfolioDailyReturns } from "./risk-loader";
import { runSimulation, type MonteCarloResult } from "./monte-carlo";
import { getUserGoals } from "../goals-loader";
import { log, errorInfo } from "../../log";

const MIN_USER_SAMPLES = 50;
const MIN_BENCH_SAMPLES = 50;

export interface MonteCarloLoaderResult extends MonteCarloResult {
  /** Which return series the bootstrap drew from. */
  source: "portfolio" | "benchmark";
  /** Years remaining echoed for the chart's x-axis. */
  yearsRemaining: number;
  /** Echoed for renderer callouts. */
  targetValue: number;
  /** Echoed for renderer callouts. */
  currentValue: number;
}

export async function getMonteCarloProjection(
  userId: string,
  currentValue: number,
): Promise<MonteCarloLoaderResult | null> {
  try {
    const goals = await getUserGoals(userId);
    if (!goals?.targetWealth || !goals?.targetDate) return null;
    const targetDate = new Date(goals.targetDate);
    if (Number.isNaN(targetDate.getTime())) return null;
    const yearsRemaining =
      (targetDate.getTime() - Date.now()) / (365.25 * 24 * 60 * 60 * 1000);
    if (yearsRemaining <= 0.25) return null; // <3mo, no point simulating

    const monthlyContribution = goals.monthlyContribution ?? 0;
    if (
      !Number.isFinite(currentValue) ||
      currentValue < 0 ||
      !Number.isFinite(monthlyContribution) ||
      monthlyContribution < 0
    ) {
      return null;
    }

    const { portfolio, benchmark } = await loadPortfolioDailyReturns(userId);
    let history: number[];
    let source: "portfolio" | "benchmark";
    if (portfolio.length >= MIN_USER_SAMPLES) {
      history = portfolio;
      source = "portfolio";
    } else if (benchmark.length >= MIN_BENCH_SAMPLES) {
      history = benchmark;
      source = "benchmark";
    } else {
      return null;
    }

    const sim = runSimulation({
      currentValue: Math.max(0, currentValue),
      monthlyContribution,
      targetValue: goals.targetWealth,
      yearsRemaining,
      returnsHistory: history,
      paths: 10000,
      keepPaths: true,
    });

    return {
      ...sim,
      source,
      yearsRemaining,
      targetValue: goals.targetWealth,
      currentValue,
    };
  } catch (err) {
    log.warn("dashboard.monte-carlo", "getMonteCarloProjection failed", {
      userId,
      ...errorInfo(err),
    });
    return null;
  }
}
