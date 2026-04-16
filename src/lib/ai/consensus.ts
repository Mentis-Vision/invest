import { generateText, generateObject, stepCountIs, Output } from "ai";
import { models } from "./models";
import {
  AnalystOutputSchema,
  SupervisorOutputSchema,
  type AnalystOutput,
  type SupervisorOutput,
} from "./schemas";
import { analystTools } from "./tools";
import { log, errorInfo } from "../log";

/**
 * Shared across all three analysts. Never change per-model.
 * Only the PERSONA preamble differs.
 */
const ZERO_HALLUCINATION_RULES = `ABSOLUTE RULES (non-negotiable):
1. You may ONLY cite numbers and facts from (a) the DATA block or (b) the structured output of a tool call you made this session. Do not invent or round from memory.
2. If a data point is missing, say so in missingData — then decide whether a single tool call would close the gap. Never speculate.
3. Bias toward HOLD when evidence is ambiguous. Cautious calls beat confident wrong ones.
4. In keySignals.datum, quote the exact value verbatim, and include its source tag: "[DATA] P/E (Trailing): 28.5" or "[getFinancialsSummary] income.netIncome=93,736,000,000".
5. You have up to 3 tool calls. Use them only when they will materially change your view. If the DATA block already contains what you need, DO NOT call tools.
6. Never cite news tone or sentiment as a numeric claim. News is qualitative context only.

You are NOT a licensed advisor. Your output is informational only.`;

/**
 * P3.1 — Distinct analytical lens per model.
 * Keeps the zero-hallucination rules identical so disagreement signals
 * analytical difference, not prompt drift.
 */
const PERSONAS: Record<"claude" | "gpt" | "gemini", string> = {
  claude: `You are a disciplined value investor in the Graham-Dodd tradition.
Prioritize: margin of safety, valuation relative to intrinsic value, durable cash flow, balance-sheet strength.
De-prioritize: near-term momentum, narrative-driven pricing, consensus estimates.
Be skeptical of premium multiples without commensurate return on capital.
Prefer calling getFinancialsSummary over anything else when deciding if the business is a good business at this price.`,

  gpt: `You are a growth-focused analyst.
Prioritize: revenue trajectory, TAM expansion, competitive moats, reinvestment quality, operating leverage.
De-prioritize: near-term valuation optics when the compounding case is intact.
Be skeptical of value traps where the business is structurally shrinking.
Prefer calling getFinancialsSummary (for trend) or getFilingText on the latest 10-K (for business segments / MD&A).`,

  gemini: `You are a macro-aware contrarian.
Prioritize: regime risk (rates, liquidity, dollar, geopolitical), crowded positioning, downside scenarios, correlation breakdowns.
De-prioritize: bottom-up narratives in macro-dominated regimes.
Assume consensus is mispriced and stress-test each bullish claim.
Prefer calling getFredSeriesHistory for the 12–24 month rates/inflation trajectory before committing to a view.`,
};

function buildAnalystSystem(persona: string): string {
  return `${persona}\n\n${ZERO_HALLUCINATION_RULES}`;
}

const SUPERVISOR_PROMPT = `You are the supervisor. Three independent analysts reviewed the same DATA block plus any tool calls they chose to make. Your job:

1. Compare their conclusions. Flag real disagreements (BUY vs SELL is real; thesis wording is not).
2. Verify every numeric claim in each analyst's keySignals. The claim must either (a) appear verbatim in the DATA block you will see, or (b) be tagged with a tool source like [getFinancialsSummary] that the analyst actually produced.
3. If an analyst makes a numeric claim that is NOT in the DATA block and is NOT tagged with a tool source the analyst actually used, flag it in redFlags with the analyst name and claim.
4. Downgrade confidence if analysts disagreed, if any claimed unverified facts, or if the data is sparse.
5. Produce the final recommendation using this logic:
   - UNANIMOUS (3/3) → keep their confidence
   - MAJORITY (2/3) → downgrade one level (HIGH→MEDIUM, MEDIUM→LOW)
   - SPLIT (no agreement) → recommendation: HOLD, confidence: LOW
   - Any INSUFFICIENT_DATA → recommendation: INSUFFICIENT_DATA, confidence: LOW
6. Write the summary in plain language. A 60-year-old investor should understand it immediately.
7. Do NOT introduce new facts. Your job is to synthesize, not analyze.
8. Disagreement between lenses is NORMAL and informative — surface it, don't paper over it.`;

