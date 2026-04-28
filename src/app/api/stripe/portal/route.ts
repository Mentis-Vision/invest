import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { getSubscription, ensureStripeCustomer } from "@/lib/subscription";
import { log, errorInfo } from "@/lib/log";

/**
 * POST /api/stripe/portal
 *
 * Returns: { url: string } — Stripe-hosted Customer Portal URL.
 *
 * Used by the "Manage billing" button in settings. The portal handles
 * upgrade / downgrade / cancel / payment-method updates / invoice
 * history with zero custom UI on our side. Stripe owns the
 * compliance surface.
 *
 * Users without a stripe_customer_id yet (still on trial, never
 * upgraded) get redirected to the pricing page instead — there's no
 * portal to surface for someone who hasn't entered the paid funnel.
 */
export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!stripeConfigured()) {
    return NextResponse.json(
      { error: "Billing is not yet configured." },
      { status: 503 }
    );
  }

  try {
    let sub = await getSubscription(session.user.id);
    if (!sub?.stripeCustomerId) {
      // No customer yet — create one now so the portal has something
      // to render (even if the user has never paid, they can still
      // see their billing email + add a payment method ahead of time).
      await ensureStripeCustomer(
        session.user.id,
        session.user.email,
        session.user.name
      );
      sub = await getSubscription(session.user.id);
    }
    if (!sub?.stripeCustomerId) {
      return NextResponse.json(
        { error: "Could not initialize billing customer" },
        { status: 500 }
      );
    }

    const baseUrl = process.env.BETTER_AUTH_URL || req.nextUrl.origin;
    const portal = await stripe().billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${baseUrl}/app/settings`,
    });

    return NextResponse.json({ url: portal.url });
  } catch (err) {
    log.error("stripe.portal", "failed", {
      userId: session.user.id,
      ...errorInfo(err),
    });
    return NextResponse.json(
      { error: "Could not open billing portal." },
      { status: 500 }
    );
  }
}
