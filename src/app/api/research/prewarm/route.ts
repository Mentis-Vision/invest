import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getStockSnapshot } from "@/lib/data/yahoo";
import { getRecentFilings } from "@/lib/data/sec";
import { getMacroSnapshot } from "@/lib/data/fred";
import { checkRateLimit, RULES } from "@/lib/rate-limit";
import { log, errorInfo } from "@/lib/log";

/**
 * POST /api/research/prewarm
 * Body: { tickers: string[] }
 *
 * Fires the same public-data fetches the research pipeline uses —
 * Yahoo snapshot, SEC filings, FRED macro — in the background so the
 * upstream fetch caches get warmed. When the user then runs research
 * on one of these tickers, the data block assembly is ~instant instead
 * of ~3–6s of upstream HTTP.
 *
 * Crucial properties:
 *   - AUTH-GATED. We don't want anonymous pre-warms hammering SEC/Yahoo.
 *   - RATE-LIMITED per-user (10 prewarm requests/hr). Legit UX pattern
 *     (open Research tab) only fires once per session.
 *   - Caps at 10 tickers per call so a 100-position portfolio doesn't
 *     melt the upstream providers.
 *   - Does NOT call any AI models. Zero wallet impact.
 *   - Returns fast (doesn't await results — fire-and-forget after the
 *     initial validation).
 *   - Failures in individual fetches are logged and swallowed; the
 *     response is always 200 with a per-ticker status so the client
 *     can observe cache coverage if it wants to.
 */
export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(
    { ...RULES.researchUser, name: "research:prewarm", limit: 10 },
    session.user.id
  );
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limit", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  let body: { tickers?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const PATTERN = /^[A-Z][A-Z0-9.\-]{0,9}$/;
  const requested = Array.isArray(body.tickers) ? body.tickers : [];
  const tickers = [
    ...new Set(
      requested
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.toUpperCase().trim())
        .filter((t) => PATTERN.test(t))
    ),
  ].slice(0, 10);

  if (tickers.length === 0) {
    return NextResponse.json({ warmed: [], skipped: 0 });
  }

  // Kick off macro once (shared across tickers). Not awaited — the Vercel
  // fetch cache will serve subsequent callers.
  getMacroSnapshot().catch((err) => {
    log.warn("prewarm", "macro fetch failed", errorInfo(err));
  });

  // Fire per-ticker fetches concurrently, capped at 4 to avoid slamming
  // Yahoo + SEC. Each individual failure is swallowed.
  const warmed: string[] = [];
  const failed: Array<{ ticker: string; error: string }> = [];
  let cursor = 0;
  async function worker() {
    while (cursor < tickers.length) {
      const idx = cursor++;
      const t = tickers[idx];
      try {
        await Promise.all([
          getStockSnapshot(t),
          getRecentFilings(t, 5),
        ]);
        warmed.push(t);
      } catch (err) {
        failed.push({
          ticker: t,
          error: err instanceof Error ? err.message : "unknown",
        });
        log.warn("prewarm", "ticker fetch failed", {
          ticker: t,
          ...errorInfo(err),
        });
      }
    }
  }
  const workers = Array.from({ length: Math.min(4, tickers.length) }, () =>
    worker()
  );
  await Promise.all(workers);

  return NextResponse.json({
    warmed,
    failed,
    count: warmed.length,
  });
}
