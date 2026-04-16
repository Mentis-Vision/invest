import { generateObject } from "ai";
import { models } from "./models";
import {
  AnalystOutputSchema,
  SupervisorOutputSchema,
  type AnalystOutput,
  type SupervisorOutput,
} from "./schemas";

const ANALYST_PROMPT = `You are a disciplined financial analyst. ZERO TOLERANCE for hallucination.

ABSOLUTE RULES:
1. You may ONLY cite numbers and facts explicitly present in the DATA block.
2. If a data point is "N/A" or missing, say so in missingData — do not invent, estimate, or round from memory.
3. Bias toward HOLD when evidence is ambiguous. Cautious calls beat confident wrong ones.
4. In keySignals.datum, quote the exact value from the DATA block verbatim (e.g., "P/E (Trailing): 28.5").

You are NOT a licensed advisor. Your output is informational.`;

const SUPERVISOR_PROMPT = `You are the supervisor. Three independent analysts just reviewed the same DATA block. Your job:

1. Compare their conclusions. Flag real disagreements (BUY vs SELL is real; thesis wording is not).
2. Verify their claims. If any analyst cites a fact NOT in the DATA block, flag it in redFlags.
3. Downgrade confidence if analysts disagreed, if any claimed unverified facts, or if the data is sparse.
4. Produce the final recommendation using this logic:
   - UNANIMOUS (3/3) → keep their confidence
   - MAJORITY (2/3) → downgrade one level (HIGH→MEDIUM, MEDIUM→LOW)
   - SPLIT (no agreement) → recommendation: HOLD, confidence: LOW
   - Any INSUFFICIENT_DATA → recommendation: INSUFFICIENT_DATA, confidence: LOW
5. Write the summary in plain language. A 60-year-old investor should understand it immediately.
6. Do NOT introduce new facts. Your job is to synthesize, not analyze.`;

export type ModelResult = {
  model: "claude" | "gpt" | "gemini";
  status: "ok" | "failed";
  output?: AnalystOutput;
  error?: string;
};

export async function runAnalystPanel(
  ticker: string,
  dataBlock: string
): Promise<ModelResult[]> {
  const userMessage = `Analyze ${ticker} using ONLY the data below.\n\n--- DATA (verified source) ---\n${dataBlock}\n--- END DATA ---`;

  const jobs: Array<Promise<ModelResult>> = (
    ["claude", "gpt", "gemini"] as const
  ).map(async (key) => {
    try {
      const { object } = await generateObject({
        model: models[key],
        schema: AnalystOutputSchema,
        system: ANALYST_PROMPT,
        prompt: userMessage,
      });
      return { model: key, status: "ok" as const, output: object };
    } catch (err) {
      return {
        model: key,
        status: "failed" as const,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  });

  return Promise.all(jobs);
}

export async function runSupervisor(
  ticker: string,
  dataBlock: string,
  analyses: ModelResult[],
  dataAsOf: string
): Promise<SupervisorOutput> {
  const successful = analyses.filter((a) => a.status === "ok" && a.output);

  if (successful.length === 0) {
    return {
      finalRecommendation: "INSUFFICIENT_DATA",
      confidence: "LOW",
      consensus: "INSUFFICIENT",
      summary: "All three analyst models failed to return a usable analysis. Cannot produce a recommendation.",
      agreedPoints: [],
      disagreements: [],
      redFlags: analyses.map((a) => `${a.model}: ${a.error ?? "no output"}`),
      dataAsOf,
    };
  }

  const analysesText = analyses
    .map((a) => {
      if (a.status !== "ok" || !a.output) {
        return `[${a.model.toUpperCase()}] FAILED: ${a.error}`;
      }
      const o = a.output;
      return [
        `[${a.model.toUpperCase()}]`,
        `Recommendation: ${o.recommendation} (confidence: ${o.confidence})`,
        `Thesis: ${o.thesis}`,
        `Key signals:`,
        ...o.keySignals.map(
          (s) => `  - [${s.direction}] ${s.signal} (cited: ${s.datum})`
        ),
        `Risks: ${o.riskFactors.join("; ")}`,
      ].join("\n");
    })
    .join("\n\n");

  const { object } = await generateObject({
    model: models.claude,
    schema: SupervisorOutputSchema,
    system: SUPERVISOR_PROMPT,
    prompt: `Ticker: ${ticker}\n\n--- VERIFIED DATA ---\n${dataBlock}\n--- END DATA ---\n\n--- ANALYST PANEL OUTPUTS ---\n${analysesText}\n--- END OUTPUTS ---\n\nProduce the supervisor review. The dataAsOf field must be: ${dataAsOf}`,
  });

  return object;
}
