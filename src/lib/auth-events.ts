import { pool } from "./db";
import { log, errorInfo } from "./log";

/**
 * Auth audit log.
 *
 * Records significant auth-related events into the `auth_event` table
 * so we have a clear timeline of sign-ins, sign-outs, password resets,
 * verification attempts, and failed attempts.
 *
 * Intentionally fire-and-forget — a DB write failure here must never
 * break the user's auth flow. Wrap in try/catch and swallow.
 *
 * PII safety: we log the email (we already store it on user) and the
 * IP + UA (needed for security review). We do NOT log password hashes,
 * tokens, secrets, or any verification codes.
 */

export type AuthEventType =
  | "sign_in_email_success"
  | "sign_in_email_failure"
  | "sign_up_email_success"
  | "sign_up_email_failure"
  | "sign_in_oauth_success"
  | "sign_in_oauth_failure"
  | "sign_out"
  | "password_reset_requested"
  | "password_reset_success"
  | "password_reset_failure"
  | "email_verified"
  | "session_revoked";

export type AuthEventInput = {
  userId?: string | null;
  eventType: AuthEventType;
  email?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  success?: boolean;
  metadata?: Record<string, unknown>;
};

function genId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function recordAuthEvent(evt: AuthEventInput): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO "auth_event"
         (id, "userId", "eventType", email, "ipAddress", "userAgent", success, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        genId(),
        evt.userId ?? null,
        evt.eventType,
        evt.email?.slice(0, 254) ?? null,
        evt.ipAddress?.slice(0, 64) ?? null,
        evt.userAgent?.slice(0, 500) ?? null,
        evt.success ?? true,
        evt.metadata ? JSON.stringify(evt.metadata) : null,
      ]
    );
  } catch (err) {
    log.warn("auth-events", "record failed", {
      eventType: evt.eventType,
      ...errorInfo(err),
    });
  }
}

/**
 * Extract IP from a Request (x-forwarded-for, x-real-ip, cf-connecting-ip).
 * Identical to rate-limit.ts/getClientIp but duplicated here to avoid the
 * rate-limit module pulling in auth-events for a trivial string op.
 */
export function getRequestIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return (
    req.headers.get("x-real-ip") ??
    req.headers.get("cf-connecting-ip") ??
    null
  );
}

export function getRequestUa(req: Request): string | null {
  return req.headers.get("user-agent") ?? null;
}
