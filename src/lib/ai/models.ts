import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { createVertex } from "@ai-sdk/google-vertex";

/**
 * Centralized model registry for ClearPath.
 * Direct provider SDKs — no middleman, separate per-app usage tracking.
 *
 * Env vars:
 *   - ANTHROPIC_API_KEY (Anthropic console)
 *   - OPENAI_API_KEY (OpenAI dashboard)
 *   - GOOGLE_VERTEX_API_KEY + GOOGLE_VERTEX_PROJECT + GOOGLE_VERTEX_LOCATION (GCP Vertex, Express Mode)
 */
const vertex = createVertex({
  apiKey: process.env.GOOGLE_VERTEX_API_KEY,
  project: process.env.GOOGLE_VERTEX_PROJECT,
  location: process.env.GOOGLE_VERTEX_LOCATION ?? "us-central1",
});

export const models = {
  claude: anthropic("claude-sonnet-4-6"),
  gpt: openai("gpt-5.2"),
  gemini: vertex("gemini-3-pro-preview"),
} as const;

export type ModelKey = keyof typeof models;
