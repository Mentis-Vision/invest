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

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Revoke all sessions first so the user's browser session becomes
    // invalid immediately. The user row delete below also cascades to
    // sessions via FK, but explicit first-step cleanup keeps the
    // signed-out state clean if the later delete hiccups.
    await client.query(`DELETE FROM "session" WHERE "userId" = $1`, [userId]);

    // Main delete — CASCADE handles every owned table.
    const result = await client.query(
      `DELETE FROM "user" WHERE id = $1 RETURNING email`,
      [userId]
    );

    await client.query("COMMIT");

    log.info("user.delete", "account deleted", {
      userId,
      // Email is logged once, at deletion, so we have a breadcrumb
      // for support-case correlation later ("I deleted my account
      // but got billed") without retaining the email elsewhere.
      email: (result.rows[0] as { email: string } | undefined)?.email ?? null,
    });

    // Response also sets a cookie-clearing header via BetterAuth so
    // the browser's session cookie goes dead on this response.
    const res = NextResponse.json({ ok: true });
    // BetterAuth uses a signed cookie; clearing it on our side is
    // belt-and-suspenders (the session row is already gone, so any
    // future request with this cookie 401s regardless).
    res.cookies.delete("better-auth.session_token");
    res.cookies.delete("better-auth.session_data");
    return res;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore — primary error is what matters */
    }
    log.error("user.delete", "delete failed", {
      userId,
      ...errorInfo(err),
    });
    return NextResponse.json(
      { error: "Could not delete account. Please contact support." },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
