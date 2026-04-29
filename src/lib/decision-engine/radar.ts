import { getMacroSnapshot } from "../data/fred";
import { getStockSnapshot, type StockSnapshot } from "../data/yahoo";
import { pool } from "../db";
import { errorInfo, log } from "../log";
import { getUserProfile } from "../user-profile";
import { getTickerMarket } from "../warehouse";
import { upsertAlert } from "../alerts";
import { runDecisionEngine } from "./index";
import type { DecisionAction, DecisionEngineOutput, MarketRegime } from "./types";
import { isFiniteNumber } from "./utils";

export type RadarAlertKind =
  | "trend_break"
  | "macro_shift"
  | "concentration_risk"
  | "earnings_risk"
  | "valuation_stretch"
  | "relative_strength_break"
  | "source_drift"
  | "thesis_review"
  | "risk_overlay_downgrade";

export type RadarAlert = {
  ticker: string;
  kind: RadarAlertKind;
  severity: "info" | "warn" | "action";
  title: string;
  body: string;
  triggeredAt: string;
  dataPoints: string[];
  recommendedReview: string;
};

const ADVERSE_REGIMES: MarketRegime[] = [
  "RATE_PRESSURE",
  "LIQUIDITY_STRESS",
  "RECESSION_RISK",
  "HIGH_VOLATILITY_RISK_OFF",
];

const BUYISH_ACTIONS: DecisionAction[] = [
  "BUY_CANDIDATE",
  "HIGH_CONVICTION_CANDIDATE",
];

const REVIEW_ACTIONS: DecisionAction[] = [
  "HOLD_WATCH",
  "REDUCE_REVIEW",
  "AVOID",
  "INSUFFICIENT_DATA",
];

export async function scanTickerForRadarAlerts(args: {
  userId: string;
  ticker: string;
}): Promise<RadarAlert[]> {
  const ticker = args.ticker.toUpperCase();
  try {
    const [snapshot, macroRaw, profile, previous, recentMarket] =
      await Promise.all([
        getStockSnapshot(ticker),
        getMacroSnapshot(),
        getUserProfile(args.userId),
        getPreviousDecision(args.userId, ticker),
        getRecentMarketRows(ticker),
      ]);
    const decisionEngine = await runDecisionEngine({
      userId: args.userId,
      ticker,
      snapshot,
      macroRaw,
      riskProfileHint: profile.riskTolerance,
    });

    return buildRadarAlerts({
      ticker,
      decisionEngine,
      previous,
      recentMarket,
      triggeredAt: new Date().toISOString(),
    });
  } catch (err) {
    log.warn("decision-engine.radar", "ticker scan failed", {
      ticker,
      ...errorInfo(err),
    });
    return [];
  }
}

export async function scanUserHoldingsForRadarAlerts(args: {
  userId: string;
  limit?: number;
}): Promise<RadarAlert[]> {
  const limit = Math.max(1, Math.min(args.limit ?? 20, 50));
  try {
    const [profile, macroRaw, holdings] = await Promise.all([
      getUserProfile(args.userId),
      getMacroSnapshot(),
      pool.query<HoldingRadarRow>(
        `SELECT ticker,
                MAX("lastPrice")::float AS "lastPrice",
                MAX(sector) AS sector,
                MAX(industry) AS industry,
                SUM(COALESCE("lastValue", shares * COALESCE("lastPrice", "avgPrice", 0)))::float AS value
         FROM "holding"
        WHERE "userId" = $1
          AND ticker IS NOT NULL
        GROUP BY ticker
        ORDER BY value DESC
        LIMIT $2`,
        [args.userId, limit]
      ),
    ]);
    const alerts: RadarAlert[] = [];
    for (const row of holdings.rows) {
      const ticker = row.ticker.toUpperCase();
      const tickerAlerts = await scanStoredHoldingForRadarAlerts({
        userId: args.userId,
        ticker,
        holding: row,
        macroRaw,
        riskProfileHint: profile.riskTolerance,
      });
      alerts.push(...tickerAlerts);
    }
    return alerts.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  } catch (err) {
    log.warn("decision-engine.radar", "holding scan failed", {
      ...errorInfo(err),
    });
    return [];
  }
}

