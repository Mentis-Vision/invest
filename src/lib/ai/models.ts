import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";

/**
 * Centralized model registry for ClearPath.
 * Each model uses the direct provider SDK with its own API key env var:
 *   - ANTHROPIC_API_KEY
 *   - OPENAI_API_KEY
 *   - GOOGLE_GENERATIVE_AI_API_KEY
 */
export const models = {
  claude: anthropic("claude-sonnet-4-6"),
  gpt: openai("gpt-5.2"),
  gemini: google("gemini-3-pro-preview"),
} as const;

export type ModelKey = keyof typeof models;
