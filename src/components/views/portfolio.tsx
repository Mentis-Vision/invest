"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Plus as PlusIcon,
  Link as LinkIcon,
  RefreshCw,
  Loader2,
  ChevronRight,
  Landmark,
  Layers,
  Filter,
  Pencil,
  Check as CheckIcon,
  X as XIcon,
} from "lucide-react";
import {
  getHoldings,
  invalidateAndRefresh,
  type Holding as CacheHolding,
} from "@/lib/client/holdings-cache";
import {
  DrillProvider,
  Drillable,
} from "@/components/dashboard/drill-context";
import DrillPanel from "@/components/dashboard/drill-panel";
import { ConnectPicker } from "@/components/brokerage/connect-picker";
import { FreshnessIndicator } from "@/components/dashboard/freshness-indicator";
import { sumMoney, normalizeWeights } from "@/lib/money";

/**
 * Portfolio — redesigned as a grouped drill-down view.
 *
 * Key capabilities:
 *   - Group-by dimensions:
 *       · Institution (Schwab, Fidelity, Coinbase...)
 *       · Institution + Account type (Schwab → IRA, 401k, Taxable)
 *       · Sector (Technology, Financials...)
 *       · Asset class (Equity, Crypto, ETF, Cash)
 *       · Flat list (no grouping)
 *   - Filter by account — checkbox each linked account; defaults all on
 *   - Summary row: total value, day change, positions, institutions
 *   - Expandable group headers: count · value · weight · day-change
 *   - Position rows still drillable into existing ticker/position panel
 *
 * Data source: the same /api/snaptrade/holdings payload the dashboard
 * uses — no new endpoints, just a smarter UI on top.
 */

type Holding = CacheHolding;

function money(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n >= 10000 ? 0 : 2,
  }).format(n);
}

function moneyCompact(n: number): string {
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function pct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}

// ─── Group detection ─────────────────────────────────────────────────

/** Standard account-type buckets we try to detect from freeform
 *  accountName strings. Brokers label these inconsistently — we match
 *  by keyword. */
