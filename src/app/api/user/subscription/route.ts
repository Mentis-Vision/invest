import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  getSubscription,
  ensureSubscriptionRecord,
  effectiveTierFor,
} from "@/lib/subscription";
import { log, errorInfo } from "@/lib/log";

/**
 * GET /api/user/subscription
 *
 * Returns the billing state the dashboard / settings UI needs to
 * render trial countdown, paid badges, and the trial-end nudge
 * banner. Read-only mirror of the same data the settings page
 * fetches server-side; this route exists so client-only contexts
 * (the in-app banner that renders inside a "use client" shell)
 * can refresh on its own without a full page reload.
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Same lazy-create the page-level routes do — a user landing
    // here directly (e.g. via the banner's mount-time fetch) without
    // having yet hit /app should still get a row written so their
    // trial timer starts now rather than on next page load.
    await ensureSubscriptionRecord(session.user.id);
    const sub = await getSubscription(session.user.id);
    return NextResponse.json({
      tier: sub?.tier ?? "trial",
      effectiveTier: effectiveTierFor(sub),
      status: sub?.status ?? "trialing",
      trialEndsAt: sub?.trialEndsAt ?? null,
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
    });
  } catch (err) {
    log.error("user.subscription", "GET failed", {
      userId: session.user.id,
      ...errorInfo(err),
    });
    return NextResponse.json(
      { error: "Could not load subscription" },
      { status: 500 }
    );
  }
}
