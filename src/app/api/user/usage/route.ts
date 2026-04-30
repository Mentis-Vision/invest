import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { checkUsageCap, TIER_LIMITS } from "@/lib/usage";
import { log, errorInfo } from "@/lib/log";

/**
 * GET /api/user/usage
 *
 * Surfaces the current month's usage state for the dashboard "X of Y
 * used" indicator and any banner that wants to nudge a user nearing
 * their cap. Same data the gating logic consults on every research
 * call, exposed read-only here so the UI can render before the user
 * tries (and fails) a request.
 *
 * Returns either:
 *   - {ok: true, tier, usage: {tokens, cents}, limits: {tokens, cents},
 *      remaining: {tokens, cents}, resetAt} — under cap, normal state
 *   - {ok: false, tier, reason: "expired" | "tokens" | "cost", resetAt}
 *      — at or past cap; the caller renders the right CTA copy.
 *
 * Auth-gated by proxy.ts via the /api/user/* allowlist.
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const check = await checkUsageCap(session.user.id);
    const limits = TIER_LIMITS[check.tier] ?? TIER_LIMITS.trial;

    if (!check.ok) {
      return NextResponse.json({
        ok: false,
        tier: check.tier,
        tierLabel: limits.label,
        reason: check.reason,
        // For "expired" the resetAt is meaningless (set by the lib
        // to NOW for type-shape uniformity); UI should not render it.
        resetAt: check.reason === "expired" ? null : check.resetAt,
        limits: {
          maxTokens: limits.maxTokens,
          maxCostCents: limits.maxCostCents,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      tier: check.tier,
      tierLabel: limits.label,
      limits: {
        maxTokens: limits.maxTokens,
        maxCostCents: limits.maxCostCents,
      },
      remaining: {
        tokens: check.remainingTokens,
        cents: check.remainingCents,
      },
      // Derived "used" values save the client from doing the math.
      usage: {
        tokens: limits.maxTokens - check.remainingTokens,
        cents: limits.maxCostCents - check.remainingCents,
      },
      resetAt: check.resetAt,
    });
  } catch (err) {
    log.error("user.usage", "GET failed", {
      userId: session.user.id,
      ...errorInfo(err),
    });
    return NextResponse.json(
      { error: "Could not load usage" },
      { status: 500 }
    );
  }
}
