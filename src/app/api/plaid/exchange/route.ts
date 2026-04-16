import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { plaidClient, plaidConfigured, encryptAccessToken } from "@/lib/plaid";
import { pool } from "@/lib/db";
import { log, errorInfo } from "@/lib/log";

/**
 * Exchanges the Plaid `public_token` (from Link client-side) for a long-lived
 * `access_token`, encrypts it, and persists the association.
 *
 * Never logs the raw access token.
 */
export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!plaidConfigured()) {
    return NextResponse.json({ error: "plaid_not_configured" }, { status: 503 });
  }

  let body: { publicToken?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const publicToken = body.publicToken?.trim();
  if (!publicToken || publicToken.length < 20) {
    return NextResponse.json({ error: "public_token required" }, { status: 400 });
  }

  try {
    const exchange = await plaidClient().itemPublicTokenExchange({
      public_token: publicToken,
    });
    const accessToken = exchange.data.access_token;
    const itemId = exchange.data.item_id;

    // Fetch institution name for display
    let institutionName: string | null = null;
    let institutionId: string | null = null;
    try {
      const itemResp = await plaidClient().itemGet({ access_token: accessToken });
      institutionId = itemResp.data.item.institution_id ?? null;
      if (institutionId) {
        const inst = await plaidClient().institutionsGetById({
          institution_id: institutionId,
          country_codes: [
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            "US" as any,
          ],
        });
        institutionName = inst.data.institution.name ?? null;
      }
    } catch (err) {
      log.warn("plaid.exchange", "institution lookup failed", {
        userId: session.user.id,
        ...errorInfo(err),
      });
    }

    const encrypted = encryptAccessToken(accessToken);
    const id = crypto.randomUUID();

    await pool.query(
      `INSERT INTO "plaid_item" (id, "userId", "itemId", "accessTokenEncrypted", "institutionId", "institutionName", status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')
       ON CONFLICT ("itemId") DO UPDATE SET
         "accessTokenEncrypted" = EXCLUDED."accessTokenEncrypted",
         "institutionName" = EXCLUDED."institutionName",
         status = 'active',
         "updatedAt" = NOW()`,
      [id, session.user.id, itemId, encrypted, institutionId, institutionName]
    );

    log.info("plaid.exchange", "item linked", {
      userId: session.user.id,
      itemId,
      institutionName,
    });

    return NextResponse.json({
      ok: true,
      institutionName,
      itemId,
    });
  } catch (err) {
    log.error("plaid.exchange", "failed", {
      userId: session.user.id,
      ...errorInfo(err),
    });
    return NextResponse.json({ error: "Could not link brokerage. Try again." }, { status: 500 });
  }
}