export type ToolCallTrace = {
  toolName: string;
  input: unknown;
  outputSummary: string;
};

export type ModelResult = {
  model: "claude" | "gpt" | "gemini";
  status: "ok" | "failed";
  output?: AnalystOutput;
  error?: string;
  tokensUsed?: number;
  toolCalls?: ToolCallTrace[];
  steps?: number;
};

/**
 * Summarize a tool output into a short string for downstream logging /
 * supervisor review. Avoids flooding logs with full filing text.
 */
function summarizeToolOutput(output: unknown): string {
  if (!output) return "(empty)";
  if (typeof output === "string")
    return output.length > 200 ? output.slice(0, 200) + "…" : output;
  if (typeof output === "object") {
    const keys = Object.keys(output as Record<string, unknown>);
    const preview = keys.slice(0, 5).join(", ");
    try {
      const json = JSON.stringify(output).slice(0, 300);
      return `{${preview}} ${json.length >= 300 ? "…" : ""}`;
    } catch {
      return `{${preview}}`;
    }
  }
  return String(output);
}

export async function runAnalystPanel(
  ticker: string,
  dataBlock: string
): Promise<ModelResult[]> {
  const userMessage = `Analyze ${ticker} using the verified DATA below. You may call up to 3 tools if a deeper look would materially change your view.\n\n--- DATA (verified source) ---\n${dataBlock}\n--- END DATA ---`;

  const jobs: Array<Promise<ModelResult>> = (
    ["claude", "gpt", "gemini"] as const
  ).map(async (key) => {
    try {
      const traces: ToolCallTrace[] = [];
      const result = await generateText({
        model: models[key],
        system: buildAnalystSystem(PERSONAS[key]),
        prompt: userMessage,
        tools: analystTools,
        // stopWhen: stop after 5 steps total (each step = model turn + optional tools)
        // so we cap at roughly 3 tool calls + final structured output.
        stopWhen: stepCountIs(5),
        experimental_output: Output.object({ schema: AnalystOutputSchema }),
        onStepFinish: ({ toolCalls, toolResults }) => {
          for (let i = 0; i < toolCalls.length; i++) {
            const call = toolCalls[i];
            const resp = toolResults[i];
            traces.push({
              toolName: call.toolName,
              input: call.input,
              outputSummary: summarizeToolOutput(resp?.output),
            });
          }
        },
      });

      const analysisOutput = result.experimental_output as AnalystOutput | undefined;
      const tokens =
        result.usage?.totalTokens ??
        (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0);

      if (!analysisOutput) {
        return {
          model: key,
          status: "failed" as const,
          error: "No structured output produced by model",
          tokensUsed: tokens,
          toolCalls: traces,
          steps: result.steps?.length ?? 1,
        };
      }

      return {
        model: key,
        status: "ok" as const,
        output: analysisOutput,
        tokensUsed: tokens,
        toolCalls: traces,
        steps: result.steps?.length ?? 1,
      };
    } catch (err) {
      log.error("consensus.analyst", "model call failed", {
        model: key,
        ticker,
        ...errorInfo(err),
      });
      return {
        model: key,
        status: "failed" as const,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  });

  return Promise.all(jobs);
}

/**
 * P3.2 — Supervisor rotation by day-of-year across Haiku / GPT / Gemini.
 * Deterministic by day so within a single session everyone sees the same
 * supervisor.
 */
function pickSupervisor(): {
  key: "claude-haiku" | "gpt" | "gemini";
  label: string;
  pricingKey: string;
} {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 0);
  const diff = now.getTime() - startOfYear.getTime();
  const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));

  const options = [
    { key: "claude-haiku" as const, label: "Claude Haiku 4.5", pricingKey: "haiku" },
    { key: "gpt" as const, label: "GPT-5.2", pricingKey: "gpt" },
    { key: "gemini" as const, label: "Gemini 2.5 Pro", pricingKey: "gemini" },
  ];
  return options[dayOfYear % options.length];
}

export type SupervisorResult = {
  output: SupervisorOutput;
  supervisorModel: string;
  tokensUsed: number;
  pricingKey: string;
};

