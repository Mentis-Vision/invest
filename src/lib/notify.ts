import { log, errorInfo } from "./log";

/**
 * Slack Incoming Webhook notifier.
 *
 * Usage: set `SLACK_WEBHOOK_URL` in Vercel env (or `.env.local`). When unset,
 * notifications no-op silently — safe for local dev and safe if the team
 * hasn't provisioned Slack yet.
 *
 * Never throws. Never blocks the caller. Fire-and-forget.
 *
 * Payload format is the simple `{ text: "..." }` Incoming Webhook contract
 * so any Slack-compatible webhook (Discord via proxy, Mattermost, etc.)
 * accepts the same shape.
 */

export type SlackBlock = {
  text: string;
  /** Optional blocks for richer formatting. If omitted, `text` is used. */
  blocks?: unknown[];
};

const SLACK_URL_ENV = "SLACK_WEBHOOK_URL";

export function slackConfigured(): boolean {
  return !!process.env[SLACK_URL_ENV];
}

export async function notifySlack(
  payload: SlackBlock,
  scope = "notify"
): Promise<void> {
  const url = process.env[SLACK_URL_ENV];
  if (!url) return;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: payload.text,
        ...(payload.blocks ? { blocks: payload.blocks } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.warn(scope, "slack webhook non-2xx", {
        status: res.status,
        body: body.slice(0, 200),
      });
    }
  } catch (err) {
    log.warn(scope, "slack webhook failed", errorInfo(err));
  }
}
