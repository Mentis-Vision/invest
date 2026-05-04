"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Telescope } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { LookCloserCard } from "@/lib/research/look-closer-loader";

/**
 * "Look closer at your holdings" — Phase 8 replacement for the
 * top-gainer / top-loser YourBookToday strip.
 *
 * Surfaces up to 8 holdings tagged with a single primary "why" each:
 * earnings T-X, stale-research, concentration breach, or top-mover
 * fallback. Loader composes the cards server-side via
 * /api/research/look-closer; this component just renders them.
 *
 * Empty state when the user has no holdings or nothing meaningful
 * fires today: a friendly nudge toward the sector rail. Hidden during
 * the initial fetch to avoid layout flash.
 *
 * Each card is a Link (no JS-only navigation) so middle-click /
 * cmd-click open the research view in a new tab — same pattern as
 * the original YourBookToday tiles.
 */

export function LookCloserAtHoldings() {
  const [cards, setCards] = useState<LookCloserCard[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/research/look-closer")
      .then((r) => (r.ok ? r.json() : { cards: [] }))
      .then((d: { cards?: LookCloserCard[] }) => {
        if (!alive) return;
        setCards(Array.isArray(d?.cards) ? d.cards : []);
      })
      .catch(() => {
        if (alive) setCards([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Don't flash anything during the first fetch — the strip occupies
  // significant vertical space, so a phantom skeleton would jolt the
  // page above it. Render nothing until we have a real answer.
  if (cards === null) return null;

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            <Telescope className="h-3 w-3 text-[var(--hold)]" />
            Look closer at your holdings
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground/80">
            Positions worth a deeper look right now — earnings, stale
            research, concentration, or outsized moves.
          </div>
        </div>
      </div>

      {cards.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {cards.map((c) => (
            <CloserTile key={`${c.reasonType}-${c.ticker}`} card={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function CloserTile({ card }: { card: LookCloserCard }) {
  const changeColor =
    card.changePct === null
      ? "text-muted-foreground"
      : card.changePct > 0
        ? "text-[var(--buy)]"
        : card.changePct < 0
          ? "text-[var(--sell)]"
          : "text-muted-foreground";

  return (
    <Link
      href={`/app?view=research&ticker=${encodeURIComponent(card.ticker)}`}
      className="group block"
    >
      <Card className="transition-colors hover:bg-[var(--card)]">
        <CardContent className="flex flex-col gap-2 p-3">
          <div className="flex items-center justify-between gap-2">
            <span
              className="rounded-sm px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
              style={{
                backgroundColor: `${card.badgeBg}1f`,
                color: card.badgeBg,
              }}
            >
              {card.badge}
            </span>
            {card.changePct !== null && (
              <span className={`font-mono text-[11px] font-medium ${changeColor}`}>
                {card.changePct > 0 ? "+" : ""}
                {(card.changePct * 100).toFixed(2)}%
              </span>
            )}
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-[16px] font-semibold tracking-tight">
              {card.ticker}
            </span>
            {card.currentPct !== null && (
              <span className="font-mono text-[10px] text-muted-foreground">
                {card.currentPct.toFixed(1)}% of book
              </span>
            )}
          </div>
          <div className="text-[11px] leading-snug text-muted-foreground group-hover:text-foreground">
            {card.reason}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center">
      <div className="text-[12px] text-muted-foreground">
        Your holdings look quiet today — try the sector rail below or
        research a new ticker.
      </div>
    </div>
  );
}
