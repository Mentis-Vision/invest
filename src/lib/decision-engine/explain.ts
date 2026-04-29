import type { DecisionEngineOutput } from "./types";
import { formatDecisionAction } from "./utils";

export function buildDecisionExplanation(output: DecisionEngineOutput): {
  headline: string;
  summary: string;
  reasons: string[];
  risks: string[];
  nextReviewTriggers: string[];
  disclosure: string;
} {
  const actionLabel = formatDecisionAction(output.action);
  const headline = `${output.ticker}: ${actionLabel} risk overlay`;
  const riskGateCount = output.riskGates.filter((g) => g.triggered).length;
  const summary =
    `${output.ticker} has a Trade Quality Score of ${output.tradeQualityScore}/100. ` +
    `The risk overlay action is ${actionLabel} with ${output.confidence.toLowerCase()} confidence ` +
    `and ${output.riskLevel.toLowerCase()} risk. ` +
    (riskGateCount > 0
      ? `${riskGateCount} risk gate${riskGateCount === 1 ? "" : "s"} require review.`
      : "No blocking risk gates were triggered.");

  return {
    headline,
    summary,
    reasons: output.reasons,
    risks: output.risks,
    nextReviewTriggers: output.whatWouldChangeThisView,
    disclosure:
      "Informational only. Not investment advice or an instruction to trade.",
  };
}
