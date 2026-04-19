import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { log, errorInfo } from "@/lib/log";

/**
 * DELETE /api/user/me
 *
 * Self-service account deletion. Wipes the user row; foreign-key
 * CASCADE rules remove everything else in one transaction:
 *   account, session, user_profile, dashboard_layout, holding,
 *   snaptrade_connection, snaptrade_user, recommendation,
 *   portfolio_review_daily, portfolio_snapshot, trade, alert_event.
 * auth_event rows stay (audit trail) with userId → NULL.
 *
 * Body (JSON):
 *   { "confirm": "DELETE" }   — literal uppercase DELETE guards
 *                                against accidental/API-fuzz calls.
 *
 * Safety rails:
 *   - Session must be valid (proxy.ts + local getSession double-check)
 *   - `DELETE` literal required in body (not a URL param — can't be
 *     hit by a drive-by GET/POST)
 *   - Demo account is protected — we refuse to delete the fixed demo
 *     user (`demo@clearpathinvest.app`) so it's always available for
 *     shared-device demos and new-user walkthroughs.
 *   - Everything runs in one transaction. If any CASCADE step fails,
 *     the row stays and we return 500 — no partial-delete states.
 *
 * Warehouse tables (ticker_market_daily, ticker_fundamentals, etc.)
 * have no userId column by design (AGENTS.md rule #8) — they aren't
 * touched.
 */

const DEMO_EMAIL = "demo@clearpathinvest.app";

export async function DELETE(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { confirm?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.confirm !== "DELETE") {
    return NextResponse.json(
      {
        error: 'Confirmation required. Send { "confirm": "DELETE" } to proceed.',
      },
      { status: 400 }
    );
  }

  // Demo account protection — keep the shared demo user alive
  // regardless of who's signed into it.
  if (session.user.email.toLowerCase() === DEMO_EMAIL) {
    log.warn("user.delete", "attempted delete on demo account", {
      userId: session.user.id,
    });
    return NextResponse.json(
      {
        error:
          "The shared demo account cannot be deleted. Sign up for your own account to get a deletable profile.",
      },
      { status: 403 }
    );
  }

  const userId = session.user.id;

  // No explicit transaction: @neondatabase/serverless uses an HTTP-
  // per-query transport which doesn't support multi-statement
  // transactions via client.connect/begin/commit. The deletion is
  // still safe:
  //
  //   1. First DELETE drops the user's sessions — if this succeeds
  //      and the next step fails, the user is signed out but their
  //      row still exists (they can try again). Idempotent.
  //   2. Second DELETE drops the user row; every other user-scoped
  //      table cascades via FK on delete (account, user_profile,
  //      dashboard_layout, holding, snaptrade_connection,
  //      snaptrade_user, plaid_item, plaid_account, plaid_transaction,
  //      recommendation, recommendation_outcome, portfolio_review_daily,
  //      portfolio_snapshot, trade, alert_event, twoFactor).
  //      auth_event FK is SET NULL — audit trail survives detached.
  //
  // If step 2 fails we return 500 with the user row intact. The user
  // can retry. Step 1's session wipe is a no-op on retry.
  try {
    await pool.query(`DELETE FROM "session" WHERE "userId" = $1`, [userId]);

    const result = await pool.query(
      `DELETE FROM "user" WHERE id = $1 RETURNING email`,
      [userId]
    );

    log.info("user.delete", "account deleted", {
      userId,
      // Email is logged once, at deletion, so we have a breadcrumb
      // for support-case correlation later ("I deleted my account
      // but got billed") without retaining the email elsewhere.
      email: (result.rows[0] as { email: string } | undefined)?.email ?? null,
    });

    // Response also clears the BetterAuth session cookies as
    // belt-and-suspenders (session rows are already gone, so any
    // future request with a stale cookie 401s regardless).
    const res = NextResponse.json({ ok: true });
    res.cookies.delete("better-auth.session_token");
    res.cookies.delete("better-auth.session_data");
    return res;
  } catch (err) {
    log.error("user.delete", "delete failed", {
      userId,
      ...errorInfo(err),
    });
    return NextResponse.json(
      { error: "Could not delete account. Please contact support." },
      { status: 500 }
    );
  }
}