function detectAccountType(accountName: string | null | undefined): string {
  if (!accountName) return "Default";
  const n = accountName.toUpperCase();
  if (/\bROTH\b/.test(n)) return "Roth IRA";
  if (/\bIRA\b/.test(n) || /RETIREMENT/i.test(n)) return "Traditional IRA";
  if (/401\s*[\-\(]?\s*K/.test(n)) return "401(k)";
  if (/403\s*[\-\(]?\s*B/.test(n)) return "403(b)";
  if (/HSA/.test(n)) return "HSA";
  if (/529/.test(n)) return "529 Plan";
  if (/\bBROKERAGE\b|\bINDIVIDUAL\b|\bTAXABLE\b|\bJOINT\b/.test(n))
    return "Taxable";
  if (/CHECKING|SAVINGS|CASH/.test(n)) return "Cash";
  return accountName;
}

type GroupKey = "institution_account" | "institution" | "sector" | "asset_class" | "flat";

type Group = {
  id: string;
  label: string;
  sublabel?: string;
  holdings: Holding[];
  totalValue: number;
};

function buildGroups(
  holdings: Holding[],
  by: GroupKey,
  aliases?: Record<string, string>
): Group[] {
  if (by === "flat") {
    return [
      {
        id: "all",
        label: "All positions",
        holdings,
        totalValue: sumMoney(...holdings.map((h) => h.value)),
      },
    ];
  }

  const buckets = new Map<string, Group>();
  for (const h of holdings) {
    // institution_account groups by the INDIVIDUAL account, not by
    // (institution, detected_type). The previous behavior collapsed
    // two Traditional IRAs at the same broker (e.g. Sang's and
    // Spouse's) into one bucket because the detected type was
    // identical — keying on raw accountName keeps them separate.
    const key =
      by === "institution"
        ? h.institutionName ?? "Unclassified"
        : by === "institution_account"
          ? `${h.institutionName ?? "Unclassified"}::${h.accountName ?? "Default"}`
          : by === "sector"
            ? h.sector ?? "Unclassified"
            : by === "asset_class"
              ? (h.assetClass ?? "Unclassified").toLowerCase()
              : "all";

    let g = buckets.get(key);
    if (!g) {
      // For per-account grouping, prefer the user's saved alias
      // ("Sang's IRA") over the auto-detected friendly type. The
      // alias is keyed by the same `institution::accountName` string
      // we use for grouping, so a stale alias for a renamed account
      // simply orphans rather than mis-labelling something.
      const aliasLabel =
        by === "institution_account" && aliases ? aliases[key] : undefined;
      const label =
        by === "institution_account"
          ? aliasLabel ?? detectAccountType(h.accountName)
          : by === "institution"
            ? h.institutionName ?? "Unclassified"
            : by === "sector"
              ? h.sector ?? "Unclassified"
              : (h.assetClass ?? "Unclassified").replace(/^\w/, (c) => c.toUpperCase());
      // For institution_account, the sublabel surfaces (in order):
      // institution · [type when alias replaces it] · accountName-when-distinct.
      // - If the user has set an alias, prepend the auto-detected
      //   type so they can still tell "Sang's IRA" is a Traditional
      //   IRA at a glance.
      // - Append the raw accountName when it adds info beyond the
      //   friendly type — that disambiguates Sang's vs Spouse's IRA
      //   at the same broker for users who haven't set aliases yet.
      let sublabel: string | undefined;
      if (by === "institution_account") {
        const institution = h.institutionName ?? "Unclassified";
        const detected = detectAccountType(h.accountName);
        const carriesExtra =
          !!h.accountName &&
          h.accountName.trim().toUpperCase() !== detected.toUpperCase();
        const parts = [institution];
        if (aliasLabel) parts.push(detected);
        if (carriesExtra && h.accountName) parts.push(h.accountName);
        sublabel = parts.join(" · ");
      }
      g = { id: key, label, sublabel, holdings: [], totalValue: 0 };
      buckets.set(key, g);
    }
    g.holdings.push(h);
    // sumMoney each running group total so the cents rounding happens
    // on every step — otherwise a 20-position group can drift into
    // the 0.01 range and disagree with the sum of shown per-position
    // dollars in the expanded view.
    g.totalValue = sumMoney(g.totalValue, h.value);
  }

  // Institution-aware sort for the per-account view: cluster all
  // accounts at the same broker together (sorted by the broker's
  // total AUM), then by per-account value within each broker. The
  // earlier value-only sort interleaved a small Coinbase wallet
  // between two Schwab accounts whenever its balance fell between
  // theirs.
  //
  // Defensive normalize: institutionName can come in slightly
  // different shapes from SnapTrade vs Plaid for the same broker
  // ("Charles Schwab" vs "Charles Schwab " vs "charles schwab"),
  // which would otherwise create two adjacent buckets that sort as
  // distinct institutions. Trim + lowercase for the sort key only;
  // displayed labels stay as-is.
  if (by === "institution_account") {
    const normInst = (g: Group) =>
      (g.id.split("::")[0] ?? "").trim().toLowerCase();
    const institutionTotals = new Map<string, number>();
    for (const g of buckets.values()) {
      const inst = normInst(g);
      institutionTotals.set(
        inst,
        sumMoney(institutionTotals.get(inst) ?? 0, g.totalValue)
      );
    }
    return [...buckets.values()].sort((a, b) => {
      const aInst = normInst(a);
      const bInst = normInst(b);
      if (aInst !== bInst) {
        const aT = institutionTotals.get(aInst) ?? 0;
        const bT = institutionTotals.get(bInst) ?? 0;
        if (aT !== bT) return bT - aT;
        return aInst.localeCompare(bInst);
      }
      return b.totalValue - a.totalValue;
    });
  }
  return [...buckets.values()].sort((a, b) => b.totalValue - a.totalValue);
}

// ─── Component ───────────────────────────────────────────────────────

export default function PortfolioView() {
  return (
    <DrillProvider>
      <PortfolioBody />
      <DrillPanel />
    </DrillProvider>
  );
}

function PortfolioBody() {
  const [loadingToken, setLoadingToken] = useState(false);
  const [loadingHoldings, setLoadingHoldings] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [brokerageBalance, setBrokerageBalance] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notConfiguredMessage, setNotConfiguredMessage] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);
  const pollingRef = useRef<number | null>(null);

  // ── Grouping + filter UI state ──
  const [groupBy, setGroupBy] = useState<GroupKey>("institution_account");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [excludedAccounts, setExcludedAccounts] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);

  // ── Account aliases (user-supplied display names) ──
  // Stored in user_profile.preferences.accountAliases keyed by
  // `${institutionName}::${accountName}`. Same key buildGroups uses,
  // so the override flows through naturally without any cross-keying.
  const [accountAliases, setAccountAliases] = useState<Record<string, string>>(
    {}
  );
  const [allPreferences, setAllPreferences] = useState<Record<string, unknown>>(
    {}
  );
  const [editingAliasKey, setEditingAliasKey] = useState<string | null>(null);
  const [editingAliasValue, setEditingAliasValue] = useState("");
  const [savingAlias, setSavingAlias] = useState(false);

  const loadHoldings = useCallback(async (force = false) => {
    setLoadingHoldings(true);
    try {
      const data = force ? await invalidateAndRefresh() : await getHoldings();
      if (data.message && !data.connected) {
        setNotConfiguredMessage(data.message);
      }
      setHoldings(data.holdings ?? []);
      setBrokerageBalance(data.brokerageBalance ?? null);
      setConnected(!!data.connected);
      setLastSyncedAt(data.lastSyncedAt ?? null);
    } catch {
      setError("Could not load holdings.");
    } finally {
      setLoadingHoldings(false);
    }
  }, []);

  useEffect(() => {
    loadHoldings();
  }, [loadHoldings]);

  // Load the user's saved preferences once so we can apply alias
  // overrides to group labels. Failure is non-fatal — we just fall
  // back to auto-detected types.
  useEffect(() => {
    let alive = true;
    fetch("/api/user/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive || !data?.profile) return;
        const prefs =
          (data.profile.preferences as Record<string, unknown> | undefined) ??
          {};
        setAllPreferences(prefs);
        const aliases = prefs.accountAliases;
        if (
          aliases &&
          typeof aliases === "object" &&
          !Array.isArray(aliases)
        ) {
          setAccountAliases(aliases as Record<string, string>);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Save (or clear) an alias for a single account. Sends the full
  // preferences blob because the profile endpoint replaces it
  // wholesale; partial writes would wipe excludedSectors/notes/etc.
  const saveAlias = useCallback(
    async (key: string, value: string) => {
      const trimmed = value.trim();
      const nextAliases: Record<string, string> = { ...accountAliases };
      if (trimmed) nextAliases[key] = trimmed.slice(0, 80);
      else delete nextAliases[key];

      // Optimistic — flip UI first, revert on failure.
      setAccountAliases(nextAliases);
      setSavingAlias(true);
      try {
        const res = await fetch("/api/user/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            preferences: { ...allPreferences, accountAliases: nextAliases },
          }),
        });
        if (!res.ok) throw new Error("save failed");
        const data = await res.json();
        const savedPrefs =
          (data.profile?.preferences as Record<string, unknown> | undefined) ??
          {};
        setAllPreferences(savedPrefs);
        const savedAliases = savedPrefs.accountAliases;
        if (
          savedAliases &&
          typeof savedAliases === "object" &&
          !Array.isArray(savedAliases)
        ) {
          setAccountAliases(savedAliases as Record<string, string>);
        }
      } catch {
        // Revert optimistic state.
        setAccountAliases(accountAliases);
      } finally {
        setSavingAlias(false);
        setEditingAliasKey(null);
        setEditingAliasValue("");
      }
    },
    [accountAliases, allPreferences]
  );

  useEffect(() => {
    return () => {
      if (pollingRef.current) window.clearInterval(pollingRef.current);
    };
  }, []);

  useEffect(() => {
    function onMessage(evt: MessageEvent) {
      if (evt.origin !== window.location.origin) return;
      const data = evt.data as { type?: string } | null;
      if (data?.type !== "snaptrade:connection_complete") return;
      if (popupRef.current && !popupRef.current.closed) {
        try {
          popupRef.current.close();
        } catch {
          /* opener-only close may be blocked */
        }
      }
      if (pollingRef.current) {
        window.clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      loadHoldings(true);
      fetch("/api/snaptrade/sync", { method: "POST" }).catch(() => {});
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [loadHoldings]);

  // ConnectPicker modal state — the first step of linking is now
  // picking between Plaid (traditional brokerage) and SnapTrade (retail
  // / crypto). The actual SnapTrade or Plaid flow starts inside the
  // picker option.
  const [pickerOpen, setPickerOpen] = useState(false);

  const startSnaptradeLink = useCallback(async () => {
    setError(null);
    setLoadingToken(true);
    try {
      const res = await fetch("/api/snaptrade/login-url", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "snaptrade_not_configured") {
          setNotConfiguredMessage(data.message);
          return;
        }
        setError(data.message ?? "Could not start brokerage linking.");
        return;
      }
      const url: string = data.loginUrl;
      const w = Math.min(window.innerWidth * 0.9, 720);
      const h = Math.min(window.innerHeight * 0.9, 820);
      const left = window.screenX + (window.innerWidth - w) / 2;
      const top = window.screenY + (window.innerHeight - h) / 2;
      const popup = window.open(
        url,
        "snaptrade-link",
        `width=${w},height=${h},left=${left},top=${top}`
      );
      popupRef.current = popup;
      if (!popup) {
        setError("Pop-up blocked. Enable pop-ups for this site, then try again.");
        return;
      }
      pollingRef.current = window.setInterval(async () => {
        if (popup.closed) {
          if (pollingRef.current) window.clearInterval(pollingRef.current);
          pollingRef.current = null;
          await loadHoldings(true);
          fetch("/api/snaptrade/sync", { method: "POST" }).catch(() => {});
        }
      }, 1000);
    } catch {
      setError("Could not reach our server. Try again in a moment.");
    } finally {
      setLoadingToken(false);
    }
  }, [loadHoldings]);

  const startLinking = useCallback(() => {
    setError(null);
    setPickerOpen(true);
  }, []);

  const handlePlaidSuccess = useCallback(
    async () => {
      // Holdings are already synced on the server by /api/plaid/exchange-
      // public-token. Just refresh the client cache to render them.
      await loadHoldings(true);
    },
    [loadHoldings]
  );

  const handleRefresh = useCallback(async () => {
    setSyncing(true);
    try {
      await fetch("/api/snaptrade/sync", { method: "POST" }).catch(() => {});
      await loadHoldings(true);
    } finally {
      setSyncing(false);
    }
  }, [loadHoldings]);

  // ── Derived ──
  const accounts = useMemo(() => {
    const set = new Map<string, { key: string; label: string; institution: string }>();
    for (const h of holdings) {
      const key = `${h.institutionName ?? "?"}::${h.accountName ?? "?"}`;
      if (!set.has(key)) {
        set.set(key, {
          key,
          label: h.accountName ?? "Default",
          institution: h.institutionName ?? "Unclassified",
        });
      }
    }
    return [...set.values()].sort((a, b) =>
      a.institution.localeCompare(b.institution) ||
      a.label.localeCompare(b.label)
    );
  }, [holdings]);

  const filteredHoldings = useMemo(() => {
    if (excludedAccounts.size === 0) return holdings;
    return holdings.filter(
      (h) =>
        !excludedAccounts.has(`${h.institutionName ?? "?"}::${h.accountName ?? "?"}`)
    );
  }, [holdings, excludedAccounts]);

  const filteredTotal = useMemo(
    () => sumMoney(...filteredHoldings.map((h) => h.value)),
    [filteredHoldings]
  );

  const groups = useMemo(
    () => buildGroups(filteredHoldings, groupBy, accountAliases),
    [filteredHoldings, groupBy, accountAliases]
  );

  function toggleCollapse(id: string) {
    setCollapsed((c) => ({ ...c, [id]: !c[id] }));
  }
  function toggleAccount(key: string) {
    setExcludedAccounts((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      <ConnectPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onStartSnaptrade={startSnaptradeLink}
        onPlaidSuccess={handlePlaidSuccess}
      />
      {/* Header */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-foreground">
            My Portfolio
          </h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-muted-foreground">
            <span>Everything you hold, grouped however you want to look at it.</span>
            {connected && (
              <FreshnessIndicator lastSyncedAt={lastSyncedAt} />
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {connected && (
            <button
              onClick={handleRefresh}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-[12px] font-medium text-foreground/80 hover:border-primary/50 hover:text-foreground disabled:opacity-60"
            >
              {syncing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Refresh
            </button>
          )}
          <button
            onClick={startLinking}
            disabled={loadingToken}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-60"
          >
            {loadingToken ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <LinkIcon className="h-3.5 w-3.5" />
            )}
            {connected ? "Link another" : "Connect Brokerage"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-[13px] text-destructive">
          {error}
        </div>
      )}
      {notConfiguredMessage && !connected && (
        <div className="rounded-md border border-border bg-card px-3 py-2.5 text-[13px] text-muted-foreground">
          <span className="font-medium text-foreground">
            Brokerage linking not available.
          </span>{" "}
          {notConfiguredMessage}
        </div>
      )}

      {/* Summary strip */}
      {connected && holdings.length > 0 && (
        <div className="grid grid-cols-2 gap-3 rounded-[10px] border border-border bg-card p-4 sm:grid-cols-4">
          <Stat label="Total value" value={money(filteredTotal)} />
          <Stat
            label="Positions"
            value={String(filteredHoldings.length)}
            hint={
              filteredHoldings.length !== holdings.length
                ? `of ${holdings.length}`
                : undefined
            }
          />
          <Stat
            label="Institutions"
            value={String(
              new Set(filteredHoldings.map((h) => h.institutionName ?? "?")).size
            )}
          />
          <Stat
            label="Accounts"
            value={String(accounts.length)}
            hint={brokerageBalance ? `balance ${moneyCompact(brokerageBalance)}` : undefined}
          />
        </div>
      )}

      {/* Controls */}
      {connected && holdings.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Group by
            </span>
            <GroupSelector value={groupBy} onChange={setGroupBy} />
          </div>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
              showFilters || excludedAccounts.size > 0
                ? "border-primary/50 bg-primary/5 text-primary"
                : "border-border bg-card text-foreground/80 hover:border-primary/50"
            }`}
          >
            <Filter className="h-3.5 w-3.5" />
            Accounts{" "}
            {excludedAccounts.size > 0
              ? `(${accounts.length - excludedAccounts.size} of ${accounts.length})`
              : `(${accounts.length})`}
          </button>
        </div>
      )}

      {/* Account filter panel */}
      {showFilters && connected && (
        <div className="rounded-[10px] border border-primary/30 bg-primary/5 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-primary">
              Show / hide accounts
            </span>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setExcludedAccounts(new Set())}
                className="rounded text-[11px] text-primary underline-offset-4 hover:underline"
              >
                All on
              </button>
              <span className="text-[11px] text-muted-foreground">·</span>
              <button
                type="button"
                onClick={() =>
                  setExcludedAccounts(new Set(accounts.map((a) => a.key)))
                }
                className="rounded text-[11px] text-primary underline-offset-4 hover:underline"
              >
                All off
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {accounts.map((a) => {
              const active = !excludedAccounts.has(a.key);
              return (
                <label
                  key={a.key}
                  className={`flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-[12px] transition-colors ${
                    active
                      ? "border-border bg-card"
                      : "border-border/60 bg-secondary/30 opacity-60"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => toggleAccount(a.key)}
                    className="h-3.5 w-3.5 accent-[var(--primary)]"
                  />
                  <span className="flex-1 truncate">
                    <span className="text-foreground">{a.label}</span>
                    <span className="ml-1.5 text-muted-foreground">
                      · {a.institution}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* Grouped body */}
      {loadingHoldings ? (
        <div className="flex items-center justify-center rounded-[10px] border border-border bg-card py-12">
          <Loader2 className="mr-2 h-4 w-4 animate-spin text-muted-foreground" />
          <span className="text-[13px] text-muted-foreground">Loading your positions…</span>
        </div>
      ) : holdings.length === 0 ? (
        <EmptyState onConnect={startLinking} loading={loadingToken} />
      ) : (
        <div className="space-y-3">
          {(() => {
            // Compute all group weights in a single largest-remainder
            // pass so the column sums to exactly 100% across groups.
            // Otherwise five 20% groups render as 20.0/20.0/20.0/20.0/19.9
            // and users wonder why their portfolio adds up to 99.9%.
            const groupWeights = normalizeWeights(
              groups.map((g) => g.totalValue),
              1
            );
            return groups.map((g, gIdx) => {
              const isFlat = groupBy === "flat";
              const isCollapsed = collapsed[g.id] ?? false;
              const weight = groupWeights[gIdx] ?? 0;
              return (
              <section
                key={g.id}
                className="overflow-hidden rounded-[10px] border border-border bg-card"
              >
                {!isFlat && (
                  <GroupHeader
                    group={g}
                    weight={weight}
                    isCollapsed={isCollapsed}
                    onToggleCollapse={() => toggleCollapse(g.id)}
                    groupBy={groupBy}
                    canRename={groupBy === "institution_account"}
                    isEditing={editingAliasKey === g.id}
                    onStartEdit={() => {
                      setEditingAliasKey(g.id);
                      setEditingAliasValue(accountAliases[g.id] ?? "");
                    }}
                    editingValue={editingAliasValue}
                    onEditingValueChange={setEditingAliasValue}
                    onSave={() => saveAlias(g.id, editingAliasValue)}
                    onCancel={() => {
                      setEditingAliasKey(null);
                      setEditingAliasValue("");
                    }}
                    onClearAlias={
                      accountAliases[g.id]
                        ? () => saveAlias(g.id, "")
                        : undefined
                    }
                    saving={savingAlias}
                  />
                )}
                {!isCollapsed && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[12.5px]">
                      <thead>
                        <tr className="border-b border-border text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                          <th className="px-4 py-2 text-left font-medium">Ticker</th>
                          <th className="px-2 py-2 text-left font-medium">Name</th>
                          <th className="px-2 py-2 text-right font-medium font-mono">
                            Shares
                          </th>
                          <th className="px-2 py-2 text-right font-medium font-mono">
                            Price
                          </th>
                          <th className="px-2 py-2 text-right font-medium font-mono">
                            Value
                          </th>
                          {groupBy !== "institution_account" && (
                            <th className="px-4 py-2 text-left font-medium">Account</th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {g.holdings
                          .slice()
                          .sort((a, b) => b.value - a.value)
                          .map((h, i) => (
                            <tr
                              key={`${h.ticker}-${h.accountName}-${i}`}
                              className="border-b border-border/60 last:border-b-0 hover:bg-secondary/30"
                            >
                              <td className="px-4 py-2.5 font-mono font-semibold text-foreground">
                                <Drillable
                                  target={{ kind: "position", holding: h }}
                                  ariaLabel={`Open ${h.ticker} position detail`}
                                  className="!p-0"
                                >
                                  {h.ticker}
                                </Drillable>
                              </td>
                              <td className="px-2 py-2.5 text-muted-foreground">
                                <Drillable
                                  target={{ kind: "ticker", ticker: h.ticker }}
                                  ariaLabel={`Open ${h.ticker} warehouse detail`}
                                  as="span"
                                  className="!block !p-0 !hover:no-underline"
                                >
                                  <span className="block truncate">{h.name}</span>
                                  {h.sector && (
                                    <span className="mt-0.5 block text-[10px] text-muted-foreground/70">
                                      {h.sector}
                                      {h.industry ? ` · ${h.industry}` : ""}
                                    </span>
                                  )}
                                </Drillable>
                              </td>
                              <td className="px-2 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                                {h.shares.toLocaleString("en-US", {
                                  maximumFractionDigits: 4,
                                })}
                              </td>
                              <td className="px-2 py-2.5 text-right font-mono tabular-nums">
                                {money(h.price)}
                              </td>
                              <td className="px-2 py-2.5 text-right font-mono tabular-nums font-medium">
                                <Drillable
                                  target={{ kind: "position", holding: h }}
                                  ariaLabel={`Open ${h.ticker} position detail`}
                                  className="!p-0 !inline-block"
                                >
                                  {money(h.value)}
                                </Drillable>
                              </td>
                              {groupBy !== "institution_account" && (
                                <td className="px-4 py-2.5 text-[11px] text-muted-foreground">
                                  {h.institutionName ?? "—"}
                                  {h.accountName && (
                                    <span className="block text-muted-foreground/70">
                                      {h.accountName}
                                    </span>
                                  )}
                                </td>
                              )}
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
            });
          })()}
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Brokerage data is read-only via SnapTrade. We never initiate trades or
        move money. Positions reflect your last sync.
      </p>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-mono text-[18px] font-semibold tracking-[-0.015em] text-foreground">
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 text-[10px] text-muted-foreground">{hint}</div>
      )}
    </div>
  );
}

/**
 * Group header — renders the collapsing label/value strip at the top
 * of each portfolio bucket. For the per-account view it also exposes
 * an inline rename affordance: pencil icon on hover → text input →
 * Enter/check saves, Esc/X cancels, an "x" next to the saved alias
 * clears back to the auto-detected type.
 *
 * Split out from the parent so the rename input can own its own
 * focus / keyboard handling without needing portals or refs into the
 * massive PortfolioBody render. The collapse toggle lives on a
 * dedicated button now (not the whole row) so clicking the rename
 * controls doesn't accidentally fold the section.
 */
function GroupHeader({
  group,
  weight,
  isCollapsed,
  onToggleCollapse,
  groupBy,
  canRename,
  isEditing,
  onStartEdit,
  editingValue,
  onEditingValueChange,
  onSave,
  onCancel,
  onClearAlias,
  saving,
}: {
  group: Group;
  weight: number;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  groupBy: GroupKey;
  canRename: boolean;
  isEditing: boolean;
  onStartEdit: () => void;
  editingValue: string;
  onEditingValueChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onClearAlias?: () => void;
  saving: boolean;
}) {
  return (
    <div
      className="group/header flex w-full items-center gap-3 border-b border-border px-4 py-3"
      // Click anywhere outside the rename controls to toggle collapse.
      // The rename button + input call stopPropagation so they don't
      // accidentally fold the row when clicked.
      onClick={(e) => {
        if (isEditing) return;
        const target = e.target as HTMLElement;
        if (target.closest("[data-rename-control]")) return;
        onToggleCollapse();
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (isEditing) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggleCollapse();
        }
      }}
    >
      <ChevronRight
        className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
          isCollapsed ? "" : "rotate-90"
        }`}
      />
      <GroupIcon by={groupBy} />
      <div className="min-w-0 flex-1">
        {isEditing ? (
          <div
            data-rename-control
            className="flex items-center gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              autoFocus
              type="text"
              value={editingValue}
              onChange={(e) => onEditingValueChange(e.target.value.slice(0, 80))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onSave();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  onCancel();
                }
              }}
              placeholder="e.g. Sang's IRA"
              maxLength={80}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-[14px] outline-none focus:border-foreground/40"
              disabled={saving}
            />
            <button
              type="button"
              data-rename-control
              onClick={onSave}
              disabled={saving}
              className="rounded-md p-1 text-foreground hover:bg-secondary/60"
              aria-label="Save alias"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckIcon className="h-4 w-4" />
              )}
            </button>
            <button
              type="button"
              data-rename-control
              onClick={onCancel}
              disabled={saving}
              className="rounded-md p-1 text-muted-foreground hover:bg-secondary/60"
              aria-label="Cancel rename"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[14px] font-semibold text-foreground">
              {group.label}
            </span>
            {canRename && (
              <button
                type="button"
                data-rename-control
                onClick={(e) => {
                  e.stopPropagation();
                  onStartEdit();
                }}
                className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
                aria-label={
                  onClearAlias ? "Edit account name" : "Rename this account"
                }
                title={onClearAlias ? "Edit name" : "Rename"}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
            {canRename && onClearAlias && (
              <button
                type="button"
                data-rename-control
                onClick={(e) => {
                  e.stopPropagation();
                  onClearAlias();
                }}
                className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
                aria-label="Clear custom name"
                title="Reset to auto-detected name"
              >
                reset
              </button>
            )}
            {group.sublabel && (
              <span className="truncate text-[12px] text-muted-foreground">
                · {group.sublabel}
              </span>
            )}
          </div>
        )}
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {group.holdings.length} position{group.holdings.length === 1 ? "" : "s"}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="font-mono text-[14px] font-semibold text-foreground">
          {money(group.totalValue)}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {pct(weight)} of filtered
        </div>
      </div>
    </div>
  );
}

function GroupSelector({
  value,
  onChange,
}: {
  value: GroupKey;
  onChange: (v: GroupKey) => void;
}) {
  const opts: Array<{ v: GroupKey; label: string }> = [
    { v: "institution_account", label: "Broker + account" },
    { v: "institution", label: "Broker" },
    { v: "sector", label: "Sector" },
    { v: "asset_class", label: "Asset class" },
    { v: "flat", label: "Flat list" },
  ];
  return (
    <div className="inline-flex rounded-md border border-border bg-card p-0.5">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={`rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
            value === o.v
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function GroupIcon({ by }: { by: GroupKey }) {
  const Icon = by === "institution" || by === "institution_account" ? Landmark : Layers;
  return (
    <span
      aria-hidden
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground"
    >
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}

function EmptyState({
  onConnect,
  loading,
}: {
  onConnect: () => void;
  loading: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[10px] border border-dashed border-border bg-card py-14 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
        <PlusIcon className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="text-[14px] font-medium text-foreground">No holdings yet</h3>
      <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
        Connect your brokerage account to sync your portfolio automatically.
        Read-only access — we never move money or place trades.
      </p>
      <button
        onClick={onConnect}
        disabled={loading}
        className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
      >
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Connect Brokerage
      </button>
    </div>
  );
}
