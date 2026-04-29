"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  Building2,
  X,
  Coins,
  Loader2,
  Search,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { usePlaidLink } from "react-plaid-link";
import {
  INSTITUTIONS,
  POPULAR_INSTITUTIONS,
  searchInstitutions,
  type Institution,
  type Provider,
} from "./institutions";

/**
 * Connect picker modal — unified institution search.
 *
 * User types their broker, we route behind the scenes. No "pick between
 * Plaid and SnapTrade" decision is exposed to the user. Each institution
 * in `institutions.ts` is tagged with its provider; clicking the row
 * launches the right flow.
 *
 * Routing rule:
 *   - Plaid-first where Plaid supports the institution
 *   - SnapTrade fallback for crypto exchanges + institutions Plaid
 *     doesn't cover (Questrade, Wealthsimple, etc.)
 */
export type ConnectPickerProps = {
  open: boolean;
  onClose: () => void;
  /** Launches SnapTrade OAuth. Used for crypto + alt brokers. */
  onStartSnaptrade: () => void;
  /** Fires after Plaid Link succeeds and our exchange call returns. */
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
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Reset transient state every time the modal opens fresh.
  useEffect(() => {
    if (open) {
      const resetTimer = setTimeout(() => {
        setQuery("");
        setSelectedId(null);
        setError(null);
      }, 0);
      // Autofocus search on open — most users will type immediately.
      const focusTimer = setTimeout(() => searchRef.current?.focus(), 50);
      return () => {
        clearTimeout(resetTimer);
        clearTimeout(focusTimer);
      };
    }
  }, [open]);

  const filteredResults = useMemo(() => searchInstitutions(query), [query]);
  const showPopular = query.trim().length === 0;

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
      <div className="relative flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Header */}
        <div className="px-6 pb-3 pt-6">
          <div className="flex items-center gap-2.5">
            <Image
              src="/logo.png"
              alt=""
              aria-hidden="true"
              width={32}
              height={32}
              className="h-8 w-8 flex-shrink-0 rounded-md object-contain"
            />
            <h2
              id="connect-title"
              className="text-[20px] font-semibold tracking-tight"
            >
              Connect a brokerage
            </h2>
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            Read-only access — no one can trade on your behalf.
          </p>
        </div>

        {/* Search */}
        <div className="px-6 pb-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your broker or exchange"
              className="h-11 w-full rounded-lg border border-border bg-background pl-10 pr-3 text-[14px] outline-none transition-colors focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>

        {/* Results list */}
        <div className="flex-1 overflow-y-auto px-6 pb-4">
          {showPopular && (
            <>
              <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                <Sparkles className="h-3 w-3" />
                Popular
              </div>
              <div className="mb-5 flex flex-wrap gap-1.5">
                {POPULAR_INSTITUTIONS.map((inst) => (
                  <PopularChip
                    key={inst.id}
                    inst={inst}
                    selected={selectedId === inst.id}
                    onSelect={setSelectedId}
                  />
                ))}
              </div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                All institutions
              </div>
            </>
          )}

          {filteredResults.length === 0 ? (
            <EmptyState query={query} />
          ) : (
            <ul className="divide-y divide-border/50">
              {filteredResults.map((inst) => (
                <InstitutionRow
                  key={inst.id}
                  inst={inst}
                  selected={selectedId === inst.id}
                  onSelect={setSelectedId}
                />
              ))}
            </ul>
          )}
        </div>

        {/* Provider launcher (hidden mechanics) */}
        {selectedId && (
          <ProviderLauncher
            institution={INSTITUTIONS.find((i) => i.id === selectedId)!}
            onCancel={() => setSelectedId(null)}
            onError={(msg) => {
              setError(msg);
              setSelectedId(null);
            }}
            onStartSnaptrade={() => {
              onStartSnaptrade();
              onClose();
            }}
            onPlaidSuccess={(r) => {
              onPlaidSuccess?.(r);
              onClose();
            }}
          />
        )}

        {/* Footer */}
        <div className="border-t border-border bg-secondary/20 px-6 py-3">
          {error ? (
            <p className="text-[12px] text-destructive" role="alert">
              {error}
            </p>
          ) : (
            <>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Secured by <span className="font-semibold text-foreground/75">Plaid</span> and{" "}
                <span className="font-semibold text-foreground/75">SnapTrade</span> — the
                same bank-grade connectors used by Venmo, Robinhood, and
                hundreds of finance apps. Your login credentials never touch
                our servers.
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Don&rsquo;t see your broker? Start typing — we cover 12,000+
                institutions via our connectors.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Popular chip ─────────────────────────────────────────────────────

function PopularChip({
  inst,
  selected,
  onSelect,
}: {
  inst: Institution;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(inst.id)}
      disabled={selected}
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-[12px] font-medium transition-colors hover:border-primary/50 hover:bg-primary/5 disabled:opacity-60"
    >
      {selected ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : inst.kind === "crypto" ? (
        <Coins className="h-3 w-3 text-muted-foreground" />
      ) : (
        <Building2 className="h-3 w-3 text-muted-foreground" />
      )}
      {inst.name}
    </button>
  );
}

// ─── Institution row ──────────────────────────────────────────────────

function InstitutionRow({
  inst,
  selected,
  onSelect,
}: {
  inst: Institution;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const kindLabel =
    inst.kind === "crypto"
      ? "Crypto"
      : inst.kind === "robo"
        ? "Robo"
        : "Broker";

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(inst.id)}
        disabled={selected}
        className="flex w-full items-center gap-3 py-2.5 text-left transition-colors hover:bg-secondary/40 disabled:opacity-60"
      >
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-secondary">
          {selected ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : inst.kind === "crypto" ? (
            <Coins className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Building2 className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium leading-tight">
            {inst.name}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {kindLabel}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </button>
    </li>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────

function EmptyState({ query }: { query: string }) {
  return (
    <div className="py-8 text-center">
      <p className="text-[13px] font-medium">
        No match for &ldquo;{query}&rdquo;
      </p>
      <p className="mt-2 text-[12px] text-muted-foreground">
        Try a shorter term, or email{" "}
        <a
          href="mailto:support@clearpathinvest.app"
          className="underline underline-offset-2"
        >
          support@clearpathinvest.app
        </a>{" "}
        and we&rsquo;ll add your broker.
      </p>
    </div>
  );
}

// ─── Provider launcher ────────────────────────────────────────────────

/**
 * Mounted only when the user has selected an institution. Decides which
 * provider to launch based on the institution's `provider` tag, fetches
 * the link token (Plaid) or kicks off the OAuth redirect (SnapTrade),
 * and bubbles success/error back to the parent.
 *
 * Split out from the main component so Plaid's `usePlaidLink` hook
 * only initializes on demand (no wasted link_token per modal open).
 */
function ProviderLauncher({
  institution,
  onCancel,
  onError,
  onStartSnaptrade,
  onPlaidSuccess,
}: {
  institution: Institution;
  onCancel: () => void;
  onError: (msg: string) => void;
  onStartSnaptrade: () => void;
  onPlaidSuccess: (result: {
    itemId: string;
    institutionName: string | null;
    holdings: number;
  }) => void;
}) {
  const provider: Provider = institution.provider;

  // SnapTrade path: fire immediately, no token fetch from our side.
  // Parent closes the modal and navigates to SnapTrade's portal.
  useEffect(() => {
    if (provider === "snaptrade") {
      onStartSnaptrade();
    }
  }, [provider, onStartSnaptrade]);

  if (provider === "snaptrade") return null;

  return (
    <PlaidBoot
      onCancel={onCancel}
      onError={onError}
      onPlaidSuccess={onPlaidSuccess}
    />
  );
}

/**
 * Fetches a Plaid link_token and opens Plaid Link as soon as it's ready.
 * Persists the token to localStorage so the /plaid-oauth return page
 * can resume the flow for OAuth institutions (Schwab, Fidelity, etc.).
 *
 * Mounted only once, when the user has selected a Plaid institution.
 * Unmounted on cancel or error.
 */
function PlaidBoot({
  onCancel,
  onError,
  onPlaidSuccess,
}: {
  onCancel: () => void;
  onError: (msg: string) => void;
  onPlaidSuccess: (result: {
    itemId: string;
    institutionName: string | null;
    holdings: number;
  }) => void;
}) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [exchanging, setExchanging] = useState(false);
  const openedRef = useRef(false);

  // Fetch the link_token once on mount.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/plaid/link-token", { method: "POST" });
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) {
          if (res.status === 402 && data.error === "item_cap_reached") {
            onError(
              data.message ??
                `You've linked ${data.used} of ${data.max} brokerages on your ${data.tier} plan.`
            );
            return;
          }
          onError(
            data.message ??
              data.error ??
              "Brokerage linking is not available right now."
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
        if (alive) onError("Could not reach our server. Try again.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [onError]);

  const { open: openPlaid, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: async (publicToken) => {
      setExchanging(true);
      try {
        localStorage.removeItem("plaid_link_token");
      } catch {
        /* ignore */
      }
      try {
        const res = await fetch("/api/plaid/exchange-public-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ publicToken }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          onError(data.error ?? "Could not link this account.");
          return;
        }
        const data = (await res.json()) as {
          itemId: string;
          institutionName: string | null;
          holdings: number;
        };
        onPlaidSuccess(data);
      } catch {
        onError("Network error. Try again.");
      } finally {
        setExchanging(false);
      }
    },
    onExit: (err) => {
      try {
        localStorage.removeItem("plaid_link_token");
      } catch {
        /* ignore */
      }
      if (err) {
        onError(err.display_message ?? err.error_message ?? "Linking cancelled.");
      } else {
        onCancel();
      }
    },
  });

  // Auto-open Plaid as soon as the SDK is ready with our token.
  useEffect(() => {
    if (!ready || !linkToken || openedRef.current || exchanging) return;
    openedRef.current = true;
    openPlaid();
  }, [ready, linkToken, exchanging, openPlaid]);

  return null;
}
