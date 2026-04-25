"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Layers } from "lucide-react";

/**
 * Sector explore rail.
 *
 * Horizontal scrollable strip of 11 Select Sector SPDR ETFs — a
 * browse-without-a-ticker entry point. Each tile shows today's move
 * for the sector and is itself clickable research (ETFs are real
 * tradable securities).
 *
 * Renders on landing only — hides when the user is viewing a result.
 * Loads asynchronously; shows a skeleton while fetching, hides if
 * the warehouse can't serve any data (error or empty map).
 */

type SectorTile = {
  ticker: string;
  sector: string;
  shortLabel: string;
  close: number | null;
  changePct: number | null;
  asOf: string | null;
};

export function SectorRail({
  onOpenResearch,
}: {
  onOpenResearch: (ticker: string) => void;
}) {
  const [tiles, setTiles] = useState<SectorTile[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch("/api/research/sector-rail")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        if (!d?.tiles || !Array.isArray(d.tiles)) {
          setTiles(null);
          return;
        }
        setTiles(d.tiles as SectorTile[]);
      })
      .catch(() => {
        if (alive) setTiles(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 overflow-hidden">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="h-16 w-32 flex-shrink-0 animate-pulse rounded-md bg-secondary/40"
          />
        ))}
      </div>
    );
  }

  // No data → don't render anything. The other strips on the page cover
  // the landing; this one just degrades invisibly when the warehouse
  // hasn't primed the ETF rows yet.
  if (!tiles || tiles.every((t) => t.changePct == null)) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
        <Layers className="h-3.5 w-3.5" />
        Explore by sector
      </div>
      <div
        className="-mx-2 flex gap-2 overflow-x-auto px-2 pb-2"
        style={{ scrollbarWidth: "thin" }}
      >
        {tiles.map((tile) => (
          <SectorTileButton
            key={tile.ticker}
            tile={tile}
            onClick={() => onOpenResearch(tile.ticker)}
          />
        ))}
      </div>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Select Sector SPDR ETFs. Click a tile to research the sector
        directly — each is itself a tradable fund.
      </p>
    </div>
  );
}

function SectorTileButton({
  tile,
  onClick,
}: {
  tile: SectorTile;
  onClick: () => void;
}) {
  const pct = tile.changePct;
  const tone =
    pct == null
      ? "text-muted-foreground"
      : pct > 0
        ? "text-[var(--buy)]"
        : pct < 0
          ? "text-[var(--sell)]"
          : "text-muted-foreground";

  const pctLabel =
    pct == null
      ? "—"
      : `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`;

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-16 w-36 flex-shrink-0 flex-col justify-between rounded-md border border-border bg-card px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold leading-tight">
            {tile.shortLabel}
          </div>
          <div className="font-mono text-[10px] text-muted-foreground">
            {tile.ticker}
          </div>
        </div>
        <ArrowUpRight className="h-3 w-3 flex-shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
      </div>
      <div className={`font-mono text-[13px] font-semibold ${tone}`}>
        {pctLabel}
      </div>
    </button>
  );
}
