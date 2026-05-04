import type {
  DecisionEngineInput,
  DecisionRiskGate,
  PositionSizing,
  RiskLevel,
  RiskProfile,
} from "./types";
import { clampScore, isFiniteNumber, roundNullable } from "./utils";

type SizingDefaults = {
  maxRiskPerTradePct: number;
  suggestedMaxPositionPct: number;
};

const PROFILE_SIZING: Record<RiskProfile, SizingDefaults> = {
  conservative: { maxRiskPerTradePct: 0.5, suggestedMaxPositionPct: 3 },
  balanced: { maxRiskPerTradePct: 1.0, suggestedMaxPositionPct: 5 },
  aggressive: { maxRiskPerTradePct: 1.5, suggestedMaxPositionPct: 8 },
};

export function evaluateRiskGates(
  input: DecisionEngineInput
): DecisionRiskGate[] {
  const gates: DecisionRiskGate[] = [];
  const price = input.snapshot.price;
  const avgVolume = input.snapshot.avgVolume;
  const marketCap = input.snapshot.marketCap;
  const ma50 = input.snapshot.fiftyDayAvg;
  const ma200 = input.snapshot.twoHundredDayAvg;
  const beta = input.snapshot.beta;
  const regime = input.macro?.regime ?? "INSUFFICIENT_DATA";
  const sizing = sizingFor(input.riskProfile);
  const currentPct = input.portfolio?.currentTickerPct ?? null;
  const rr = computeRewardRisk(input).rewardRiskRatio;

  gates.push({
    id: "bad_data_price",
    severity: "block",
    triggered: !isFiniteNumber(price) || price <= 0,
    title: "Current price unavailable",
    rationale:
      "A valid current price is required before the risk overlay can score this ticker.",
  });

  const drift = input.warehouse?.verifyDeltaPct;
  gates.push({
    id: "data_source_drift_warn",
    severity: "warn",
    triggered:
      isFiniteNumber(drift) && Math.abs(drift) >= 1 && Math.abs(drift) <= 5,
    title: "Cross-source price drift",
    rationale:
      "Yahoo and the verification source differ by more than 1%, so confidence is reduced.",
  });
  gates.push({
    id: "data_source_drift_block",
    severity: "block",
    triggered: isFiniteNumber(drift) && Math.abs(drift) > 5,
    title: "Large cross-source price drift",
    rationale:
      "Yahoo and the verification source differ by more than 5%, so the data is treated as unreliable.",
  });

  const dollarVolume =
    isFiniteNumber(price) && isFiniteNumber(avgVolume)
      ? price * avgVolume
      : null;
  gates.push({
    id: "liquidity_dollar_volume_warn",
    severity: "warn",
    triggered: isFiniteNumber(dollarVolume) && dollarVolume < 20_000_000,
    title: "Thin average dollar volume",
    rationale:
      "Average daily dollar volume is below $20M, which can increase slippage and execution risk.",
  });
  gates.push({
    id: "liquidity_microcap_block",
    severity: "block",
    triggered: isFiniteNumber(marketCap) && marketCap < 300_000_000,
    title: "Microcap liquidity risk",
    rationale:
      "Market capitalization is below $300M. The risk overlay avoids low-liquidity microcap setups.",
  });
  gates.push({
    id: "liquidity_low_price_warn",
    severity: "warn",
    triggered: isFiniteNumber(price) && price < 5,
    title: "Low share price",
    rationale:
      "A share price below $5 can carry additional liquidity and volatility risk.",
  });

  const below200 =
    isFiniteNumber(price) && isFiniteNumber(ma200) ? price < ma200 : false;
  const ma50Below200 =
    isFiniteNumber(ma50) && isFiniteNumber(ma200) ? ma50 < ma200 : false;
  gates.push({
    id: "trend_price_below_200d",
    severity: "warn",
    triggered: below200,
    title: "Price below 200-day trend",
    rationale:
      "Price is below the 200-day moving average, a major trend caution.",
  });
  gates.push({
    id: "trend_50d_below_200d",
    severity: "warn",
    triggered: ma50Below200,
    title: "50-day trend below 200-day trend",
    rationale:
      "The 50-day moving average is below the 200-day moving average, which weakens trend quality.",
  });
  gates.push({
    id: "trend_downtrend_cap",
    severity: "warn",
    triggered: below200 && ma50Below200,
    title: "Constructive action capped by trend",
    rationale:
      "Both major trend checks are negative, so the risk overlay will not label this a buy candidate.",
  });

  gates.push({
    id: "macro_high_beta_cap",
    severity: "warn",
    triggered:
      (regime === "HIGH_VOLATILITY_RISK_OFF" ||
        regime === "LIQUIDITY_STRESS") &&
      isFiniteNumber(beta) &&
      beta > 1.5,
    title: "High beta in risk-off regime",
    rationale:
      "High-beta exposure is capped while volatility or liquidity stress is elevated.",
  });

  gates.push({
    id: "event_earnings_soon_cap",
    severity: "warn",
    triggered: input.events?.earningsSoon === true,
    title: "Earnings event soon",
    rationale:
      "Upcoming earnings can create gap risk, so constructive actions are capped until the event clears.",
  });
  gates.push({
    id: "event_material_filing_cap",
    severity: "warn",
    triggered: input.events?.recentMaterialFiling === true,
    title: "Recent material filing",
    rationale:
      "Recent material filings can change the risk picture and require review.",
  });
  gates.push({
    id: "event_negative_headline_cap",
    severity: "warn",
    triggered: input.events?.majorNegativeHeadline === true,
    title: "Major negative headline",
    rationale:
      "Negative company-specific news is treated as a review trigger.",
  });

  gates.push({
    id: "portfolio_concentration_warn",
    severity: "warn",
    triggered: isFiniteNumber(currentPct) && currentPct >= 25,
    title: "Position concentration above 25%",
    rationale:
      "This ticker already represents at least 25% of the known portfolio.",
  });
  gates.push({
    id: "portfolio_concentration_severe",
    severity: "warn",
    triggered: isFiniteNumber(currentPct) && currentPct >= 40,
    title: "Position concentration above 40%",
    rationale:
      "This ticker already represents at least 40% of the known portfolio, which requires a reduce/review posture.",
  });
  gates.push({
    id: "portfolio_over_max_allocation",
    severity: "warn",
    triggered:
      input.portfolio?.portfolioKnown === true &&
      isFiniteNumber(currentPct) &&
      currentPct > sizing.suggestedMaxPositionPct,
    title: "Already above suggested max allocation",
    rationale:
      "The current position is already above the suggested max allocation for this risk profile.",
  });

  gates.push({
    id: "reward_risk_below_2_cap",
    severity: "warn",
    triggered: isFiniteNumber(rr) && rr < 2,
    title: "Reward/risk below 2:1",
    rationale:
      "The available target/review-level setup does not clear a 2:1 reward/risk threshold.",
  });
  gates.push({
    id: "reward_risk_unknown",
    severity: "info",
    triggered: rr === null,
    title: "Reward/risk unavailable",
    rationale:
      "Reward/risk could not be calculated because a valid target or review level is missing.",
  });

  return gates;
}

