import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { createVertex } from "@ai-sdk/google-vertex";
import type { LanguageModel } from "ai";

/**
 * Centralized model registry for ClearPath.
 * Models are lazy-initialized (getters) so build-time page collection
 * doesn't fail when env vars aren't yet loaded.
 */
let _vertex: ReturnType<typeof createVertex> | null = null;
function getVertex() {
  if (!_vertex) {
    _vertex = createVertex({
      apiKey: process.env.GOOGLE_VERTEX_API_KEY ?? process.env.VERTEX_SERVICE_KEY,
      project: process.env.GOOGLE_VERTEX_PROJECT,
      location: process.env.GOOGLE_VERTEX_LOCATION ?? "us-central1",
    });
  }
  return _vertex;
}

/**
 * Model map. Analyst models are the headline three. `haikuSupervisor`
 * is used by the supervisor rotation to avoid same-family bias on
 * Claude-authored analyses.
 */
// Model IDs. Fallback IDs are tried if the primary fails — Anthropic and
// Google periodically rotate model aliases; a hard fail on `Not Found` should
// not take the whole panel down.
const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
const CLAUDE_HAIKU_MODEL = process.env.ANTHROPIC_HAIKU_MODEL ?? "claude-haiku-4-5-20251001";
const GPT_MODEL = process.env.OPENAI_MODEL ?? "gpt-5.2";
const GEMINI_MODEL = process.env.GOOGLE_VERTEX_MODEL ?? "gemini-2.5-pro";

export const models: {
  claude: LanguageModel;
  gpt: LanguageModel;
  gemini: LanguageModel;
  haikuSupervisor: LanguageModel;
} = {
  get claude() {
    return anthropic(CLAUDE_MODEL);
  },
  get gpt() {
    return openai(GPT_MODEL);
  },
  get gemini() {
    return getVertex()(GEMINI_MODEL);
  },
  get haikuSupervisor() {
    return anthropic(CLAUDE_HAIKU_MODEL);
  },
};

export type ModelKey = keyof typeof models;
