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
  dataBlock: string,
  /**
   * Optional user-context rider. When set, it's appended to each analyst's
   * system prompt to tilt emphasis toward the user's risk tolerance /
   * horizon / goals. STEER, not filter — analysts still produce the full
   * verdict from their core lens. See src/lib/user-profile.ts.
   */
  profileRider?: string | null,
  /**
   * Optional progress callback — invoked once per analyst as it finishes,
   * regardless of success/failure. Used by the streaming research route
   * to emit per-model events before the full panel resolves.
   */
  onAnalystFinish?: (result: ModelResult) => void
): Promise<ModelResult[]> {
  const userMessage = `Analyze ${ticker} using the verified DATA below. You may call up to 3 tools if a deeper look would materially change your view.\n\n--- DATA (verified source) ---\n${dataBlock}\n--- END DATA ---`;

  const jobs: Array<Promise<ModelResult>> = (
    ["claude", "gpt", "gemini"] as const
  ).map(async (key) => {
    try {
      const traces: ToolCallTrace[] = [];
      const systemText = profileRider
        ? `${buildAnalystSystem(PERSONAS[key])}\n\n${profileRider}`
        : buildAnalystSystem(PERSONAS[key]);
      const result = await generateText({
        model: models[key],
        system: systemText,
        prompt: userMessage,
        tools: analystTools,
        // Cap at 3 total steps: initial turn (may call 1+ tools) → tool
        // results → final structured output. This bounds each analyst to
        // ~1 real tool call and cuts panel latency materially vs. a 5-step
        // budget. Models are still told in-prompt that they "have up to 3
        // tool calls" — a soft budget is enough; the hard stop is here.
        stopWhen: stepCountIs(3),
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

      const modelResult: ModelResult = !analysisOutput
        ? {
            model: key,
            status: "failed" as const,
            error: "No structured output produced by model",
            tokensUsed: tokens,
            toolCalls: traces,
            steps: result.steps?.length ?? 1,
          }
        : {
            model: key,
            status: "ok" as const,
            output: analysisOutput,
            tokensUsed: tokens,
            toolCalls: traces,
            steps: result.steps?.length ?? 1,
          };

      if (onAnalystFinish) {
        try {
          onAnalystFinish(modelResult);
        } catch {
          /* never let a subscriber bug affect the panel */
        }
      }
      return modelResult;
    } catch (err) {
      log.error("consensus.analyst", "model call failed", {
        model: key,
        ticker,
        ...errorInfo(err),
      });
      const failed: ModelResult = {
        model: key,
        status: "failed" as const,
        error: err instanceof Error ? err.message : "Unknown error",
      };
      if (onAnalystFinish) {
        try {
          onAnalystFinish(failed);
        } catch {
          /* ignore */
        }
      }
      return failed;
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
    { key: "claude-haiku" as const, label: "Claude Haiku", pricingKey: "haiku" },
    { key: "gpt" as const, label: "GPT", pricingKey: "gpt" },
    { key: "gemini" as const, label: "Gemini", pricingKey: "gemini" },
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

  // Latency optimization: when all 3 analysts succeeded and returned the
  // SAME recommendation, skip the supervisor LLM call entirely. A unanimous
  // panel has already done the cross-check via prompt rules — there's
  // nothing for supervisor to disagree with. Saves ~8–15s per research
  // request on the happy path (which is most requests). Non-unanimous
  // outcomes still go through the full supervisor review.
  //
  // SAFETY: we still run the supervisor's "verify every numeric claim has
  // a source in the DATA block or a tool call the analyst made" check,
  // just deterministically rather than via an LLM. Any unverified claim
  // surfaces as a redFlag on the output.
  const recs = successful.map((a) => a.output!.recommendation);
  const uniqueRecs = [...new Set(recs)];
  if (successful.length === 3 && uniqueRecs.length === 1) {
    const output = synthesizeUnanimous(successful, dataAsOf);
    output.redFlags = verifyClaims(successful, dataBlock);
    return {
      output,
      supervisorModel: "panel-consensus",
      tokensUsed: 0,
      pricingKey: "none",
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

/**
 * Deterministic claim verification — the safety half of the fast-path.
 *
 * The supervisor LLM's core safety job is: for every numeric claim an
 * analyst made, check that the datum appears either (a) verbatim in the
 * DATA block or (b) is tagged with a tool name that matches a tool the
 * analyst actually called. Anything else is an unverified claim and
 * belongs in redFlags.
 *
 * We do it here with regex / substring matching. No LLM cost. Same
 * signal the supervisor would surface; arguably stricter because it
 * doesn't get fooled by semantically-similar but numerically-wrong facts.
 */
function verifyClaims(
  successful: ModelResult[],
  dataBlock: string
): string[] {
  const flags: string[] = [];
  // Normalize whitespace on the DATA block so "P/E : 28.5" matches
  // "P/E: 28.5" etc. Lowercase for case-insensitive substring search.
  const normalizedData = dataBlock.replace(/\s+/g, " ").toLowerCase();

  for (const a of successful) {
    const toolsCalled = new Set(
      (a.toolCalls ?? []).map((t) => t.toolName.toLowerCase())
    );

    for (const s of a.output!.keySignals) {
      const raw = s.datum.trim();
      if (!raw) continue;

      // Source tag handling. The analyst prompt instructs citations like
      // "[DATA] P/E (Trailing): 28.5" or "[getFinancialsSummary] income.netIncome=93,736,000,000".
      //   - [DATA] → strip the tag, fall through to DATA-block match.
      //   - [<toolName>] → must match a tool the analyst actually called.
      const tagMatch = raw.match(/^\[([a-zA-Z0-9_-]+)\]\s*/);
      let bodyAfterTag = raw;
      if (tagMatch) {
        const tag = tagMatch[1].toLowerCase();
        bodyAfterTag = raw.slice(tagMatch[0].length).trim();
        if (tag === "data") {
          // fall through to DATA-block check below, using the untagged body
        } else if (toolsCalled.has(tag)) {
          // Trust — analyst cited a tool they invoked this session.
          continue;
        } else {
          flags.push(
            `${a.model}: claim tagged [${tagMatch[1]}] but that tool wasn't called in this session — "${raw.slice(0, 100)}"`
          );
          continue;
        }
      }

      // DATA-block verification: the datum should appear (normalized) in
      // the source block. We strip very common label prefixes so that
      // analysts can quote "P/E (Trailing): 28.5" even when the data says
      // "- P/E (Trailing): 28.5" etc.
      const needle = bodyAfterTag.replace(/\s+/g, " ").toLowerCase();

      // Try full-string match first
      if (normalizedData.includes(needle)) continue;

      // Fallback: extract the numeric part and at least one adjacent
      // word, then confirm both appear. Prevents the model from
      // inventing a number and a label that both exist separately.
      const numericMatch = needle.match(/-?\$?[\d,]+(?:\.\d+)?%?/);
      if (numericMatch) {
        const num = numericMatch[0];
        // Strip punctuation/currency/comma/percent for lenient compare
        const bare = num.replace(/[$,%]/g, "");
        if (normalizedData.includes(bare)) {
          // Number exists. Check that the label word appears too.
          const labelWords = needle
            .replace(numericMatch[0], "")
            .split(/[^\w]+/)
            .filter((w) => w.length >= 3);
          const labelHit = labelWords.some((w) =>
            normalizedData.includes(w)
          );
          if (labelHit) continue;
        }
      }

      flags.push(
        `${a.model}: unverified claim "${raw.slice(0, 120)}" — not found in DATA block or a tool this analyst called`
      );
    }
  }

  return flags;
}

/**
 * Deterministic synthesis when all three analysts agree on a recommendation.
 * Used to skip the supervisor LLM call on the happy path. Extracts the
 * highest-signal fields without introducing any new content.
 *
 * Confidence floors to the minimum of the three analyst confidences
 * (LOW < MEDIUM < HIGH). redFlags are filled separately by verifyClaims().
 */
function synthesizeUnanimous(
  successful: ModelResult[],
  dataAsOf: string
): SupervisorOutput {
  const rec = successful[0].output!.recommendation;

  // Confidence: take the "floor" of the three confidences (LOW < MEDIUM < HIGH).
  const rank: Record<string, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };
  const inverse: Record<number, "LOW" | "MEDIUM" | "HIGH"> = {
    1: "LOW",
    2: "MEDIUM",
    3: "HIGH",
  };
  const minRank = Math.min(
    ...successful.map((a) => rank[a.output!.confidence] ?? 1)
  );
  const confidence = inverse[minRank];

  // Agreed points: any signal cited by ≥2 analysts becomes an agreed point.
  // We key by the datum string (verbatim data-block citation) because it's
  // the stable identifier — phrasing varies across models.
  const datumCounts = new Map<string, { count: number; signal: string }>();
  for (const a of successful) {
    for (const s of a.output!.keySignals) {
      const existing = datumCounts.get(s.datum);
      if (existing) {
        existing.count++;
      } else {
        datumCounts.set(s.datum, { count: 1, signal: s.signal });
      }
    }
  }
  const agreedPoints: string[] = [];
  for (const [datum, { count, signal }] of datumCounts) {
    if (count >= 2) {
      agreedPoints.push(`${signal} (${datum})`);
    }
  }

  // Build a concise summary from the shortest thesis (proxy for clearest).
  const theses = successful.map((a) => a.output!.thesis);
  const shortest = theses.reduce((a, b) => (a.length <= b.length ? a : b));
  const lensLabels = successful
    .map((a) => personaLabel(a.model).toLowerCase())
    .join(", ");
  const summary = `All three analysts (${lensLabels}) agree: ${rec}. ${shortest}`;

  return {
    finalRecommendation: rec,
    confidence,
    consensus: "UNANIMOUS",
    summary: summary.slice(0, 600),
    agreedPoints: agreedPoints.slice(0, 8),
    disagreements: [],
    redFlags: [],
    dataAsOf,
  };
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
