import { z } from "zod";

/**
 * Structured output schema enforced on every individual model analysis.
 * Using a rigid schema makes consensus comparison mechanical, not fuzzy.
 */
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
    .min(2)
    .max(5),
  riskFactors: z.array(z.string()).min(1).max(4).describe("What would change the view"),
  missingData: z.array(z.string()).max(4).describe("Data points that would increase confidence"),
});

export type AnalystOutput = z.infer<typeof AnalystOutputSchema>;

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
