import { NextRequest, NextResponse } from "next/server";
import { log } from "@/lib/log";

/**
 * RFC 8058 one-click unsubscribe POST handler.
 *
 * Mail providers (Gmail, Outlook, Yahoo) call this endpoint when a user
 * clicks the provider's native "Unsubscribe" UI. The List-Unsubscribe
 * header in our outgoing mail points at /unsubscribe?to=... — but the
 * spec separately requires that providers can POST a one-click body
 * `List-Unsubscribe=One-Click` to that URL. Some providers actually POST
 * to the same URL as the header; some POST to an `_post` variant. We
 * accept both:
 *
 *   POST /api/unsubscribe?to=...     (this route)
 *   POST /unsubscribe?to=...          (handled by the page route below as
 *                                      a server action would also be valid;
 *                                      we keep them split so the user-facing
 *                                      page stays a pure RSC and we don't
 *                                      mix data mutation into it)
 *
 * Behaviour:
 *   We don't actually have a mailing list to remove anyone from — all of
 *   our mail is transactional and operating your ClearPath account. We
 *   log the request (helps spot abuse) and return 200 OK so providers
 *   stop nagging the recipient.
 */
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const to = url.searchParams.get("to") ?? "";
  log.info("email.unsubscribe", "one-click POST received", {
    to: to.slice(0, 200),
  });
  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const to = url.searchParams.get("to") ?? "";
  // Some providers GET the URL first; redirect to the user-facing page.
  return NextResponse.redirect(
    new URL(`/unsubscribe?to=${encodeURIComponent(to)}`, req.url)
  );
}
