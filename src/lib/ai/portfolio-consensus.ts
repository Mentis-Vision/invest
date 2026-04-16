import { generateObject } from "ai";
import { models } from "./models";
import {
  PortfolioAnalystOutputSchema,
  PortfolioSupervisorOutputSchema,
  type PortfolioAnalystOutput,
  type PortfolioSupervisorOutput,
} from "./schemas";
import { log, errorInfo } from "../log";

const ZERO_HALLUCINATION = `ABSOLUTE RULES:
1. You may ONLY reference positions, percentages, and macro data present in the DATA block.
2. If a position has no sector tag, say so — do not guess the sector.
3. Bias toward "BALANCED" / "REVIEW" when signals are mixed.
4. Do NOT recommend specific transactions (buy 100 shares of X). Suggest directions only.
5. You are NOT a licensed advisor. Your output is informational.`;

const PORTFOLIO_PERSONAS: Record<"claude" | "gpt" | "gemini", string> = {
  claude: `You are a disciplined value investor reviewing a personal portfolio.
Flag: overconcentrations, positions with weak margin of safety, ballast vs speculation mix.
Favor: durable dividend payers, quality balance sheets, underowned value.`,
  gpt: `You are a growth-focused portfolio reviewer.
Flag: stale positions with no secular tailwind, missing exposure to structural growth.
Favor: compounders with reinvestment runway, positions benefiting from operating leverage.`,
  gemini: `You are a macro-aware portfolio reviewer.
Flag: crowded factor exposures, rate-sensitivity mismatches, currency and geography concentration.
Favor: portfolio-level resilience to regime shifts; stress-test each bucket.`,
};

const SUPERVISOR_PROMPT = `You are the supervisor synthesizing a portfolio review from three analyst lenses (value, growth, macro). Rules:

1. Identify where lenses agree and where they diverge.
2. Downgrade confidence when disagreement is material.
3. topActions must be directional (REDUCE / INCREASE / REVIEW), never specific trade instructions.
4. Never invent positions, percentages, or sectors not in the DATA block.
5. Treat the disclaimer as always-on: this is informational, not advice.`;

export type PortfolioAnalystResult = {
  model: "claude" | "gpt" | "gemini";
  status: "ok" | "failed";
  output?: PortfolioAnalystOutput;
  error?: string;
  tokensUsed?: number;
};

export async function runPortfolioPanel(
  dataBlock: string
): Promise<PortfolioAnalystResult[]> {
  const userMessage = `Review this portfolio using ONLY the data below.\n\n--- DATA ---\n${dataBlock}\n--- END DATA ---`;

  const jobs = (["claude", "gpt", "gemini"] as const).map(async (key) => {
    try {
      const result = await generateObject({
        model: models[key],
        schema: PortfolioAnalystOutputSchema,
        system: `${PORTFOLIO_PERSONAS[key]}\n\n${ZERO_HALLUCINATION}`,
        prompt: userMessage,
      });
      const tokens =
        result.usage?.totalTokens ??
        (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0);
      return {
        model: key,
        status: "ok" as const,
        output: result.object,
        tokensUsed: tokens,
      };
    } catch (err) {
      log.error("portfolio.analyst", "model failed", {
        model: key,
        ...errorInfo(err),
      });
      return {
        model: key,
        status: "failed" as const,
        error: err instanceof Error ? err.message : "unknown",
      };
    }
  });

  return Promise.all(jobs);
}

export type PortfolioSupervisorResult = {
  output: PortfolioSupervisorOutput;
  supervisorModel: string;
  pricingKey: string;
  tokensUsed: number;
};

export async function runPortfolioSupervisor(
  dataBlock: string,
  analyses: PortfolioAnalystResult[],
  dataAsOf: string
): Promise<PortfolioSupervisorResult> {
  const successful = analyses.filter((a) => a.status === "ok" && a.output);
  if (successful.length === 0) {
    return {
      output: {
        overallHealth: "FRAGILE",
        confidence: "LOW",
        consensus: "INSUFFICIENT",
        summary:
          "All three portfolio reviewers failed to return analysis. Try again or check back.",
        agreedPoints: [],
        disagreements: [],
        redFlags: analyses.map((a) => `${a.model}: ${a.error}`),
        topActions: [],
        dataAsOf,
      },
      supervisorModel: "none",
      pricingKey: "haiku",
      tokensUsed: 0,
    };
  }

  const text = analyses
    .map((a) => {
      if (a.status !== "ok" || !a.output) {
        return `[${a.model.toUpperCase()}] FAILED`;
      }
      const o = a.output;
      return [
        `[${a.model.toUpperCase()}] health=${o.overallHealth} conf=${o.confidence}`,
        `Summary: ${o.summary}`,
        `Concentration: ${o.concentrationRisks.map((c) => `${c.ticker} ${c.percentOfPortfolio}%`).join(", ") || "none"}`,
        `Sectors: ${o.sectorImbalances.map((s) => `${s.sector}:${s.direction}`).join(", ") || "none"}`,
        `Actions: ${o.rebalancingSuggestions.map((r) => `${r.action}:${r.target}`).join("; ") || "none"}`,
      ].join("\n");
    })
    .join("\n\n");

  try {
    const result = await generateObject({
      model: models.haikuSupervisor,
      schema: PortfolioSupervisorOutputSchema,
      system: SUPERVISOR_PROMPT,
      prompt: `--- DATA ---\n${dataBlock}\n--- END DATA ---\n\n--- ANALYST OUTPUTS ---\n${text}\n--- END ---\n\nSynthesize. dataAsOf must be: ${dataAsOf}`,
    });
    const tokens =
      result.usage?.totalTokens ??
      (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0);
    return {
      output: result.object,
      supervisorModel: "Claude Haiku",
      pricingKey: "haiku",
      tokensUsed: tokens,
    };
  } catch (err) {
    log.error("portfolio.supervisor", "failed", errorInfo(err));
    return {
      output: {
        overallHealth: "FRAGILE",
        confidence: "LOW",
        consensus: "SPLIT",
        summary:
          "Supervisor synthesis failed. Treat individual analyst outputs as informational only.",
        agreedPoints: [],
        disagreements: [],
        redFlags: ["supervisor call failed"],
        topActions: [],
        dataAsOf,
      },
      supervisorModel: "Claude Haiku (failed)",
      pricingKey: "haiku",
      tokensUsed: 0,
    };
  }
}
