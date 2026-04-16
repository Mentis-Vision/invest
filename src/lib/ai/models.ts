import { gateway } from "ai";

/**
 * Centralized model registry for ClearPath.
 * Routes through Vercel AI Gateway — one API key (AI_GATEWAY_API_KEY) for all providers,
 * unified billing, built-in failover, per-provider observability.
 */
export const models = {
  claude: gateway("anthropic/claude-sonnet-4.6"),
  gpt: gateway("openai/gpt-5.2"),
  gemini: gateway("google/gemini-3-pro-preview"),
} as const;

export type ModelKey = keyof typeof models;
