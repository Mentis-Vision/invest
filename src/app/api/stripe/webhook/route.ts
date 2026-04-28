import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { syncSubscriptionFromStripe } from "@/lib/subscription";
import { pool } from "@/lib/db";
import { log, errorInfo } from "@/lib/log";

/**
 * POST /api/stripe/webhook
 *
 * Receives Stripe events. NOT auth-gated — Stripe signs the payload
 * with STRIPE_WEBHOOK_SECRET and we verify the signature here.
 * proxy.ts excludes this path from the auth gate.
 *
 * Events we handle (configure these in the Stripe dashboard):
 *   - checkout.session.completed         — first paid subscription
 *   - customer.subscription.created      — alt path for subscription creation
 *   - customer.subscription.updated      — plan change, payment-method update
 *   - customer.subscription.deleted      — full cancellation
 *   - invoice.payment_failed             — surface "past due" UI
 *
 * On every subscription-shaped event, we re-fetch from Stripe rather
 * than trust webhook payload state — webhooks can arrive out of order
 * during retries, but the API always returns canonical state.
 */
export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }
  if (!secret) {
    log.error("stripe.webhook", "STRIPE_WEBHOOK_SECRET not set; rejecting");
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  // Stripe verification needs the raw bytes — req.json() would mutate
  // the buffer and break the signature check.
  const raw = await req.text();

  let event;
  try {
    event = stripe().webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    log.warn("stripe.webhook", "signature verification failed", errorInfo(err));
    return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;
        if (subscriptionId) {
          await syncSubscriptionFromStripe(subscriptionId);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        await syncSubscriptionFromStripe(sub.id);
        break;
      }
      case "invoice.payment_failed": {
        // Mark the user's subscription as past_due. The user will
        // see the warning in settings and can update their card via
        // the portal. We refetch the subscription on the off chance
        // Stripe has already moved past 'past_due' to 'canceled'.
        const invoice = event.data.object;
        const subscriptionId =
          typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription?.id;
        if (subscriptionId) {
          await syncSubscriptionFromStripe(subscriptionId);
        }
        break;
      }
      default:
        // Unhandled event types are intentional — Stripe sends a lot
        // we don't care about (charge.*, payment_intent.*, etc.).
        // Logging at debug-only level so the prod log isn't noisy.
        log.debug?.("stripe.webhook", "ignored event", { type: event.type });
        break;
    }

    // Optional: persist event ID for idempotency tracing. The handlers
    // above are already idempotent (Stripe API state is canonical), so
    // a duplicate webhook is safe — but the audit trail is useful when
    // debugging which events fired.
    try {
      await pool.query(
        `INSERT INTO "stripe_event_log" (id, type, "createdAt")
         VALUES ($1, $2, NOW())
         ON CONFLICT (id) DO NOTHING`,
        [event.id, event.type]
      );
    } catch {
      // Table may not exist yet — non-fatal. Create it lazily on
      // first call if you want this audit trail; we don't depend on
      // it for correctness.
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    log.error("stripe.webhook", "handler failed", {
      type: event.type,
      eventId: event.id,
      ...errorInfo(err),
    });
    // Return 500 so Stripe retries with backoff. Returning 200 here
    // would silently drop the event.
    return NextResponse.json({ error: "Internal" }, { status: 500 });
  }
}

/** Stripe webhooks always POST raw bytes; reject other methods up-front. */
export const dynamic = "force-dynamic";
