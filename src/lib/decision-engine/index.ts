import type { StockSnapshot } from "../data/yahoo";
import { buildDecisionEngineInput } from "./adapter";
import {
  DECISION_ENGINE_WEIGHTS,
  computeDecisionScores,
} from "./score";
import {
  computePositionSizing,
  computeRiskPenalty,
  deriveRiskLevel,
  evaluateRiskGates,
} from "./risk";
import type {
  DecisionAction,
  DecisionConfidence,
  DecisionEngineInput,
  DecisionEngineOutput,
  DecisionRiskGate,
  ScoreComponent,
} from "./types";
import {
  clampScore,
  formatDecisionAction,
  isFiniteNumber,
  uniqueStrings,
} from "./utils";

export * from "./types";
export * from "./utils";
export * from "./score";
export * from "./risk";
export * from "./regime";
export * from "./adapter";
export * from "./explain";
export * from "./benchmark";
export * from "./backtest";

export const DECISION_ENGINE_VERSION = "clearpath-decision-engine-v1";

export async function runDecisionEngine(args: {
  userId: string;
  ticker: string;
  snapshot: StockSnapshot;
  macroRaw?: unknown;
  riskProfileHint?: string | null;
}): Promise<DecisionEngineOutput> {
  const input = await buildDecisionEngineInput(args);
  return runDecisionEngineForInput(input);
}

export function runDecisionEngineForInput(
  input: DecisionEngineInput
): DecisionEngineOutput {
  const scoreResult = computeDecisionScores(input);
  const riskGates = evaluateRiskGates(input);
  const gateRiskPenalty = computeRiskPenalty(input, riskGates);
  const riskPenalty = clampScore(scoreResult.riskPenalty + gateRiskPenalty);
  const tradeQualityScore = clampScore(scoreResult.grossScore - riskPenalty);
  const positionSizing = computePositionSizing(input, tradeQualityScore);
  const riskLevel = deriveRiskLevel(input, riskGates, tradeQualityScore);
  const action = deriveDecisionAction({
    input,
    dataQualityScore: scoreResult.dataQualityScore,
    riskGates,
    tradeQualityScore,
    positionSizing,
  });
  const confidence = deriveConfidence({
    input,
    dataQualityScore: scoreResult.dataQualityScore,
    riskGates,
    tradeQualityScore,
    scoreComponents: scoreResult.scoreComponents,
    missingData: scoreResult.missingData,
    rewardRiskRatio: positionSizing.rewardRiskRatio,
  });
  const reasons = buildReasons(scoreResult.scoreComponents, action);
  const risks = buildRisks(riskGates, scoreResult.scoreComponents);
  const missingData = uniqueStrings(scoreResult.missingData).slice(0, 12);
  const whatWouldChangeThisView = buildWhatWouldChange(
    riskGates,
    scoreResult.scoreComponents,
    positionSizing
  );
  const clientSummary = buildClientSummary({
    ticker: input.ticker,
    action,
    tradeQualityScore,
    riskLevel,
    triggeredGates: riskGates.filter((gate) => gate.triggered).length,
  });

  return {
    ticker: input.ticker,
    asOf: input.asOf,
    action,
    confidence,
    tradeQualityScore,
    riskLevel,
    marketRegime: input.macro?.regime ?? "INSUFFICIENT_DATA",
    scoreComponents: scoreResult.scoreComponents,
    riskGates,
    positionSizing,
    reasons,
    risks,
    missingData,
    whatWouldChangeThisView,
    clientSummary,
    audit: {
      engineVersion: DECISION_ENGINE_VERSION,
      weights: DECISION_ENGINE_WEIGHTS,
      riskProfile: input.riskProfile,
      dataQualityScore: scoreResult.dataQualityScore,
      riskPenalty,
      generatedAt: new Date().toISOString(),
    },
  };
}

function deriveDecisionAction(args: {
  input: DecisionEngineInput;
  dataQualityScore: number;
  riskGates: DecisionRiskGate[];
  tradeQualityScore: number;
  positionSizing: { rewardRiskRatio: number | null; currentPositionPct: number | null };
}): DecisionAction {
  const triggered = args.riskGates.filter((gate) => gate.triggered);
  const hasGate = (id: string) => triggered.some((gate) => gate.id === id);
  if (
    args.dataQualityScore < 60 ||
    hasGate("bad_data_price") ||
    hasGate("data_source_drift_block")
  ) {
    return "INSUFFICIENT_DATA";
  }
  if (hasGate("liquidity_microcap_block")) return "AVOID";

  let action = scoreToAction(args.tradeQualityScore);
  if (
    hasGate("macro_high_beta_cap") ||
    hasGate("event_earnings_soon_cap") ||
    hasGate("event_material_filing_cap") ||
    hasGate("event_negative_headline_cap") ||
    hasGate("trend_downtrend_cap") ||
    hasGate("reward_risk_below_2_cap") ||
    hasGate("portfolio_over_max_allocation")
  ) {
    action = capAction(action, "HOLD_WATCH");
  }
  if (hasGate("portfolio_concentration_severe")) {
    action = capAction(action, "REDUCE_REVIEW");
  }
  return action;
}

function scoreToAction(score: number): DecisionAction {
  if (score >= 85) return "HIGH_CONVICTION_CANDIDATE";
  if (score >= 70) return "BUY_CANDIDATE";
  if (score >= 55) return "HOLD_WATCH";
  if (score >= 40) return "REDUCE_REVIEW";
  return "AVOID";
}