export function computeRiskPenalty(
  input: DecisionEngineInput,
  gates: DecisionRiskGate[]
): number {
  let penalty = 0;
  for (const gate of gates) {
    if (!gate.triggered) continue;
    if (gate.severity === "block") penalty += 30;
    else if (gate.severity === "warn") penalty += 8;
    else penalty += 2;

    if (gate.id === "trend_downtrend_cap") penalty += 6;
    if (gate.id === "macro_high_beta_cap") penalty += 8;
    if (gate.id === "portfolio_concentration_severe") penalty += 10;
    if (gate.id === "portfolio_over_max_allocation") penalty += 6;
    if (gate.id === "reward_risk_below_2_cap") penalty += 8;
    if (gate.id === "data_source_drift_block") penalty += 10;
  }

  if (input.macro?.regime === "INSUFFICIENT_DATA") penalty += 4;
  return clampScore(Math.min(60, penalty));
}

export function computePositionSizing(
  input: DecisionEngineInput,
  tradeQualityScore: number,
  /**
   * Optional fractional-Kelly suggested allocation, in PERCENT units
   * (e.g. 5 = 5% of portfolio). When provided AND positive, Kelly only
   * ever LOWERS the suggested max — it never raises it. This is the
   * safety property: Kelly is unstable on small samples, so the
   * risk-profile cap is the ceiling and Kelly can only tighten it.
   *
   * Pass null (or omit) when Kelly is unavailable (e.g. <10 outcomes).
   * A zero or negative Kelly is treated as null on purpose — we don't
   * want to zero out users' positions when they happen to have a
   * temporarily-negative win rate; the risk-profile cap stays the
   * floor in that case.
   */
  kellyFractionPct?: number | null
): PositionSizing {
  const sizing = sizingFor(input.riskProfile);
  const rr = computeRewardRisk(input);
  const portfolio = input.portfolio;
  const portfolioKnown = portfolio?.portfolioKnown === true;
  const currentPct =
    portfolioKnown && isFiniteNumber(portfolio?.currentTickerPct)
      ? portfolio.currentTickerPct
      : null;
  const baseMax = Math.min(10, sizing.suggestedMaxPositionPct);
  const profileSuggested =
    tradeQualityScore < 40
      ? Math.min(baseMax, 1)
      : tradeQualityScore < 55
        ? Math.min(baseMax, 2)
        : baseMax;
  // Apply Kelly as a monotonic-decreasing override. We require a
  // strictly-positive Kelly value — null/0/negative all fall through
  // to the risk-profile suggestion unchanged.
  const suggestedMax =
    isFiniteNumber(kellyFractionPct) && kellyFractionPct > 0
      ? Math.min(profileSuggested, kellyFractionPct)
      : profileSuggested;

  let note =
    "Percent-based position guidance only. This is not an order or instruction to trade.";
  if (!portfolioKnown) {
    note =
      "Portfolio value is unavailable, so guidance is percent-based only and no share count is computed.";
  } else if (currentPct != null && currentPct > suggestedMax) {
    note =
      "Current exposure is already above the suggested max allocation; adding exposure is not supported by this risk overlay.";
  }

  return {
    portfolioKnown,
    portfolioValue:
      portfolioKnown && isFiniteNumber(portfolio?.totalValue)
        ? portfolio.totalValue
        : null,
    currentPositionPct: roundNullable(currentPct, 2),
    suggestedMaxPositionPct: suggestedMax,
    maxRiskPerTradePct: sizing.maxRiskPerTradePct,
    suggestedStopPrice: rr.suggestedStopPrice,
    suggestedReviewPrice: rr.suggestedReviewPrice,
    rewardRiskRatio: rr.rewardRiskRatio,
    positionSizingNote: note,
  };
}

