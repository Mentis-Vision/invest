import { z } from "zod";

/**
 * Structured output schema enforced on every individual model analysis.
 * Using a rigid schema makes consensus comparison mechanical, not fuzzy.
 */
// Schema constraints kept loose (no minItems > 1) for compatibility with
// Claude's structured output (which only supports 0 or 1), and with Gemini
// (which is strict about multi-item minimums). We enforce 2–5 keySignals
// via prompt guidance + runtime trimming on the consumer side.
export const AnalystOutputSchema = z.object({
  recommendation: z.enum(["BUY", "HOLD", "SELL", "INSUFFICIENT_DATA"]),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  thesis: z.string().describe("1–2 sentence summary of the recommendation rationale"),
  keySignals: z
    .array(
      z.object({
        signal: z.string().describe("A specific observation from the data"),
        datum: z.string().describe("The exact data point cited, verbatim from the DATA block"),
        direction: z.enum(["BULLISH", "BEARISH", "NEUTRAL"]),
      })
    )
    .describe("2–5 key signals. Each signal.datum must quote verbatim from the DATA block."),
  riskFactors: z.array(z.string()).describe("1–4 risks: what would change the view."),
  missingData: z.array(z.string()).describe("Up to 4 data points that would increase confidence"),
});

export type AnalystOutput = z.infer<typeof AnalystOutputSchema>;

/**
 * Quick Scan schema — the cheapest research product. Single Haiku model,
 * ~2-3k tokens. Built for triaging lots of candidates fast, NOT for
 * high-conviction decisions.
 *
 * Intentionally lighter than AnalystOutputSchema:
 *   - 3 signals max (not 2-5) — speed over depth
 *   - No datum citation required — cheap means looser
 *   - 1 riskFactor max, not 1-4 — just the headline concern
 *   - No missingData — out of scope for a quick read
 */
export const QuickScanOutputSchema = z.object({
  recommendation: z.enum(["BUY", "HOLD", "SELL", "INSUFFICIENT_DATA"]),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  oneLiner: z
    .string()
    .describe("One sentence, max 24 words, summarizing the call."),
  signals: z
    .array(z.string())
    .describe("Up to 3 bullet signals driving the call."),
  primaryRisk: z
    .string()
    .describe("One sentence — the single biggest risk to this call."),
});

export type QuickScanOutput = z.infer<typeof QuickScanOutputSchema>;

/**
 * Bull/Bear debate schema — adversarial layer that runs AFTER the lens
 * analysts and BEFORE the supervisor's final synthesis.
 *
 * Architectural inspiration: TradingAgents (Tauric Research) pairs a
 * bull and bear researcher who debate the analyst team's view. We adapt
 * it for our consumer-product positioning:
 *   - One round (not multi-turn) — keeps cost predictable
 *   - Cheap Haiku model (~$0.005-$0.01 per side) — adds total cost ~$0.02
 *     to the Full Panel
 *   - Structured output makes the debate renderable, not just prose
 *   - Each side names ONE condition that would change their mind —
 *     forces intellectual honesty and gives the user a forward-looking
 *     trigger to watch for
 */
export const BullBearSideSchema = z.object({
  side: z.enum(["bull", "bear"]),
  thesis: z
    .string()
    .describe(
      "The strongest 1-2 sentence case for your side. Plain language."
    ),
  reasons: z
    .array(
      z.object({
        point: z.string().describe("One specific claim supporting your side."),
        citation: z
          .string()
          .describe(
            "The data point or analyst observation backing this claim. " +
              "Quote verbatim from analyst outputs or the DATA block."
          ),
      })
    )
    .describe("3 strongest reasons supporting your side."),
  conditionThatWouldChangeMind: z
    .string()
    .describe(
      "One specific, observable condition (price level, fundamental shift, " +
        "macro event) that would weaken your side's case. Forces honesty."
    ),
});

export type BullBearSide = z.infer<typeof BullBearSideSchema>;

