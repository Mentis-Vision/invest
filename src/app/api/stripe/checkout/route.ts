import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { stripe, stripeConfigured, priceIdFor, type Tier, type Interval } from "@/lib/stripe";
import { ensureStripeCustomer, getSubscription } from "@/lib/subscription";
import { log, errorInfo } from "@/lib/log";

/**
 * POST /api/stripe/checkout
 *
 * Body: { tier: "individual" | "active" | "advisor", interval: "monthly" | "annual" }
 *
 * Returns: { url: string }  — Stripe-hosted Checkout URL the client redirects to.
 *
 * The user picks a paid tier from the pricing page or settings; we
 * lazily create a Stripe Customer (first time only), spin up a
 * Checkout Session for the chosen price, and return its URL. After
 * payment, Stripe redirects them back to /app/settings?upgraded=1
 * and our webhook updates the user_subscription row.
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

  let body: { tier?: Tier; interval?: Interval } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body — falls through to validation below */
  }
  const tier = body.tier;
  const interval = body.interval ?? "monthly";
  if (!tier || !["individual", "active", "advisor"].includes(tier)) {
    return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
  }
  if (!["monthly", "annual"].includes(interval)) {
    return NextResponse.json({ error: "Invalid interval" }, { status: 400 });
  }

  const priceId = priceIdFor(tier, interval);
  if (!priceId) {
    return NextResponse.json(
      { error: `Tier ${tier} (${interval}) not yet available.` },
      { status: 503 }
    );
  }

  try {
    const customerId = await ensureStripeCustomer(
      session.user.id,
      session.user.email,
      session.user.name
    );

    // If the user already has a paid Stripe subscription, send them to
    // the portal instead — Stripe doesn't let you create a second
    // subscription on the same customer through Checkout, and the
    // portal is the right surface for changing plans.
    const existing = await getSubscription(session.user.id);
    if (existing?.stripeSubscriptionId && existing.status === "active") {
      return NextResponse.json(
        {
          error: "already_subscribed",
          message: "Use Manage billing to change plans.",
        },
        { status: 409 }
      );
    }

    const baseUrl = process.env.BETTER_AUTH_URL || req.nextUrl.origin;
    const checkout = await stripe().checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      // Allow a coupon at checkout — handy for the "founder pricing"
      // 25%-off lock-in. Codes are managed in the Stripe dashboard.
      allow_promotion_codes: true,
      success_url: `${baseUrl}/app/settings?upgraded=1`,
      cancel_url: `${baseUrl}/pricing?canceled=1`,
      // Mirror the user/tier/interval into the session metadata so
      // we can correlate the resulting Checkout event with our DB
      // even if customer metadata gets out of sync.
      metadata: {
        userId: session.user.id,
        tier,
        interval,
      },
      subscription_data: {
        metadata: {
          userId: session.user.id,
          tier,
          interval,
        },
      },
    });

    if (!checkout.url) {
      return NextResponse.json(
        { error: "Stripe did not return a checkout URL" },
        { status: 502 }
      );
    }
    return NextResponse.json({ url: checkout.url });
  } catch (err) {
    log.error("stripe.checkout", "failed", {
      userId: session.user.id,
      tier,
      interval,
      ...errorInfo(err),
    });
    return NextResponse.json(
      { error: "Could not start checkout. Try again." },
      { status: 500 }
    );
  }
}