async function scanStoredHoldingForRadarAlerts(args: {
  userId: string;
  ticker: string;
  holding: HoldingRadarRow;
  macroRaw: unknown;
  riskProfileHint: string | null;
}): Promise<RadarAlert[]> {
  try {
    const [previous, recentMarket] = await Promise.all([
      getPreviousDecision(args.userId, args.ticker),
      getRecentMarketRows(args.ticker),
    ]);
    const snapshot = snapshotFromStoredHolding(
      args.ticker,
      args.holding,
      recentMarket[0] ?? null
    );
    const decisionEngine = await runDecisionEngine({
      userId: args.userId,
      ticker: args.ticker,
      snapshot,
      macroRaw: args.macroRaw,
      riskProfileHint: args.riskProfileHint,
    });

    return buildRadarAlerts({
      ticker: args.ticker,
      decisionEngine,
      previous,
      recentMarket,
      triggeredAt: new Date().toISOString(),
    });
  } catch (err) {
    log.warn("decision-engine.radar", "stored holding scan failed", {
      ticker: args.ticker,
      ...errorInfo(err),
    });
    return [];
  }
}

export async function persistRadarAlertsForUser(args: {
  userId: string;
  limit?: number;
}): Promise<{ scanned: number; created: number }> {
  const alerts = await scanUserHoldingsForRadarAlerts(args);
  let created = 0;
  const dayKey = new Date().toISOString().slice(0, 10);

  for (const alert of alerts) {
    const inserted = await upsertAlert({
      userId: args.userId,
      kind: "risk_radar",
      ticker: alert.ticker,
      severity: alert.severity,
      title: alert.title,
      body: alert.body,
      metadata: {
        dedupKey: `risk_radar:${alert.ticker}:${alert.kind}:${dayKey}`,
        radarKind: alert.kind,
        dataPoints: alert.dataPoints,
        recommendedReview: alert.recommendedReview,
        triggeredAt: alert.triggeredAt,
      },
    });
    if (inserted) created++;
  }

  return { scanned: alerts.length, created };
}

export async function persistRadarAlertsForAllUsers(args: {
  userLimit?: number;
  holdingsLimit?: number;
} = {}): Promise<{ usersScanned: number; alertsScanned: number; created: number }> {
  const userLimit = Math.max(1, Math.min(args.userLimit ?? 200, 500));
  const holdingsLimit = Math.max(1, Math.min(args.holdingsLimit ?? 8, 25));
  const { rows } = await pool.query<{ userId: string }>(
    `SELECT "userId"
       FROM "holding"
      WHERE ticker IS NOT NULL
        AND COALESCE("lastValue", shares * COALESCE("lastPrice", "avgPrice", 0)) > 0
      GROUP BY "userId"
      ORDER BY MAX("lastSyncedAt") DESC NULLS LAST
      LIMIT $1`,
    [userLimit]
  );

  let alertsScanned = 0;
  let created = 0;
  for (const row of rows) {
    const result = await persistRadarAlertsForUser({
      userId: row.userId,
      limit: holdingsLimit,
    });
    alertsScanned += result.scanned;
    created += result.created;
  }

  return { usersScanned: rows.length, alertsScanned, created };
}

