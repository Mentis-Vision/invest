import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  exchangePublicToken,
  plaidConfigured,
  syncHoldings,
} from "@/lib/plaid";
import { log, errorInfo } from "@/lib/log";

/**
 * POST /api/plaid/exchange-public-token
 *
 * Body: { publicToken: string }
 *
 * Exchanges the client-side `public_token` (returned by Plaid Link's
 * onSuccess) for a long-lived access_token, persists the Item, and
 * kicks off the first Holdings sync synchronously so the user lands
 * on a populated Portfolio view instead of an empty one.
 *
 * Transactions are NOT synced here — the HISTORICAL_UPDATE webhook
 * will fire when Plaid finishes its own initial pull (usually within
 * a minute).
 */
export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!plaidConfigured()) {
    return NextResponse.json(
      { error: "Plaid is not configured on this deploy." },
      { status: 503 }
    );
  }

  let body: { publicToken?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.publicToken !== "string" || body.publicToken.length < 10) {
    return NextResponse.json(
      { error: "publicToken required" },
      { status: 400 }
    );
  }

  try {
    const { id, itemId, institutionName } = await exchangePublicToken(
      session.user.id,
      body.publicToken
    );

    // First holdings sync — best-effort; don't fail the exchange on
    // a sync hiccup because the Item is linked and a webhook will
    // re-trigger shortly. BUT we record the failure on the Item so the
    // user sees a visible "sync failed, tap to retry" state rather
    // than a mysteriously empty portfolio.
    let holdingsCount = 0;
    let syncFailed = false;
    let syncFailReason: string | null = null;
    try {
      const res = await syncHoldings(session.user.id, itemId);
      holdingsCount = res.holdings;
    } catch (err) {
      syncFailed = true;
      syncFailReason =
        (err as Error)?.message?.slice(0, 200) ?? "Unknown sync error";
      log.warn("plaid.exchange", "initial holdings sync failed", {
        userId: session.user.id,
        itemId,
        ...errorInfo(err),
      });
      // Mark the Item so the Reauth banner surfaces this as actionable
      // ("Sync failed — tap to retry") instead of an empty portfolio.
      // syncHoldings succeeding later (via webhook or manual retry)
      // will clear this state by setting status back to 'active'.
      const { pool } = await import("@/lib/db");
      await pool
        .query(
          `UPDATE "plaid_item"
           SET "status" = 'sync_failed',
               "statusDetail" = $1,
               "updatedAt" = NOW()
           WHERE "itemId" = $2 AND "userId" = $3`,
          [`Couldn't pull initial holdings: ${syncFailReason}`, itemId, session.user.id]
        )
        .catch(() => {
          /* non-fatal — logging-only fallback */
        });
    }

    return NextResponse.json({
      ok: true,
      id,
      itemId,
      institutionName,
      holdings: holdingsCount,
      syncFailed,
      syncFailReason,
    });
  } catch (err) {
    log.error("plaid.exchange", "exchange failed", {
      userId: session.user.id,
      ...errorInfo(err),
    });
    return NextResponse.json(
      { error: "Could not complete linking. Try again." },
      { status: 500 }
    );
  }
}
