import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  snaptradeClient,
  snaptradeConfigured,
  ensureSnaptradeUser,
} from "@/lib/snaptrade";
import { checkRateLimit, RULES } from "@/lib/rate-limit";
import { log, errorInfo } from "@/lib/log";
import { isDemoUser } from "@/lib/admin";

/**
 * POST /api/snaptrade/login-url
 * Ensures the user exists in SnapTrade, then returns a one-time Connection
 * Portal URL the client opens in a popup. The URL expires in ~5 minutes.
 */
export async function POST(_req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Demo account is read-only; pre-seeded holdings, no real brokerage
  // linking. Keeps the demo account clean for due-diligence walkthroughs.
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

  const rl = await checkRateLimit(
    { ...RULES.strategyUser, name: "snaptrade:login-url", limit: 15 },
    session.user.id
  );
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limit", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  if (!snaptradeConfigured()) {
    return NextResponse.json(
      {
        error: "snaptrade_not_configured",
        message:
          "Brokerage integration is not yet live. We're finalizing setup — check back soon.",
      },
      { status: 503 }
    );
  }

  try {
    const { snaptradeUserId, userSecret } = await ensureSnaptradeUser(
      session.user.id
    );
    const redirect = process.env.SNAPTRADE_REDIRECT_URI;
    const resp = await snaptradeClient().authentication.loginSnapTradeUser({
      userId: snaptradeUserId,
      userSecret,
      customRedirect: redirect,
      // CRITICAL: without immediateRedirect, SnapTrade renders its own
      // post-success screen inside the popup. Their "Done" button there
      // sometimes silently fails to trigger the customRedirect (browser
      // popup-close restrictions + the navigation chain). Users reported
      // "I click Done and nothing happens; only X-ing out brings me back."
      // immediateRedirect=true makes SnapTrade redirect to customRedirect
      // the moment the connection completes — no extra click required.
      immediateRedirect: true,
      connectionType: "read",
      // Allow the user to connect to any supported broker.
      // Specific broker slugs can be added later.
    });

    // The SDK returns either a { redirectURI } object (portal) or an object
    // with an `encryptedMessageAndSessionId` (CDK). We only use the portal path.
    const body = resp.data as { redirectURI?: string } | undefined;
    const url = body?.redirectURI;
    if (!url) {
      log.error("snaptrade.login-url", "no redirectURI in response", {});
      return NextResponse.json(
        { error: "Unexpected SnapTrade response" },
        { status: 502 }
      );
    }
    return NextResponse.json({ loginUrl: url });
  } catch (err) {
    log.error("snaptrade.login-url", "failed", {
      userId: session.user.id,
      ...errorInfo(err),
    });
    return NextResponse.json(
      { error: "Could not start brokerage linking. Try again." },
      { status: 500 }
    );
  }
}