/**
 * The supervisor's final synthesis — reviews all 3 model outputs + raw data,
 * flags disagreements, downgrades confidence where needed.
 */
export const SupervisorOutputSchema = z.object({
  finalRecommendation: z.enum(["BUY", "HOLD", "SELL", "INSUFFICIENT_DATA"]),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  consensus: z.enum(["UNANIMOUS", "MAJORITY", "SPLIT", "INSUFFICIENT"]).describe(
    "UNANIMOUS: 3/3 agree. MAJORITY: 2/3 agree. SPLIT: no agreement. INSUFFICIENT: any model returned INSUFFICIENT_DATA."
  ),
  summary: z
    .string()
    .describe("2–3 sentences explaining the final call, in plain language."),
  agreedPoints: z
    .array(z.string())
    .describe("Claims where 2+ models agreed AND are backed by the data block"),
  disagreements: z
    .array(
      z.object({
        topic: z.string(),
        claudeView: z.string(),
        gptView: z.string(),
        geminiView: z.string(),
      })
    )
    .describe("Material disagreements between the models"),
  redFlags: z
    .array(z.string())
    .describe("Any claims any model made that could not be verified against the data block"),
  dataAsOf: z.string().describe("ISO timestamp of the source data"),
});

export type SupervisorOutput = z.infer<typeof SupervisorOutputSchema>;

/**
 * Portfolio-level analysis schema.
 * Focuses on concentration risk, sector balance, macro alignment.
 * Each model fills the same schema from its analytical lens.
 */
export const PortfolioAnalystOutputSchema = z.object({
  overallHealth: z.enum(["STRONG", "BALANCED", "FRAGILE", "AT_RISK"]),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  summary: z.string().describe("2–3 sentences in plain language."),
  concentrationRisks: z
    .array(
      z.object({
        ticker: z.string(),
        percentOfPortfolio: z.number().describe("Approximate percent, 0-100"),
        concern: z.string(),
      })
    )
    .describe("Up to 5 single-position concentrations worth flagging"),
  sectorImbalances: z
    .array(
      z.object({
        sector: z.string(),
        direction: z.enum(["OVERWEIGHT", "UNDERWEIGHT"]),
        observation: z.string(),
      })
    )
    .describe("Up to 5 sector imbalances"),
  macroAlignment: z
    .array(z.string())
    .describe("Up to 5 statements on how the portfolio aligns or mis-aligns with current macro regime"),
  rebalancingSuggestions: z
    .array(
      z.object({
        action: z.enum(["REDUCE", "INCREASE", "REVIEW"]),
        target: z.string(),
        rationale: z.string(),
      })
    )
    .describe("Up to 5 generic directional suggestions. Not investment advice."),
  redFlags: z.array(z.string()).describe("Up to 5 red flags"),
});

export type PortfolioAnalystOutput = z.infer<typeof PortfolioAnalystOutputSchema>;

export const PortfolioSupervisorOutputSchema = z.object({
  overallHealth: z.enum(["STRONG", "BALANCED", "FRAGILE", "AT_RISK"]),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  consensus: z.enum(["UNANIMOUS", "MAJORITY", "SPLIT", "INSUFFICIENT"]),
  summary: z.string(),
  agreedPoints: z.array(z.string()),
  disagreements: z.array(
    z.object({
      topic: z.string(),
      claudeView: z.string(),
      gptView: z.string(),
      geminiView: z.string(),
    })
  ),
  redFlags: z.array(z.string()),
  topActions: z
    .array(
      z.object({
        priority: z.enum(["HIGH", "MEDIUM", "LOW"]),
        action: z.string(),
        rationale: z.string(),
      })
    )
    .describe("Up to 5 top actions, highest priority first"),
  dataAsOf: z.string(),
});

export type PortfolioSupervisorOutput = z.infer<typeof PortfolioSupervisorOutputSchema>;
