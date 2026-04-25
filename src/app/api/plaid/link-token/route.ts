import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  createLinkToken,
  plaidConfigured,
  checkPlaidItemCap,
  PLAID_ITEM_CAPS,
} from "@/lib/plaid";
import { log, errorInfo } from "@/lib/log";
import { isDemoUser } from "@/lib/admin";

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

  // Demo account is read-only — pre-seeded holdings, no real brokerage
  // linking. Blocks the $0.35/mo per-Item charge and the "real user
  // data showing up in the demo account" confusion mode.
  if (isDemoUser(session.user)) {
    return NextResponse.json(
      {
        error: "demo_account",
        message:
          "The demo account has pre-seeded holdings and can't link real brokerages. Sign up for a real account to link your own.",
      },
      { status: 403 }
    );
  }

  let body: { reauth?: unknown; itemId?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine — default flow is "new Item"
  }

  // App base — origin only, no path. Used to derive the redirect URI.
  // Order: BETTER_AUTH_URL (authoritative for session cookies too) →
  // NEXT_PUBLIC_APP_URL → nothing.
  const appBase = (
    process.env.BETTER_AUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    null
  )?.replace(/\/$/, "");

  // Webhook URL — if PLAID_WEBHOOK_URL is set, use it as the complete
  // URL (explicit override). Otherwise derive from appBase. This is
  // the URL Plaid POSTs to for DEFAULT_UPDATE / HISTORICAL_UPDATE /
  // etc., so it must point to our /api/plaid/webhook handler.
  const webhookUrl =
    process.env.PLAID_WEBHOOK_URL ??
    (appBase ? `${appBase}/api/plaid/webhook` : undefined);

  // Required for OAuth institutions (Schwab, Fidelity, Vanguard). Must
  // exactly match a URL registered in Plaid Dashboard → API → Allowed
  // redirect URIs. Always derived from the app base — never from the
  // webhook URL.
  const redirectUri = appBase ? `${appBase}/plaid-oauth` : undefined;

  // Cost-cap gate for NEW Item flows. Reauth is exempt (it replaces
  // an existing Item, doesn't add one). If a user is at cap, return
  // 402 with enough info for the client to show an upgrade prompt.
  if (body.reauth !== true) {
    const cap = await checkPlaidItemCap(session.user.id);
    if (!cap.ok) {
      const nextTier: Record<string, string> = {
        beta: "Individual ($29/mo)",
        individual: "Active ($79/mo)",
        active: "Advisor ($500/mo)",
      };
      const upsell = nextTier[cap.tier] ?? null;
      log.info("plaid.link-token", "cap hit", {
        userId: session.user.id,
        tier: cap.tier,
        used: cap.used,
        max: cap.max,
      });
      return NextResponse.json(
        {
          error: "item_cap_reached",
          message: upsell
            ? `You've linked ${cap.used} of ${cap.max} brokerages on your ${cap.tier} plan. Upgrade to ${upsell} for ${PLAID_ITEM_CAPS[cap.tier === "beta" ? "individual" : cap.tier === "individual" ? "active" : "advisor"]} connections.`
            : `You've linked ${cap.used} of ${cap.max} brokerages on your ${cap.tier} plan. Contact support to increase the cap.`,
          tier: cap.tier,
          used: cap.used,
          max: cap.max,
          upsellTier: upsell,
        },
        { status: 402 }
      );
    }
  }

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
      redirectUri,
      accessToken,
    });
    return NextResponse.json({ linkToken });
  } catch (err) {
    // Extract Plaid's API error details so we can return an actionable
    // message to the client instead of a generic "Try again."
    // Plaid SDK (axios) puts the useful bits at err.response.data.
    const plaidData =
      (err as { response?: { data?: unknown } })?.response?.data ?? null;
    const plaidError = plaidData as {
      error_code?: string;
      error_type?: string;
      error_message?: string;
      display_message?: string | null;
    } | null;

    log.error("plaid.link-token", "create failed", {
      userId: session.user.id,
      plaidErrorCode: plaidError?.error_code,
      plaidErrorType: plaidError?.error_type,
      plaidErrorMessage: plaidError?.error_message,
      ...errorInfo(err),
    });

    // Map common Plaid errors to user-actionable messages.
    let userMessage = "Could not start Plaid Link. Try again.";
    const code = plaidError?.error_code;
    if (code === "INVALID_FIELD" || code === "INVALID_INPUT") {
      const msg = plaidError?.error_message?.toLowerCase() ?? "";
      if (msg.includes("redirect")) {
        userMessage =
          "Linking isn't fully configured for this deploy. Please contact support — we need to register our redirect URL with Plaid.";
      } else {
        userMessage = plaidError?.display_message ?? userMessage;
      }
    } else if (code === "INSTITUTION_NOT_SUPPORTED") {
      userMessage =
        "Your institution isn't ready yet. Registration may still be in progress (up to 24h after production was granted).";
    } else if (code === "INSTITUTION_NOT_ENABLED_IN_REGION") {
      userMessage =
        "This institution isn't available in your region.";
    } else if (plaidError?.display_message) {
      userMessage = plaidError.display_message;
    }

    return NextResponse.json(
      {
        error: code ?? "plaid_error",
        message: userMessage,
      },
      { status: 500 }
    );
  }
}
