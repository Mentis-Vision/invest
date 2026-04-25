"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, X } from "lucide-react";
import { usePlaidLink } from "react-plaid-link";

/**
 * Reauth banner for Plaid Items stuck in `login_required` state.
 *
 * Why this exists (financial-app context):
 *   When Plaid's connection to a user's brokerage expires or the user
 *   changes their password at the brokerage, the Item drops into
 *   `login_required` state. Without a visible nudge, users see
 *   increasingly stale holdings for days or weeks before noticing.
 *   This banner surfaces at the top of /app on every view so a broken
 *   connection is impossible to miss.
 *
 * Behavior:
 *   - Fetches /api/plaid/items on mount, refetches on dismissal-reset
 *   - Shows one banner per institution needing reauth
 *   - Click "Reconnect now" → fetches a reauth-flavored link_token
 *     and opens Plaid Link inline. On success, /api/plaid/webhook
 *     will fire an HISTORICAL_UPDATE shortly after and refresh data.
 *   - User can dismiss for the current session (X button), banner
 *     returns on next page load / item list refetch.
 */

type PlaidItem = {
  id: string;
  itemId: string;
  institutionName: string | null;
  status: string;
  statusDetail: string | null;
  lastSyncedAt: string | null;
  lastWebhookAt: string | null;
  createdAt: string;
  holdingsCount: number;
};

export function ReauthBanner() {
  const [items, setItems] = useState<PlaidItem[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  // Fetch Plaid items once on mount. Keep it cheap — this runs on
  // every /app render.
  useEffect(() => {
    let alive = true;
    fetch("/api/plaid/items")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.items) return;
        const needsAttention = (d.items as PlaidItem[]).filter(
          (i) => i.status === "login_required" || i.status === "sync_failed"
        );
        setItems(needsAttention);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!loaded || items.length === 0) return null;

  const visible = items.filter((i) => !dismissed.has(i.itemId));
  if (visible.length === 0) return null;

  return (
    <div className="space-y-2">
      {visible.map((item) => (
        <ReauthCard
          key={item.itemId}
          item={item}
          onDismiss={() =>
            setDismissed((prev) => new Set(prev).add(item.itemId))
          }
          onReconnected={() =>
            setItems((prev) =>
              prev.filter((i) => i.itemId !== item.itemId)
            )
          }
        />
      ))}
    </div>
  );
}

function ReauthCard({
  item,
  onDismiss,
  onReconnected,
}: {
  item: PlaidItem;
  onDismiss: () => void;
  onReconnected: () => void;
}) {
  const isSyncFailed = item.status === "sync_failed";
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openedRef = useRef(false);

  const { open: openPlaid, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: async () => {
      // Reauth flow: Plaid internally updates the Item; no new
      // public_token exchange needed. Our webhook will receive a
      // HISTORICAL_UPDATE shortly and re-sync holdings.
      onReconnected();
    },
    onExit: (err) => {
      if (err) {
        setError(err.display_message ?? err.error_message ?? null);
      }
    },
  });

  // Start reauth: request a reauth-flavored link_token with the
  // existing itemId, then open Plaid Link. For sync_failed items,
  // try a manual sync retry first — if the sync works, the Item
  // heals itself without a relink (syncHoldings flips status back
  // to 'active' on success).
  const handleReconnect = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      // For sync_failed, attempt a silent retry before pushing the
      // user through a full Plaid Link re-auth flow.
      if (isSyncFailed) {
        const retry = await fetch("/api/plaid/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "sync", itemId: item.itemId }),
        });
        if (retry.ok) {
          onReconnected();
          return;
        }
        // Fall through to reauth if the retry also fails — the
        // connection may actually be broken, not just a transient.
      }
      const res = await fetch("/api/plaid/link-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reauth: true, itemId: item.itemId }),
      });
      const data = await res.json();
      if (!res.ok || !data.linkToken) {
        setError(
          data.message ?? data.error ?? "Couldn't start reconnect."
        );
        return;
      }
      setLinkToken(data.linkToken);
      try {
        localStorage.setItem("plaid_link_token", data.linkToken);
      } catch {
        /* ignore */
      }
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }, [item.itemId, isSyncFailed, onReconnected]);

  // Open Plaid Link as soon as the SDK is ready with our reauth token.
  useEffect(() => {
    if (!ready || !linkToken || openedRef.current) return;
    openedRef.current = true;
    openPlaid();
  }, [ready, linkToken, openPlaid]);

  const subjectName = item.institutionName ?? "Your brokerage";

  return (
    <div
      role="alert"
      className="relative rounded-lg border border-[var(--hold,theme(colors.amber.500))]/40 bg-[var(--hold,theme(colors.amber.500))]/5 p-4"
    >
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <div className="flex items-start gap-3 pr-6">
        <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-[var(--hold,theme(colors.amber.600))]" />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold">
            {isSyncFailed
              ? `Sync failed for ${subjectName}`
              : `Reconnect ${subjectName}`}
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            {item.statusDetail
              ? `${item.statusDetail} `
              : isSyncFailed
                ? "We couldn't pull your holdings on the last attempt. "
                : "Your connection expired or needs re-approval. "}
            {isSyncFailed
              ? "Tap retry — if it's a transient issue the sync will heal itself."
              : "Until you reconnect, holdings for this account won\u2019t update."}
          </p>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={handleReconnect}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-[12px] font-semibold text-background transition-colors hover:bg-foreground/85 disabled:opacity-60"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {isSyncFailed ? "Retry sync" : "Reconnect now"}
            </button>
            {item.lastSyncedAt && (
              <span className="text-[11px] text-muted-foreground">
                Last synced{" "}
                {new Date(item.lastSyncedAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            )}
          </div>
          {error && (
            <p className="mt-2 text-[11px] text-destructive">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}
