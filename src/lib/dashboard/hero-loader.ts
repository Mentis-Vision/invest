// src/lib/dashboard/hero-loader.ts
// Spec §6.2. Composes the PortfolioHero data: total / day change /
// MTD-YTD / benchmarks / sparkline / top movers. Pure read of existing
// data sources (portfolio_snapshot + ticker_market_daily + holding +
// user_profile.benchmarks). No AI calls.

import { pool } from "../db";
import { log, errorInfo } from "../log";
import {
  resolveBenchmarkReturn,
  resolveBenchmarkLabel,
  DEFAULT_BENCHMARKS,
} from "./benchmark-resolver";
import { getPortfolioValue } from "./metrics/risk-loader";
import type {
  HeroData,
  BenchmarkComparison,
  TickerMover,
  HeroSparklinePoint,
} from "./types";

interface SnapshotRow {
  capturedAt: string;
  totalValue: number;
}

interface MoverRow {
  ticker: string;
  change_pct: number;
}

interface BenchmarkRow {
  benchmarks: string[] | null;
}

async function loadDayChange(userId: string): Promise<HeroData["dayChange"]> {
  const result = await pool
    .query<SnapshotRow>(
      `SELECT "capturedAt"::text AS "capturedAt", "totalValue"::float AS "totalValue"
       FROM portfolio_snapshot
       WHERE "userId" = $1
       ORDER BY "capturedAt" DESC
       LIMIT 2`,
      [userId],
    )
    .catch((err) => {
      log.warn("dashboard.hero", "day-change query failed", {
        userId,
        ...errorInfo(err),
      });
      return { rows: [] as SnapshotRow[] };
    });
  if (result.rows.length < 2) return null;
  const today = Number(result.rows[0].totalValue);
  const yesterday = Number(result.rows[1].totalValue);
  if (!yesterday) return null;
  return {
    dollars: today - yesterday,
    pct: (today - yesterday) / yesterday,
  };
}

async function loadPeriodReturn(
  userId: string,
  trunc: "month" | "year",
  totalValue: number,
): Promise<number | null> {
  const result = await pool
    .query<{ totalValue: number }>(
      `SELECT "totalValue"::float AS "totalValue"
       FROM portfolio_snapshot
       WHERE "userId" = $1
         AND "capturedAt" >= date_trunc('${trunc}', CURRENT_DATE)
       ORDER BY "capturedAt" ASC
       LIMIT 1`,
      [userId],
    )
    .catch((err) => {
      log.warn("dashboard.hero", `${trunc}-return query failed`, {
        userId,
        ...errorInfo(err),
      });
      return { rows: [] as { totalValue: number }[] };
    });
  const start = result.rows[0]?.totalValue;
  if (!start || !totalValue) return null;
  return (totalValue - Number(start)) / Number(start);
}

async function loadSparkline(userId: string): Promise<HeroSparklinePoint[]> {
  const result = await pool
    .query<SnapshotRow>(
      `SELECT "capturedAt"::text AS "capturedAt", "totalValue"::float AS "totalValue"
       FROM portfolio_snapshot
       WHERE "userId" = $1
         AND "capturedAt" >= CURRENT_DATE - INTERVAL '45 days'
       ORDER BY "capturedAt" ASC
       LIMIT 30`,
      [userId],
    )
    .catch((err) => {
      log.warn("dashboard.hero", "sparkline query failed", {
        userId,
        ...errorInfo(err),
      });
      return { rows: [] as SnapshotRow[] };
    });
  return result.rows.map((r) => ({
    date: r.capturedAt,
    value: Number(r.totalValue),
  }));
}

async function loadTopMovers(userId: string): Promise<TickerMover[]> {
  // De-duplicate held tickers via the `held_unique` CTE — a user with the
  // same ticker in multiple accounts (taxable + IRA + 401k) would
  // otherwise show NVDA three times in the movers row, since the holding
  // table stores one row per (ticker, account).
  const result = await pool
    .query<MoverRow>(
      `WITH latest AS (
         SELECT DISTINCT ON (ticker)
                ticker, change_pct
         FROM ticker_market_daily
         WHERE captured_at >= CURRENT_DATE - INTERVAL '5 days'
         ORDER BY ticker, captured_at DESC
       ),
       held_unique AS (
         SELECT DISTINCT h.ticker
         FROM holding h
         WHERE h."userId" = $1
           AND h."assetClass" IS DISTINCT FROM 'cash'
       )
       SELECT hu.ticker, COALESCE(l.change_pct, 0)::float AS change_pct
       FROM held_unique hu
       LEFT JOIN latest l ON l.ticker = hu.ticker
       WHERE l.change_pct IS NOT NULL
       ORDER BY ABS(l.change_pct) DESC
       LIMIT 5`,
      [userId],
    )
    .catch((err) => {
      log.warn("dashboard.hero", "movers query failed", {
        userId,
        ...errorInfo(err),
      });
      return { rows: [] as MoverRow[] };
    });
  return result.rows.map((r) => ({
    ticker: r.ticker,
    changePct: Number(r.change_pct) / 100,
  }));
}

async function loadUserBenchmarkKeys(userId: string): Promise<string[]> {
  const result = await pool
    .query<BenchmarkRow>(
      `SELECT benchmarks FROM user_profile WHERE "userId" = $1`,
      [userId],
    )
    .catch((err) => {
      log.warn("dashboard.hero", "benchmarks query failed", {
        userId,
        ...errorInfo(err),
      });
      return { rows: [] as BenchmarkRow[] };
    });
  const stored = result.rows[0]?.benchmarks;
  if (Array.isArray(stored) && stored.length > 0) {
    return stored.slice(0, 4).map(String);
  }
  return [...DEFAULT_BENCHMARKS];
}

async function loadBenchmarkComparisons(
  userId: string,
  ytdPct: number | null,
): Promise<BenchmarkComparison[]> {
  if (ytdPct === null) return [];
  const yearStart = new Date();
  yearStart.setUTCMonth(0, 1);
  const fromDate = yearStart.toISOString().slice(0, 10);
  const keys = await loadUserBenchmarkKeys(userId);
  const out: BenchmarkComparison[] = [];
  for (const key of keys) {
    const benchReturn = await resolveBenchmarkReturn(key, fromDate);
    if (benchReturn === null) continue;
    out.push({
      key,
      label: resolveBenchmarkLabel(key),
      deltaPct: ytdPct - benchReturn,
    });
  }
  return out;
}

export async function getHeroData(userId: string): Promise<HeroData> {
  const totalValue = await getPortfolioValue(userId);

  const [dayChange, mtdPct, ytdPct, sparkline, topMovers] = await Promise.all([
    loadDayChange(userId),
    loadPeriodReturn(userId, "month", totalValue),
    loadPeriodReturn(userId, "year", totalValue),
    loadSparkline(userId),
    loadTopMovers(userId),
  ]);

  const benchmarks = await loadBenchmarkComparisons(userId, ytdPct);

  const asOf = sparkline[sparkline.length - 1]?.date ?? null;

  return {
    totalValue,
    dayChange,
    mtdPct,
    ytdPct,
    benchmarks,
    sparkline,
    topMovers,
    asOf,
  };
}
