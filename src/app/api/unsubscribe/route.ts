import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { log, errorInfo } from "@/lib/log";
import { verifyUnsubscribeToken } from "@/lib/email/weekly-brief-email";

/**
 * RFC 8058 one-click unsubscribe POST handler + typed opt-out side
 * channel for newsletters we actually run (right now: the weekly
 * bull-vs-bear brief).
 *
 * Mail providers (Gmail, Outlook, Yahoo) POST `List-Unsubscribe=One-Click`
 * to this URL when a user clicks the provider-rendered "Unsubscribe"
 * button. They expect 200 OK, no body content.
 *
 * Legacy behaviour (no type param):
 *   We log the request and return 200. None of our *transactional*
 *   email can be opted out of at the account level — it's required to
 *   operate the account.
 *
 * Typed opt-out (type=weekly-brief):
 *   A signed HMAC token in the link lets us verify the click was
 *   legitimate without any DB lookup. We flip the
 *   "user.weeklyBriefOptOut" or "waitlist.weeklyBriefOptOut" column
 *   and return 200 either way (providers downrank senders that return
 *   non-2xx on unsubscribe).
 *
 * The typed opt-out is also exposed via GET so the user-facing
 * /unsubscribe page can read the query string and mirror the action.
 */

type Audience = "user" | "waitlist";

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const { applied, reason } = await applyOptOut(url);
  log.info("email.unsubscribe", "one-click POST received", {
    type: url.searchParams.get("type"),
    audience: url.searchParams.get("audience"),
    applied,
    reason,
  });
  return NextResponse.json({ ok: true, applied, reason });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  // Best-effort apply on GET too — some providers follow the
  // List-Unsubscribe URL as a plain link rather than a POST. The
  // user-facing /unsubscribe page already re-applies idempotently,
  // but applying here short-circuits the edge case where the user
  // closes the tab before the page finishes loading.
  const { applied } = await applyOptOut(url);
  const to = url.searchParams.get("email") ?? url.searchParams.get("to") ?? "";
  const type = url.searchParams.get("type") ?? "";
  // Forward relevant params to the user-facing page so it can render
  // the right confirmation message.
  const target = new URL("/unsubscribe", req.url);
  if (to) target.searchParams.set("to", to);
  if (type) target.searchParams.set("type", type);
  if (applied) target.searchParams.set("applied", "1");
  return NextResponse.redirect(target);
}

/**
 * Parse + verify + apply the opt-out described by the URL search params.
 * Returns { applied, reason } — applied=true means we flipped a DB row.
 * On verification failure we return applied=false with a reason, but
 * never throw and never surface 4xx to the caller (provider reputation).
 */
async function applyOptOut(url: URL): Promise<{
  applied: boolean;
  reason: string;
}> {
  const type = url.searchParams.get("type");
  const email = (url.searchParams.get("email") ?? "").trim().toLowerCase();
  const audienceParam = url.searchParams.get("audience");
  const token = url.searchParams.get("token") ?? "";

  if (type !== "weekly-brief") {
    // No typed opt-out requested — classic RFC 8058 one-click on a
    // purely transactional address. Nothing to do.
    return { applied: false, reason: "no_typed_opt_out" };
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { applied: false, reason: "invalid_email" };
  }
  const audience: Audience =
    audienceParam === "waitlist" ? "waitlist" : "user";

  if (!verifyUnsubscribeToken(email, audience, token)) {
    log.warn("email.unsubscribe", "token verify failed", {
      audience,
      emailPrefix: email.split("@")[0].slice(0, 4),
    });
    return { applied: false, reason: "token_invalid" };
  }

  try {
    if (audience === "user") {
      await pool.query(
        `UPDATE "user" SET "weeklyBriefOptOut" = true WHERE lower(email) = $1`,
        [email]
      );
    } else {
      await pool.query(
        `UPDATE "waitlist" SET "weeklyBriefOptOut" = true WHERE lower(email) = $1`,
        [email]
      );
    }
    return { applied: true, reason: "ok" };
  } catch (err) {
    log.error("email.unsubscribe", "db update failed", {
      audience,
      ...errorInfo(err),
    });
    return { applied: false, reason: "db_error" };
  }
}