function buildRadarAlerts(args: {
  ticker: string;
  decisionEngine: DecisionEngineOutput;
  previous: PreviousDecision | null;
  recentMarket: MarketPoint[];
  triggeredAt: string;
}): RadarAlert[] {
  const alerts: RadarAlert[] = [];
  const latest = args.recentMarket[0] ?? null;
  const previousMarket = args.recentMarket[1] ?? null;
  const gateIds = new Set(
    args.decisionEngine.riskGates
      .filter((gate) => gate.triggered)
      .map((gate) => gate.id)
  );

  if (latest) {
    const below50 = crossesBelow(latest.close, latest.ma50, previousMarket?.close, previousMarket?.ma50);
    const below200 = crossesBelow(latest.close, latest.ma200, previousMarket?.close, previousMarket?.ma200);
    const maCross = isFiniteNumber(latest.ma50) && isFiniteNumber(latest.ma200) && latest.ma50 < latest.ma200;
    if (below50 || below200 || maCross) {
      alerts.push(
        makeAlert({
          ticker: args.ticker,
          kind: "trend_break",
          severity: below200 || maCross ? "warn" : "info",
          title: `${args.ticker} trend needs review`,
          body:
            "Risk Radar detected a moving-average trend break. Review the thesis and risk overlay before adding exposure.",
          triggeredAt: args.triggeredAt,
          dataPoints: [
            latest.close != null ? `Close: $${latest.close.toFixed(2)}` : null,
            latest.ma50 != null ? `50-day MA: $${latest.ma50.toFixed(2)}` : null,
            latest.ma200 != null ? `200-day MA: $${latest.ma200.toFixed(2)}` : null,
          ],
          recommendedReview:
            "Review trend quality, support levels, and whether the original thesis still depends on upward momentum.",
        })
      );
    }
    if (isFiniteNumber(latest.relStrengthSpy30d) && latest.relStrengthSpy30d < 0) {
      const crossed =
        !previousMarket ||
        !isFiniteNumber(previousMarket.relStrengthSpy30d) ||
        previousMarket.relStrengthSpy30d >= 0;
      if (crossed) {
        alerts.push(
          makeAlert({
            ticker: args.ticker,
            kind: "relative_strength_break",
            severity: "info",
            title: `${args.ticker} relative strength turned negative`,
            body:
              "The ticker is underperforming SPY over the 30-day relative-strength window.",
            triggeredAt: args.triggeredAt,
            dataPoints: [
              `Relative strength vs SPY: ${latest.relStrengthSpy30d.toFixed(2)}%`,
            ],
            recommendedReview:
              "Review whether the position still deserves attention versus broad-market alternatives.",
          })
        );
      }
    }
  }

  if (
    args.previous &&
    ["RISK_ON", "NEUTRAL"].includes(args.previous.marketRegime ?? "") &&
    ADVERSE_REGIMES.includes(args.decisionEngine.marketRegime)
  ) {
    alerts.push(
      makeAlert({
        ticker: args.ticker,
        kind: "macro_shift",
        severity: "warn",
        title: `${args.ticker} macro regime shifted`,
        body:
          "The market regime moved from constructive/neutral into a more restrictive regime.",
        triggeredAt: args.triggeredAt,
        dataPoints: [
          `Previous regime: ${args.previous.marketRegime}`,
          `Current regime: ${args.decisionEngine.marketRegime}`,
        ],
        recommendedReview:
          "Review whether the position still fits the current macro regime and risk profile.",
      })
    );
  }

  if (gateIds.has("macro_high_beta_cap")) {
    alerts.push(
      makeAlert({
        ticker: args.ticker,
        kind: "macro_shift",
        severity: "warn",
        title: `${args.ticker} high beta is capped by risk-off conditions`,
        body:
          "The deterministic risk overlay is applying a stricter cap because volatility or liquidity stress is elevated.",
        triggeredAt: args.triggeredAt,
        dataPoints: [
          `Market regime: ${args.decisionEngine.marketRegime}`,
          "Risk gate: high beta in risk-off regime",
        ],
        recommendedReview:
          "Review position size and downside scenarios under the current market regime.",
      })
    );
  }

  if (gateIds.has("portfolio_concentration_warn") || gateIds.has("portfolio_concentration_severe")) {
    const currentPct = args.decisionEngine.positionSizing.currentPositionPct;
    alerts.push(
      makeAlert({
        ticker: args.ticker,
        kind: "concentration_risk",
        severity: gateIds.has("portfolio_concentration_severe") ? "action" : "warn",
        title: `${args.ticker} concentration risk needs review`,
        body:
          "This holding is above a portfolio concentration threshold in the risk overlay.",
        triggeredAt: args.triggeredAt,
        dataPoints: [
          currentPct != null ? `Current position: ${currentPct.toFixed(1)}%` : null,
          `Suggested max allocation: ${args.decisionEngine.positionSizing.suggestedMaxPositionPct}%`,
        ],
        recommendedReview:
          "Review concentration exposure and avoid treating this alert as an instruction to trade.",
      })
    );
  }

  if (
    gateIds.has("event_earnings_soon_cap") ||
    gateIds.has("event_material_filing_cap") ||
    gateIds.has("event_negative_headline_cap")
  ) {
    alerts.push(
      makeAlert({
        ticker: args.ticker,
        kind: "earnings_risk",
        severity: gateIds.has("event_negative_headline_cap") ? "action" : "warn",
        title: `${args.ticker} event risk needs review`,
        body:
          "A near-term event, material filing, or negative headline is affecting the risk overlay.",
        triggeredAt: args.triggeredAt,
        dataPoints: args.decisionEngine.riskGates
          .filter((gate) => gate.triggered && gate.id.startsWith("event_"))
          .map((gate) => gate.title),
        recommendedReview:
          "Review the event, timing risk, and whether the thesis should wait for updated information.",
      })
    );
  }

  const valuation = args.decisionEngine.scoreComponents.find(
    (component) => component.name === "Valuation"
  );
  const technical = args.decisionEngine.scoreComponents.find(
    (component) => component.name === "Technical Trend"
  );
  if (latest && technical && latest.rsi14 != null && latest.rsi14 > 80) {
    const extendedAbove50 =
      isFiniteNumber(latest.close) &&
      isFiniteNumber(latest.ma50) &&
      latest.ma50 > 0 &&
      (latest.close - latest.ma50) / latest.ma50 > 0.1;
    const extendedAbove200 =
      isFiniteNumber(latest.close) &&
      isFiniteNumber(latest.ma200) &&
      latest.ma200 > 0 &&
      (latest.close - latest.ma200) / latest.ma200 > 0.2;
    if (extendedAbove50 || extendedAbove200) {
      alerts.push(
        makeAlert({
          ticker: args.ticker,
          kind: "valuation_stretch",
          severity: "info",
          title: `${args.ticker} looks extended`,
          body:
            "RSI is above 80 while price is extended above moving averages.",
          triggeredAt: args.triggeredAt,
          dataPoints: [
            `RSI: ${latest.rsi14.toFixed(1)}`,
            latest.ma50 != null ? `50-day MA: $${latest.ma50.toFixed(2)}` : null,
            latest.ma200 != null ? `200-day MA: $${latest.ma200.toFixed(2)}` : null,
            valuation ? `Valuation score: ${valuation.score}/100` : null,
          ],
          recommendedReview:
            "Review whether valuation and momentum still justify the risk overlay.",
        })
      );
    }
  }

  if (
    args.previous?.snapshotPrice != null &&
    latest?.close != null &&
    valuation &&
    args.previous.valuationScore != null
  ) {
    const priceMove = ((latest.close - args.previous.snapshotPrice) / args.previous.snapshotPrice) * 100;
    const valuationDrop = args.previous.valuationScore - valuation.score;
    if (priceMove >= 15 && valuationDrop >= 10) {
      alerts.push(
        makeAlert({
          ticker: args.ticker,
          kind: "valuation_stretch",
          severity: "warn",
          title: `${args.ticker} valuation score deteriorated after a price rise`,
          body:
            "Price has moved materially higher while the deterministic valuation component weakened.",
          triggeredAt: args.triggeredAt,
          dataPoints: [
            `Price move since last analysis: ${priceMove.toFixed(1)}%`,
            `Valuation score change: ${args.previous.valuationScore}/100 to ${valuation.score}/100`,
          ],
          recommendedReview:
            "Review whether the original upside still compensates for valuation risk.",
        })
      );
    }
  }

  if (
    args.previous &&
    BUYISH_ACTIONS.includes(args.previous.action) &&
    REVIEW_ACTIONS.includes(args.decisionEngine.action)
  ) {
    alerts.push(
      makeAlert({
        ticker: args.ticker,
        kind: "risk_overlay_downgrade",
        severity: "action",
        title: `${args.ticker} risk overlay downgraded`,
        body:
          "The previous deterministic risk overlay was a buy candidate, but the current overlay is more conservative.",
        triggeredAt: args.triggeredAt,
        dataPoints: [
          `Previous action: ${args.previous.action}`,
          `Current action: ${args.decisionEngine.action}`,
          `Current Trade Quality Score: ${args.decisionEngine.tradeQualityScore}/100`,
        ],
        recommendedReview:
          "Review the thesis, risk gates, and position sizing before making any portfolio decision.",
      })
    );
  }

  if (gateIds.has("data_source_drift_warn") || gateIds.has("data_source_drift_block")) {
    const driftGate = args.decisionEngine.riskGates.find(
      (gate) =>
        gate.triggered &&
        (gate.id === "data_source_drift_warn" ||
          gate.id === "data_source_drift_block")
    );
    alerts.push(
      makeAlert({
        ticker: args.ticker,
        kind: "source_drift",
        severity: gateIds.has("data_source_drift_block") ? "action" : "warn",
        title: `${args.ticker} source verification drift`,
        body:
          "Cross-source price verification drift is elevated, which can reduce confidence in the risk overlay.",
        triggeredAt: args.triggeredAt,
        dataPoints: [
          driftGate?.title ?? "Source drift detected",
          ...(latest?.verifyDeltaPct != null
            ? [`Verification delta: ${latest.verifyDeltaPct.toFixed(2)}%`]
            : []),
        ],
        recommendedReview:
          "Review the data source freshness before relying on the analysis.",
      })
    );
  }

  if (
    args.decisionEngine.riskLevel === "HIGH" ||
    args.decisionEngine.riskLevel === "EXTREME"
  ) {
    alerts.push(
      makeAlert({
        ticker: args.ticker,
        kind: "thesis_review",
        severity: args.decisionEngine.riskLevel === "EXTREME" ? "action" : "warn",
        title: `${args.ticker} thesis review suggested`,
        body:
          "The current risk overlay is high enough to warrant a thesis review.",
        triggeredAt: args.triggeredAt,
        dataPoints: [
          `Risk level: ${args.decisionEngine.riskLevel}`,
          `Action: ${args.decisionEngine.action}`,
          `Trade Quality Score: ${args.decisionEngine.tradeQualityScore}/100`,
        ],
        recommendedReview:
          "Review risk gates, missing data, and what would change this view.",
      })
    );
  }

  return dedupeAlerts(alerts);
}

