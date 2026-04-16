import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { plaidClient, plaidConfigured } from "@/lib/plaid";
import { Products, CountryCode } from "plaid";
import { checkRateLimit, RULES } from "@/lib/rate-limit";
import { log, errorInfo } from "@/lib/log";

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(
    { ...RULES.strategyUser, name: "plaid:link-token", limit: 15 },
    session.user.id
  );
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limit", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  if (!plaidConfigured()) {
    return NextResponse.json(
      {
        error: "plaid_not_configured",
        message:
          "Brokerage integration is not yet live. We're finalizing our Plaid verification — check back soon.",
      },
      { status: 503 }
    );
  }

  try {
    const resp = await plaidClient().linkTokenCreate({
      user: { client_user_id: session.user.id },
      client_name: "ClearPath Invest",
      products: [Products.Investments],
      country_codes: [CountryCode.Us],
      language: "en",
      redirect_uri: process.env.PLAID_REDIRECT_URI || undefined,
    });
    return NextResponse.json({ linkToken: resp.data.link_token });
  } catch (err) {
    log.error("plaid.link-token", "create failed", {
      userId: session.user.id,
      ...errorInfo(err),
    });
    return NextResponse.json({ error: "Could not start brokerage linking. Try again." }, { status: 500 });
  }
}
