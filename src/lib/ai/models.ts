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

export const models: { claude: LanguageModel; gpt: LanguageModel; gemini: LanguageModel } = {
  get claude() {
    return anthropic("claude-sonnet-4-6");
  },
  get gpt() {
    return openai("gpt-5.2");
  },
  get gemini() {
    return getVertex()("gemini-3-pro-preview");
  },
};

export type ModelKey = keyof typeof models;