function makeAlert(input: Omit<RadarAlert, "body" | "dataPoints"> & {
  body: string;
  dataPoints: Array<string | null | undefined>;
}): RadarAlert {
  return {
    ...input,
    body: `${input.body} Informational only, not investment advice.`,
    dataPoints: input.dataPoints.filter((v): v is string => !!v),
    recommendedReview: `Review: ${input.recommendedReview}`,
  };
}

function crossesBelow(
  currentValue: number | null,
  currentThreshold: number | null,
  previousValue?: number | null,
  previousThreshold?: number | null
): boolean {
  if (!isFiniteNumber(currentValue) || !isFiniteNumber(currentThreshold)) {
    return false;
  }
  if (currentValue >= currentThreshold) return false;
  if (!isFiniteNumber(previousValue) || !isFiniteNumber(previousThreshold)) {
    return true;
  }
  return previousValue >= previousThreshold;
}

function dedupeAlerts(alerts: RadarAlert[]): RadarAlert[] {
  const seen = new Set<string>();
  const out: RadarAlert[] = [];
  for (const alert of alerts) {
    const key = `${alert.ticker}:${alert.kind}:${alert.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(alert);
  }
  return out.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

function severityRank(severity: RadarAlert["severity"]): number {
  if (severity === "action") return 3;
  if (severity === "warn") return 2;
  return 1;
}

type MarketPoint = {
  close: number | null;
  ma50: number | null;
  ma200: number | null;
  rsi14: number | null;
  relStrengthSpy30d: number | null;
  verifyDeltaPct: number | null;
};

type HoldingRadarRow = {
  ticker: string;
  lastPrice: number | string | null;
  sector: string | null;
  industry: string | null;
  value: number | string | null;
};

function snapshotFromStoredHolding(
  ticker: string,
  holding: HoldingRadarRow,
  market: MarketPoint | null
): StockSnapshot {
  const price = market?.close ?? numberOrNull(holding.lastPrice) ?? 0;
  return {
    symbol: ticker,
    name: ticker,
    price,
    currency: "USD",
    change: 0,
    changePct: 0,
    marketCap: null,
    peRatio: null,
    forwardPE: null,
    eps: null,
    dividendYield: null,
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
    fiftyDayAvg: market?.ma50 ?? null,
    twoHundredDayAvg: market?.ma200 ?? null,
    volume: null,
    avgVolume: null,
    beta: null,
    sector: holding.sector,
    industry: holding.industry,
    analystTarget: null,
    recommendationKey: null,
    asOf: new Date().toISOString(),
  };
}

async function getRecentMarketRows(ticker: string): Promise<MarketPoint[]> {
  try {
    const { rows } = await pool.query<{
      close: number | string | null;
      ma_50: number | string | null;
      ma_200: number | string | null;
      rsi_14: number | string | null;
      rel_strength_spy_30d: number | string | null;
      verify_delta_pct: number | string | null;
    }>(
      `SELECT close, ma_50, ma_200, rsi_14, rel_strength_spy_30d, verify_delta_pct
         FROM "ticker_market_daily"
        WHERE ticker = $1
        ORDER BY captured_at DESC
        LIMIT 2`,
      [ticker]
    );
    if (rows.length > 0) {
      return rows.map((row) => ({
        close: numberOrNull(row.close),
        ma50: numberOrNull(row.ma_50),
        ma200: numberOrNull(row.ma_200),
        rsi14: numberOrNull(row.rsi_14),
        relStrengthSpy30d: numberOrNull(row.rel_strength_spy_30d),
        verifyDeltaPct: numberOrNull(row.verify_delta_pct),
      }));
    }
  } catch (err) {
    log.warn("decision-engine.radar", "recent market rows unavailable", {
      ticker,
      ...errorInfo(err),
    });
  }

  const market = await getTickerMarket(ticker);
  if (!market) return [];
  return [
    {
      close: market.close,
      ma50: market.ma50,
      ma200: market.ma200,
      rsi14: market.rsi14,
      relStrengthSpy30d: market.relStrengthSpy30d,
      verifyDeltaPct: market.verifyDeltaPct,
    },
  ];
}

type PreviousDecision = {
  action: DecisionAction;
  marketRegime: MarketRegime | null;
  valuationScore: number | null;
  snapshotPrice: number | null;
};

async function getPreviousDecision(
  userId: string,
  ticker: string
): Promise<PreviousDecision | null> {
  try {
    const { rows } = await pool.query<{ analysisJson: Record<string, unknown> }>(
      `SELECT "analysisJson"
         FROM "recommendation"
        WHERE "userId" = $1
          AND ticker = $2
        ORDER BY "createdAt" DESC
        LIMIT 1`,
      [userId, ticker]
    );
    const analysis = rows[0]?.analysisJson;
    if (!analysis || typeof analysis !== "object") return null;
    const decisionEngine = analysis.decisionEngine as
      | DecisionEngineOutput
      | null
      | undefined;
    if (!decisionEngine) return null;
    const valuationScore =
      decisionEngine.scoreComponents.find(
        (component) => component.name === "Valuation"
      )?.score ?? null;
    const snapshot = analysis.snapshot as Record<string, unknown> | undefined;
    return {
      action: decisionEngine.action,
      marketRegime: decisionEngine.marketRegime,
      valuationScore,
      snapshotPrice: numberOrNull(snapshot?.price),
    };
  } catch (err) {
    log.warn("decision-engine.radar", "previous decision unavailable", {
      ticker,
      ...errorInfo(err),
    });
    return null;
  }
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
