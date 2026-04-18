# Getting started

## Creating an account

Head to `clearpathinvest.app/sign-up`. Two paths:

1. **Email + password** — you'll receive a verification email via Resend.
   Click the link, you'll land on `/verify` which auto-signs you in and
   redirects to `/app`. If the link has expired, the verify page gives
   you an inline form to request a new one.
2. **Continue with Google** — standard OAuth, no verification email
   required.

Email verification is gated by `REQUIRE_EMAIL_VERIFICATION` in prod
env. It's on once Resend DNS is verified (domain + SPF/DKIM/DMARC
records land).

## First look at the dashboard

Signing in takes you to `/app` which is the Overview. Without a brokerage
connected you'll see:

- Portfolio hero with "Not connected"
- KPI strip showing dashes
- An invite to connect your brokerage

## Connecting a brokerage (SnapTrade)

Click **My Portfolio** in the sidebar, then **Connect Brokerage**. A
popup opens the SnapTrade Connection Portal. Pick your broker, sign
in to their system (we never see those credentials), and authorize
read-only access. The popup closes itself when done and the
dashboard refreshes with your holdings.

Supported brokers: the full SnapTrade roster (Schwab, Fidelity,
Vanguard, Robinhood, IBKR, etc. — see
[SnapTrade's integrations page](https://support.snaptrade.com/brokerages)).

**Read-only access only.** We cannot move money, place trades, or
change any settings on your broker account.

## Daily refresh cycle

Every night around 2 AM ET an automated job runs:

1. Syncs fresh holdings + trades from every connected brokerage.
2. Pulls the latest market data (Yahoo, Alpha Vantage cross-verify,
   CoinGecko for crypto) into the ticker warehouse.
3. Pulls SEC EDGAR filings + editorial news (WSJ, CNBC, MarketWatch,
   IBD, Seeking Alpha, Damodaran).
4. Generates your **portfolio strategy review** for the day — the
   full three-lens read, pre-computed so it's waiting when you sign in.

You'll usually see "Refreshed at 6:42 AM today" on your data surfaces.
That's the overnight refresh landing; you don't have to do anything.

## The demo user

For preview access: `demo@clearpathinvest.app` / `DemoPass2026!`. Has
a test portfolio connected, no real money. Don't delete.
