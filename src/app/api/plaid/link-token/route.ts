import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { createLinkToken, plaidConfigured } from "@/lib/plaid";
import { log, errorInfo } from "@/lib/log";

/**
 * POST /api/plaid/link-token
 *
 * Returns a short-lived `link_token` the client passes to
 * Plaid Link's `open()`. Also accepts `{ reauth: true, itemId }` to
 * mint a re-auth-flavored link_token for an existing Item that's
 * hit LOGIN_REQUIRED or ITEM_LOGIN_REQUIRED.
 *
 * Scope is fixed at Investments in `createLinkToken`. No way for this
 * route to ask for other products.
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

  let body: { reauth?: unknown; itemId?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine — default flow is "new Item"
  }

  const webhookUrl = (() => {
    const base =
      process.env.PLAID_WEBHOOK_URL ??
      process.env.BETTER_AUTH_URL ??
      process.env.NEXT_PUBLIC_APP_URL ??
      null;
    return base ? `${base.replace(/\/$/, "")}/api/plaid/webhook` : undefined;
  })();

  try {
    // Reauth flow: need the existing access_token so Plaid rehydrates
    // the Link session tied to the same Item. Fetch from DB with
    // ownership check.
    let accessToken: string | undefined;
    if (body.reauth === true && typeof body.itemId === "string") {
      const { pool } = await import("@/lib/db");
      const { decryptSecret } = await import("@/lib/snaptrade");
      const { rows } = await pool.query(
        `SELECT "accessTokenEncrypted"
         FROM "plaid_item"
         WHERE "userId" = $1 AND "itemId" = $2 AND "status" <> 'removed'`,
        [session.user.id, body.itemId]
      );
      if (rows.length === 0) {
        return NextResponse.json(
          { error: "Item not found" },
          { status: 404 }
        );
      }
      accessToken = decryptSecret(
        (rows[0] as { accessTokenEncrypted: string }).accessTokenEncrypted
      );
    }

    const linkToken = await createLinkToken({
      userId: session.user.id,
      webhookUrl,
      accessToken,
    });
    return NextResponse.json({ linkToken });
  } catch (err) {
    log.error("plaid.link-token", "create failed", {
      userId: session.user.id,
      ...errorInfo(err),
    });
    return NextResponse.json(
      { error: "Could not start Plaid Link. Try again." },
      { status: 500 }
    );
  }
}