export function deriveRiskLevel(
  input: DecisionEngineInput,
  gates: DecisionRiskGate[],
  tradeQualityScore: number
): RiskLevel {
  const triggered = gates.filter((gate) => gate.triggered);
  const hasBlock = triggered.some((gate) => gate.severity === "block");
  if (hasBlock || tradeQualityScore < 30) return "EXTREME";

  const severeConcentration = triggered.some(
    (gate) => gate.id === "portfolio_concentration_severe"
  );
  const majorTrend = triggered.some((gate) => gate.id === "trend_downtrend_cap");
  const riskOffHighBeta = triggered.some(
    (gate) => gate.id === "macro_high_beta_cap"
  );
  if (
    severeConcentration ||
    majorTrend ||
    riskOffHighBeta ||
    tradeQualityScore < 45 ||
    input.macro?.regime === "HIGH_VOLATILITY_RISK_OFF" ||
    input.macro?.regime === "LIQUIDITY_STRESS"
  ) {
    return "HIGH";
  }

  if (triggered.some((gate) => gate.severity === "warn")) return "MEDIUM";
  if (tradeQualityScore >= 75) return "LOW";
  return "MEDIUM";
}

function sizingFor(profile: RiskProfile): SizingDefaults {
  return PROFILE_SIZING[profile] ?? PROFILE_SIZING.balanced;
}

function computeRewardRisk(input: DecisionEngineInput): {
  suggestedStopPrice: number | null;
  suggestedReviewPrice: number | null;
  rewardRiskRatio: number | null;
} {
  const price = input.snapshot.price;
  const ma200 = input.snapshot.twoHundredDayAvg;
  const ma50 = input.snapshot.fiftyDayAvg;
  const analystTarget = input.snapshot.analystTarget;
  let reviewPrice: number | null = null;

  if (
    isFiniteNumber(price) &&
    isFiniteNumber(ma200) &&
    ma200 > 0 &&
    price > ma200
  ) {
    reviewPrice = ma200;
  } else if (isFiniteNumber(ma50) && ma50 > 0) {
    reviewPrice = ma50;
  }

  let rewardRiskRatio: number | null = null;
  if (
    isFiniteNumber(price) &&
    isFiniteNumber(analystTarget) &&
    isFiniteNumber(reviewPrice)
  ) {
    const risk = price - reviewPrice;
    const reward = analystTarget - price;
    if (risk > 0 && reward > 0) {
      rewardRiskRatio = reward / risk;
    } else if (risk > 0) {
      rewardRiskRatio = reward / risk;
    }
  }

  return {
    suggestedStopPrice: roundNullable(
      isFiniteNumber(reviewPrice) && isFiniteNumber(price) && reviewPrice < price
        ? reviewPrice
        : null,
      2
    ),
    suggestedReviewPrice: roundNullable(reviewPrice, 2),
    rewardRiskRatio: roundNullable(rewardRiskRatio, 2),
  };
}