export async function runSupervisor(
  ticker: string,
  dataBlock: string,
  analyses: ModelResult[],
  dataAsOf: string
): Promise<SupervisorResult> {
  const successful = analyses.filter((a) => a.status === "ok" && a.output);
  const picked = pickSupervisor();

  if (successful.length === 0) {
    const output: SupervisorOutput = {
      finalRecommendation: "INSUFFICIENT_DATA",
      confidence: "LOW",
      consensus: "INSUFFICIENT",
      summary:
        "All three analyst models failed to return a usable analysis. Cannot produce a recommendation.",
      agreedPoints: [],
      disagreements: [],
      redFlags: analyses.map((a) => `${a.model}: ${a.error ?? "no output"}`),
      dataAsOf,
    };
    return {
      output,
      supervisorModel: picked.label,
      tokensUsed: 0,
      pricingKey: picked.pricingKey,
    };
  }

  const analysesText = analyses
    .map((a) => {
      if (a.status !== "ok" || !a.output) {
        return `[${a.model.toUpperCase()}] FAILED: ${a.error}`;
      }
      const o = a.output;
      const toolsUsed = (a.toolCalls ?? [])
        .map((t) => `  - ${t.toolName}(${JSON.stringify(t.input)}) → ${t.outputSummary}`)
        .join("\n");
      return [
        `[${a.model.toUpperCase()} — ${personaLabel(a.model)}]`,
        `Tools called (${a.toolCalls?.length ?? 0}):${toolsUsed ? "\n" + toolsUsed : " (none)"}`,
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

  const supervisorModel =
    models[picked.key === "claude-haiku" ? "haikuSupervisor" : picked.key];

  try {
    const result = await generateObject({
      model: supervisorModel,
      schema: SupervisorOutputSchema,
      system: SUPERVISOR_PROMPT,
      prompt: `Ticker: ${ticker}\n\n--- VERIFIED DATA ---\n${dataBlock}\n--- END DATA ---\n\n--- ANALYST PANEL OUTPUTS ---\n${analysesText}\n--- END OUTPUTS ---\n\nProduce the supervisor review. The dataAsOf field must be: ${dataAsOf}`,
    });
    const tokens =
      result.usage?.totalTokens ??
      (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0);
    return {
      output: result.object,
      supervisorModel: picked.label,
      tokensUsed: tokens,
      pricingKey: picked.pricingKey,
    };
  } catch (err) {
    log.error("consensus.supervisor", "supervisor call failed", {
      ticker,
      supervisor: picked.label,
      ...errorInfo(err),
    });
    const output = fallbackSynthesis(successful, analyses, dataAsOf);
    return {
      output,
      supervisorModel: `${picked.label} (fallback)`,
      tokensUsed: 0,
      pricingKey: picked.pricingKey,
    };
  }
}

function personaLabel(model: string): string {
  switch (model) {
    case "claude":
      return "Value";
    case "gpt":
      return "Growth";
    case "gemini":
      return "Macro";
    default:
      return model;
  }
}

function fallbackSynthesis(
  successful: ModelResult[],
  all: ModelResult[],
  dataAsOf: string
): SupervisorOutput {
  const recs = successful.map((a) => a.output!.recommendation);
  const unique = [...new Set(recs)];
  const tally: Record<string, number> = {};
  for (const r of recs) tally[r] = (tally[r] ?? 0) + 1;
  const majority = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];

  let consensus: SupervisorOutput["consensus"];
  let finalRec: SupervisorOutput["finalRecommendation"];
  let confidence: SupervisorOutput["confidence"];
  if (unique.length === 1 && successful.length === 3) {
    consensus = "UNANIMOUS";
    finalRec = unique[0] as SupervisorOutput["finalRecommendation"];
    confidence = "MEDIUM";
  } else if (majority[1] >= 2) {
    consensus = "MAJORITY";
    finalRec = majority[0] as SupervisorOutput["finalRecommendation"];
    confidence = "LOW";
  } else {
    consensus = "SPLIT";
    finalRec = "HOLD";
    confidence = "LOW";
  }

  return {
    finalRecommendation: finalRec,
    confidence,
    consensus,
    summary:
      "Supervisor review unavailable. This verdict is a mechanical tally of the analyst panel — treat it as a conservative placeholder, not a synthesis.",
    agreedPoints: [],
    disagreements: [],
    redFlags: [
      "Supervisor call failed; the cross-verification step did not run.",
      ...all.filter((a) => a.status === "failed").map((a) => `${a.model}: ${a.error}`),
    ],
    dataAsOf,
  };
}
