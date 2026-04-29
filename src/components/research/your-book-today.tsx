"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Flame, TrendingUp, TrendingDown } from "lucide-react";

/**
 * "Movers in your book" — surfaces the top gainer + top loser in the
 * user's own portfolio for the current session.
 *
 * Complements MarketPulse (broad-market context) and DossierHero
 * (single-ticker spotlight). Clicking either tile routes to research
 * for that symbol.
 *
 * Renders nothing when:
 *   - User has no holdings (nothing to show)
 *   - All holdings are flat (no interesting movers)
 *   - Ticker-tape endpoint fails (peripheral signal; don't error)
 */

type TapeHolding = {
  symbol: string;
  label: string;
  price: number;
  changePct: number;
  up: boolean;
  kind: "index" | "holding";
};

export function YourBookToday({
  onSeeAll,
}: {
  onSeeAll?: () => void;
}) {
  const [items, setItems] = useState<TapeHolding[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch("/api/ticker-tape")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        const all = (d?.items ?? []) as TapeHolding[];
        setItems(all.filter((x) => x.kind === "holding"));
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return null;
  if (items.length === 0) return null;

  // Require at least one non-zero mover to avoid a flat-market empty
  // card.
  const sorted = [...items].sort((a, b) => b.changePct - a.changePct);
  const topGain = sorted[0];
  const topLoss = sorted[sorted.length - 1];
  if (!topGain || !topLoss) return null;
  if (topGain.changePct === 0 && topLoss.changePct === 0) return null;

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            <Flame className="h-3 w-3 text-[var(--hold)]" />
            Movers in your book
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground/80">
            Today&rsquo;s biggest gainer and loser across your holdings.
          </div>
        </div>
        {onSeeAll ? (
          <button
            type="button"
            onClick={onSeeAll}
            className="text-[11px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            See all →
          </button>
        ) : (
          <Link
            href="/app?view=portfolio"
            className="text-[11px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            See all →
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <MoverTile tile={topGain} direction="up" />
        <MoverTile tile={topLoss} direction="down" />
      </div>
    </div>
  );
}

function MoverTile({
  tile,
  direction,
}: {
  tile: TapeHolding;
  direction: "up" | "down";
}) {
  const tone =
    direction === "up"
      ? "border-[var(--buy)]/20 bg-[var(--buy)]/5"
      : "border-[var(--sell)]/20 bg-[var(--sell)]/5";
  const Icon = direction === "up" ? TrendingUp : TrendingDown;
  const label = direction === "up" ? "Top gainer" : "Top loser";
  const changeColor =
    tile.changePct > 0
      ? "text-[var(--buy)]"
      : tile.changePct < 0
        ? "text-[var(--sell)]"
        : "text-muted-foreground";

  return (
    <Link
      href={`/app?view=research&ticker=${encodeURIComponent(tile.symbol)}`}
      className={`block rounded-md border ${tone} p-3 transition-colors hover:bg-[var(--card)]`}
    >
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className="flex items-center gap-1">
          <Icon className="h-3 w-3" />
          {label}
        </span>
      </div>
      <div className="mt-1.5 flex items-baseline justify-between">
        <span className="font-mono text-[18px] font-semibold tracking-tight">
          {tile.symbol}
        </span>
        <span className={`font-mono text-[13px] font-medium ${changeColor}`}>
          {tile.changePct > 0 ? "+" : ""}
          {tile.changePct.toFixed(2)}%
        </span>
      </div>
      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
        $
        {tile.price >= 1000
          ? tile.price.toLocaleString("en-US", { maximumFractionDigits: 2 })
          : tile.price.toFixed(2)}
      </div>
    </Link>
  );
}