function capAction(
  action: DecisionAction,
  maxAction: Exclude<DecisionAction, "INSUFFICIENT_DATA">
): DecisionAction {
  if (action === "INSUFFICIENT_DATA") return action;
  return actionRank(action) > actionRank(maxAction) ? maxAction : action;
}

function actionRank(action: DecisionAction): number {
  switch (action) {
    case "AVOID":
      return 0;
    case "REDUCE_REVIEW":
      return 1;
    case "HOLD_WATCH":
      return 2;
    case "BUY_CANDIDATE":
      return 3;
    case "HIGH_CONVICTION_CANDIDATE":
      return 4;
    case "INSUFFICIENT_DATA":
      return -1;
  }
}

function deriveConfidence(args: {
  input: DecisionEngineInput;
  dataQualityScore: number;
  riskGates: DecisionRiskGate[];
  tradeQualityScore: number;
  scoreComponents: ScoreComponent[];
  missingData: string[];
  rewardRiskRatio: number | null;
}): DecisionConfidence {
  const triggered = args.riskGates.filter((gate) => gate.triggered);
  const hasBlock = triggered.some((gate) => gate.severity === "block");
  const usableComponents = args.scoreComponents.filter(
    (component) => component.dataPoints.length > 0
  ).length;
  const nearThreshold = [40, 55, 70, 85].some(
    (threshold) => Math.abs(args.tradeQualityScore - threshold) <= 3
  );
  const rewardRiskKnown = isFiniteNumber(args.rewardRiskRatio);

  if (
    args.dataQualityScore >= 85 &&
    !hasBlock &&
    triggered.length === 0 &&
    args.input.macro?.regime !== "INSUFFICIENT_DATA" &&
    args.missingData.length <= 4 &&
    (rewardRiskKnown || args.tradeQualityScore >= 85) &&
    usableComponents >= 5
  ) {
    return "HIGH";
  }

  if (
    args.dataQualityScore < 70 ||
    hasBlock ||
    triggered.length >= 3 ||
    args.missingData.length >= 9 ||
    args.input.macro?.regime === "INSUFFICIENT_DATA" ||
    !rewardRiskKnown ||
    nearThreshold ||
    usableComponents < 5
  ) {
    return "LOW";
  }

  return "MEDIUM";
}

function buildReasons(
  components: ScoreComponent[],
  action: DecisionAction
): string[] {
  const constructive = components
    .filter((component) => component.score >= 60)
    .sort((a, b) => b.score * b.weight - a.score * a.weight)
    .slice(0, 3)
    .map(
      (component) =>
        `${component.name}: ${component.rationale} (${component.score}/100).`
    );

  if (constructive.length === 0) {
    constructive.push(
      `${formatDecisionAction(action)} reflects a cautious aggregate score with limited constructive evidence.`
    );
  }
  return constructive;
}

function buildRisks(
  gates: DecisionRiskGate[],
  components: ScoreComponent[]
): string[] {
  const gateRisks = gates
    .filter((gate) => gate.triggered && gate.severity !== "info")
    .slice(0, 5)
    .map((gate) => `${gate.title}: ${gate.rationale}`);
  const weakComponents = components
    .filter((component) => component.score <= 40)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map(
      (component) =>
        `${component.name}: ${component.rationale} (${component.score}/100).`
    );
  return uniqueStrings([...gateRisks, ...weakComponents]).slice(0, 6);
}

function buildWhatWouldChange(
  gates: DecisionRiskGate[],
  components: ScoreComponent[],
  positionSizing: { rewardRiskRatio: number | null }
): string[] {
  const triggers: string[] = [];
  const activeIds = new Set(
    gates.filter((gate) => gate.triggered).map((gate) => gate.id)
  );
  if (activeIds.has("trend_downtrend_cap")) {
    triggers.push(
      "A sustained recovery above the 200-day moving average with the 50-day trend improving."
    );
  }
  if (activeIds.has("macro_high_beta_cap")) {
    triggers.push(
      "Market regime improving from risk-off or liquidity stress to neutral or risk-on."
    );
  }
  if (activeIds.has("reward_risk_below_2_cap")) {
    triggers.push(
      "A better reward/risk setup, either through a lower review level, stronger target support, or a lower entry price."
    );
  }
  if (activeIds.has("portfolio_over_max_allocation")) {
    triggers.push(
      "Portfolio concentration falling below the suggested max allocation."
    );
  }
  if (!isFiniteNumber(positionSizing.rewardRiskRatio)) {
    triggers.push(
      "A valid analyst target and review level becoming available so reward/risk can be checked."
    );
  }
  const weakest = components
    .filter((component) => component.score < 50)
    .sort((a, b) => a.score - b.score)[0];
  if (weakest) {
    triggers.push(`Improvement in ${weakest.name.toLowerCase()} evidence.`);
  }

  if (triggers.length === 0) {
    triggers.push(
      "Material changes in price trend, valuation, fundamentals, macro regime, or portfolio concentration."
    );
  }
  return uniqueStrings(triggers).slice(0, 5);
}

function buildClientSummary(args: {
  ticker: string;
  action: DecisionAction;
  tradeQualityScore: number;
  riskLevel: string;
  triggeredGates: number;
}): string {
  const gatePart =
    args.triggeredGates > 0
      ? `${args.triggeredGates} risk gate${args.triggeredGates === 1 ? "" : "s"} triggered.`
      : "No risk gates triggered.";
  return `${args.ticker} is a ${formatDecisionAction(args.action)} with a Trade Quality Score of ${args.tradeQualityScore}/100 and ${args.riskLevel.toLowerCase()} risk. ${gatePart} Decision support only; informational only and not investment advice.`;
}
