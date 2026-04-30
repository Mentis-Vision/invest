# Stripe billing — manual setup

The code path is shipped (PR #8). To go live, complete the manual steps
below in the Stripe dashboard and Vercel env. Until you do, the billing
card surfaces as a friendly "Billing isn't live yet" placeholder and
the pricing-page CTAs still route to `/sign-up`.

## 1. Create products + prices in Stripe

In Stripe Dashboard → **Products → Add product**, create three:

| Product name | Description | Recurring price |
|---|---|---|
| ClearPath Individual | "For most investors — 300 quick reads / 30 deep reads / 10 panels per month." | $29 / month  +  optional $290 / year (~17% off) |
| ClearPath Active | "For portfolio builders — 4× Individual usage + weekly portfolio review." | $79 / month  +  optional $790 / year |
| ClearPath Advisor | "For RIAs & planners — 50 portfolios, white-label briefs, API access." | $500 / month |

Copy each Price ID (looks like `price_1Q...`).

## 2. Add env vars in Vercel

In Vercel Dashboard → Project Settings → Environment Variables. **Set
all three environments (Production, Preview, Development) for each
key**, since the Preview env is what powers PR previews:

| Key | Value | Scope |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_...` (or `sk_test_...` in Preview) | Live → Production; Test → Preview + Dev |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` (from step 4) | Same split |
| `STRIPE_PRICE_INDIVIDUAL_MONTHLY` | `price_...` (from step 1) | All envs |
| `STRIPE_PRICE_INDIVIDUAL_ANNUAL` | `price_...` | All envs |
| `STRIPE_PRICE_ACTIVE_MONTHLY` | `price_...` | All envs |
| `STRIPE_PRICE_ACTIVE_ANNUAL` | `price_...` | All envs |
| `STRIPE_PRICE_ADVISOR_MONTHLY` | `price_...` | All envs |

The `priceIdFor(tier, interval)` helper in `src/lib/stripe.ts` reads
these by name. Missing keys return `null` and the checkout API
responds with "tier not yet available" rather than crashing.

## 3. Configure the Customer Portal

Stripe Dashboard → **Settings → Billing → Customer Portal**. Turn on
the portal and check:

- ☑ **Customer can update payment method**
- ☑ **Customer can update billing address**
- ☑ **Customer can switch plans** — and select the three Products from step 1
- ☑ **Customer can cancel subscription** — set to "End of billing period" (not immediate)
- ☑ **Send confirmation emails** for cancellations
- ☑ **Show invoice history**

Save the portal config. The `/api/stripe/portal` route just calls
`billingPortal.sessions.create({ customer })` — Stripe respects
whatever you configured here.

## 4. Set up the webhook

Stripe Dashboard → **Developers → Webhooks → Add endpoint**.

- **URL**: `https://clearpathinvest.app/api/stripe/webhook`
- **Listen to events**: select these five
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`

Click **Add endpoint**, then click into it and copy the **Signing
secret** (`whsec_...`) → paste into `STRIPE_WEBHOOK_SECRET` (step 2).

The webhook code is in `src/app/api/stripe/webhook/route.ts`. It:
1. Verifies the signature with the secret.
2. Refetches the subscription from Stripe (canonical state, not the
   webhook payload).
3. Upserts the `user_subscription` row.

Returns 500 on handler failure so Stripe retries. Returns 200 on
success or for ignored events (charge.*, payment_intent.*, etc.).

## 5. Founder-pricing coupon (FOUNDER25 — first year only)

Two-step in the Stripe Dashboard. The coupon defines the discount
rule; the promotion code is what customers actually type at checkout.

### Step 5a — Create the coupon

Stripe Dashboard → **Products → Coupons → "+ New"**.

- Name: `Founder pricing`
- Type: **Percent off**
- Percent: `25`
- **Duration: Repeating**
- **Duration in months: `12`**

That last bit is the important change — `Repeating / 12` means the
discount applies for the customer's first 12 months of subscription
and then auto-removes. Annual subs get 25% off their one annual
charge; monthly subs get 25% off each of their first 12 monthly
charges. Either way, the customer's renewal at month 13 returns to
full price. No permanent margin tax.

(If "Forever" is set instead, every annual founder customer locks
in 25% off in perpetuity — that's $72.50/yr × N customers × forever
of foregone revenue.)

Save. Stripe assigns an internal coupon ID like `25_off_yEwhKfGn`.

### Step 5b — Create the customer-facing code

Inside the coupon you just created → **"Promotion codes" tab → "+ New"**.

- Code: `FOUNDER25`
- Coupon: (the one from 5a)
- Restrictions:
  - ☑ **Limit to first-time customers only** (prevents abuse — only
    available to customers who haven't paid yet)
  - ☑ **Limit to one redemption per customer**
  - Optional: set an absolute expiry date so the launch promo
    doesn't run indefinitely
- Active: ☑

Save.

### How customers see it

The Checkout Session is created with `allow_promotion_codes: true`,
so the input field appears on the Stripe-hosted checkout. Customer
types `FOUNDER25` → 25% comes off the first invoice. On year-2
renewal the price returns to standard rate automatically; we don't
have to do anything to terminate the discount.

Marketing copy across the site (`/pricing` strip, T-3 + T+7 trial
nudge emails) says **"25% off your first year"** to match.

## 6. Verify the pipeline end-to-end

After steps 1–4 above:

1. **Smoke checkout**: in Settings, click "Upgrade to Individual" →
   land on Stripe Checkout → enter test card `4242 4242 4242 4242`
   any future expiry, any CVC → land back on `/app/settings?upgraded=1`
   → billing card now shows "Current plan: INDIVIDUAL · Renews [date]".
2. **Smoke portal**: click "Manage billing" → land on Stripe Portal →
   click "Cancel subscription" → see "Cancels [date]" badge appear in
   the billing card after redirect back.
3. **Webhook health**: in Stripe Dashboard → Webhooks → click your
   endpoint → "Events" tab. Each smoke action should show as a
   200-response delivery within ~1 second.

If a webhook fails, check the response body in Stripe's webhook event
log — our handler returns the error message in the JSON body. Most
common issue: `STRIPE_WEBHOOK_SECRET` mismatch between the dashboard
and Vercel env.

## What's NOT in this PR (deliberate scope cuts)

- **Tier-based feature gating** — the `effectiveTier` helper exists
  in `src/lib/subscription.ts`, but no API routes currently gate on
  it. Free vs trial vs paid all see the same caps. Once Sang has
  decided the free-tier limits, gate `/api/research/*` and
  `/api/strategy/*` based on `effectiveTier`.
- **Pricing-page direct-to-checkout for signed-in users** — pricing
  CTAs route to `/sign-up` always. Signed-in users wanting to upgrade
  go through `/app/settings`. Future PR can add a "Skip to checkout"
  shortcut for signed-in pricing-page visitors.
- **Annual toggle on `/pricing`** — copy supports it, prices exist
  in env, but the page hasn't been rebuilt to expose the toggle.
  That ships in the Phase D pricing-rebuild PR.
- **Email receipts customization** — using Stripe's default emails for
  now. Configure via Stripe Dashboard → Settings → Emails when ready.

## Schema reference

```sql
CREATE TABLE user_subscription (
  "userId"               TEXT PRIMARY KEY,
  "stripeCustomerId"     TEXT UNIQUE,
  "stripeSubscriptionId" TEXT UNIQUE,
  tier                   TEXT NOT NULL DEFAULT 'trial',
  status                 TEXT NOT NULL DEFAULT 'trialing',
  "trialStartedAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "trialEndsAt"          TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  "currentPeriodEnd"     TIMESTAMPTZ,
  "cancelAtPeriodEnd"    BOOLEAN NOT NULL DEFAULT false,
  "createdAt"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Created lazily via `ensureSchema()` in `src/lib/subscription.ts` on
first call. No separate migration file (codebase uses raw-SQL
ensure-call pattern).
