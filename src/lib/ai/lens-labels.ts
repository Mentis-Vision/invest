/**
 * UI-facing labels for the three analyst lenses.
 *
 * Internally we key by model brand (claude / gpt / gemini) because the
 * SDK invocations need real model IDs. But users should never see brand
 * names in the product — a research platform that brags about which LLMs
 * it uses is a platform whose brand IS the LLMs. Ours isn't.
 *
 * Users see the INVESTMENT LENS each analyst applies: value / growth /
 * macro. The model choice becomes an implementation detail.
 *
 * Edge cases:
 * - "claude-haiku" → "Quick read" (internal — Quick Scan product uses it)
 * - unknown keys → the raw key is returned so nothing crashes mid-render
 */

export type ModelKey = "claude" | "gpt" | "gemini" | "claude-haiku" | string;

export const LENS_LABELS: Record<string, string> = {
  claude: "Value",
  gpt: "Growth",
  gemini: "Macro",
  "claude-haiku": "Quick",
  haikuSupervisor: "Supervisor",
  "panel-consensus": "Consensus",
};

export const LENS_DESCRIPTIONS: Record<string, string> = {
  claude: "Graham-Dodd value discipline",
  gpt: "Growth + TAM + compounding",
  gemini: "Macro regime + contrarian stress-test",
  "claude-haiku": "Fast triage read",
  haikuSupervisor: "Cross-verification + synthesis",
  "panel-consensus": "Cross-verified panel agreement",
};

export function lensLabel(modelKey: string | undefined): string {
  if (!modelKey) return "Analyst";
  return LENS_LABELS[modelKey] ?? modelKey.toUpperCase();
}

export function lensDescription(modelKey: string | undefined): string {
  if (!modelKey) return "";
  return LENS_DESCRIPTIONS[modelKey] ?? "";
}
