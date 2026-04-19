"use client";

import { useState } from "react";
import { Building2, X, Coins, Briefcase, Loader2 } from "lucide-react";
import { usePlaidLink } from "react-plaid-link";

/**
 * Connect picker modal.
 *
 * Shown when the user clicks "Connect brokerage". Offers two routes:
 *
 *   - **Plaid** — Schwab, Fidelity, Vanguard, and the big traditional
 *     brokerages. Investments-scope only (no banking data). $0.35/Item/mo.
 *   - **SnapTrade** — Robinhood, Coinbase, Kraken, and most retail
 *     brokerages + crypto exchanges. Free tier-aware.
 *
 * Positioning is intentional: the user has zero obligation to know the
 * difference, so we lead with the question ("Which institution?") and
 * let the copy do the routing. A user who searches "Schwab" immediately
 * sees that's a Plaid path; "Robinhood" → SnapTrade; "Coinbase" →
 * SnapTrade. If they're genuinely uncertain, they can pick either and
 * try.
 */
export type ConnectPickerProps = {
  open: boolean;
  onClose: () => void;
  /** Callback from SnapTrade flow — unchanged from existing code path. */
  onStartSnaptrade: () => void;
  /** Called after Plaid Link onSuccess + our exchange call succeeds. */
  onPlaidSuccess?: (result: {
    itemId: string;
    institutionName: string | null;
    holdings: number;
  }) => void;
};

export function ConnectPicker({
  open,
  onClose,
  onStartSnaptrade,
  onPlaidSuccess,
}: ConnectPickerProps) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="connect-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <h2
          id="connect-title"
          className="text-[20px] font-semibold tracking-tight"
        >
          Connect a brokerage
        </h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          Pick the service that covers your institution. Both are
          read-only — no one can trade on your behalf.
        </p>

        <div className="mt-5 space-y-2.5">
          <PickerOption
            icon={Briefcase}
            title="Traditional brokerage"
            subtitle="Schwab · Fidelity · Vanguard · E*TRADE · Merrill · TD Ameritrade · and more"
            provider="plaid"
            onStartSnaptrade={onStartSnaptrade}
            onPlaidSuccess={onPlaidSuccess}
            onCloseModal={onClose}
          />
          <PickerOption
            icon={Coins}
            title="Retail trading + crypto"
            subtitle="Robinhood · Coinbase · Kraken · Webull · Public · and more"
            provider="snaptrade"
            onStartSnaptrade={onStartSnaptrade}
            onPlaidSuccess={onPlaidSuccess}
            onCloseModal={onClose}
          />
        </div>

        <p className="mt-5 text-[11px] leading-relaxed text-muted-foreground">
          Don&rsquo;t see your broker? Start with either one and pick your
          institution on the next screen — both services cover 15+
          institutions each.
        </p>
      </div>
    </div>
  );
}

function PickerOption({
  icon: Icon,
  title,
  subtitle,
  provider,
  onStartSnaptrade,
  onPlaidSuccess,
  onCloseModal,
}: {
  icon: typeof Building2;
  title: string;
  subtitle: string;
  provider: "plaid" | "snaptrade";
  onStartSnaptrade: () => void;
  onPlaidSuccess?: ConnectPickerProps["onPlaidSuccess"];
  onCloseModal: () => void;
}) {
  if (provider === "plaid") {
    return (
      <PlaidOption
        icon={Icon}
        title={title}
        subtitle={subtitle}
        onSuccess={(r) => {
          onPlaidSuccess?.(r);
          onCloseModal();
        }}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        onStartSnaptrade();
        onCloseModal();
      }}
      className="flex w-full items-start gap-3 rounded-lg border border-border bg-background px-4 py-3 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
    >
      <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-secondary">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold leading-tight">{title}</div>
        <div className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          {subtitle}
        </div>
      </div>
    </button>
  );
}

/**
 * Plaid Link launcher wrapped in a picker-option-shaped button.
 *
 * Flow:
 *   1. On first render, fetch a link_token from our backend.
 *   2. `usePlaidLink` initializes Plaid's SDK with that token.
 *   3. When the user clicks, we call `open()` — Plaid opens its own
 *      modal over ours (picker modal stays behind).
 *   4. On success, we POST the publicToken to our exchange endpoint.
 *      The server persists the Item and does an initial holdings sync
 *      before returning.
 *   5. We notify the parent via `onSuccess` so they can close the
 *      picker and refresh their view.
 */
function PlaidOption({
  icon: Icon,
  title,
  subtitle,
  onSuccess,
}: {
  icon: typeof Building2;
  title: string;
  subtitle: string;
  onSuccess: (result: {
    itemId: string;
    institutionName: string | null;
    holdings: number;
  }) => void;
}) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loadingToken, setLoadingToken] = useState(false);
  const [exchanging, setExchanging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { open: openPlaid, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: async (publicToken) => {
      setExchanging(true);
      setError(null);
      try {
        const res = await fetch("/api/plaid/exchange-public-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ publicToken }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error ?? "Could not link this account.");
          return;
        }
        const data = (await res.json()) as {
          itemId: string;
          institutionName: string | null;
          holdings: number;
        };
        onSuccess(data);
      } catch {
        setError("Network error. Try again.");
      } finally {
        setExchanging(false);
      }
    },
    onExit: (err) => {
      // Plaid Link closed without success. `err` is null on user cancel.
      if (err) setError(err.display_message ?? err.error_message ?? null);
    },
  });

  async function handleClick() {
    setError(null);
    if (linkToken && ready) {
      openPlaid();
      return;
    }
    // Fetch the token lazily — keeps the picker modal's initial render
    // cheap (no token requested for users who never click this option).
    setLoadingToken(true);
    try {
      const res = await fetch("/api/plaid/link-token", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Plaid is not available right now.");
        return;
      }
      setLinkToken(data.linkToken);
      // Plaid SDK needs a tick to re-initialize with the new token
      // before it'll accept `open()`. Retry on the next macrotask.
      setTimeout(() => {
        // Best-effort — if SDK still not ready, user can click again.
        try {
          openPlaid();
        } catch {
          /* ignore */
        }
      }, 100);
    } catch {
      setError("Could not reach our server. Try again.");
    } finally {
      setLoadingToken(false);
    }
  }

  const loading = loadingToken || exchanging;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="flex w-full items-start gap-3 rounded-lg border border-border bg-background px-4 py-3 text-left transition-colors hover:border-primary/50 hover:bg-primary/5 disabled:opacity-60"
    >
      <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-secondary">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Icon className="h-4 w-4" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold leading-tight">{title}</div>
        <div className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          {subtitle}
        </div>
        {exchanging && (
          <div className="mt-1.5 text-[11px] text-primary">
            Syncing your holdings…
          </div>
        )}
        {error && (
          <div className="mt-1.5 text-[11px] text-destructive">{error}</div>
        )}
      </div>
    </button>
  );
}
