"use client";

import { useEffect, useState } from "react";

/**
 * Ticker tape — scrolling horizontal marquee at the very top of the
 * app shell. Shows a fixed set of market indexes first, then the
 * signed-in user's top holdings.
 *
 * Data source: /api/ticker-tape (auth-gated; indexes + user holdings).
 * Refresh: every 60s via a simple setInterval. Pauses on hover so the
 * user can actually read a ticker.
 *
 * Animation: pure CSS keyframe, infinite loop. Data is rendered twice
 * back-to-back so the loop seam is invisible.
 *
 * Voice rule: the ticker shows raw market data only — no AI/LLM
 * references, no "overnight" chrome here.
 */

type TapeItem = {
  symbol: string;
  label: string;
  price: number;
  changePct: number;
  up: boolean;
  kind: "index" | "holding";
};

function formatPrice(symbol: string, price: number): string {
  // Special-case the yield tickers (^TNX, ^VIX) — they come through as
  // decimals like 4.32; we want "4.32%" / "14.8", not "$4.32".
  if (symbol.startsWith("^TNX")) {
    return `${price.toFixed(2)}%`;
  }
  if (symbol.startsWith("^VIX")) {
    return price.toFixed(1);
  }
  if (price >= 1000) {
    return `$${price.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  }
  return `$${price.toFixed(2)}`;
}

export default function TickerTape() {
  const [items, setItems] = useState<TapeItem[]>([]);

  useEffect(() => {
    let alive = true;
    async function pull() {
      try {
        const res = await fetch("/api/ticker-tape");
        if (!res.ok) return;
        const data = (await res.json()) as { items?: TapeItem[] };
        if (alive && data.items) setItems(data.items);
      } catch {
        /* silent — tape can live with stale data */
      }
    }
    pull();
    const iv = window.setInterval(pull, 60_000);
    return () => {
      alive = false;
      window.clearInterval(iv);
    };
  }, []);

  if (items.length === 0) return null;

  // Render the item list twice so the marquee loop seam is invisible.
  return (
    <div className="ticker-wrap group overflow-hidden border-b border-border bg-[#0f172a] text-[#e2e8f0]">
      <div className="ticker-track flex gap-10 whitespace-nowrap py-[9px] text-[12px] font-medium group-hover:[animation-play-state:paused]">
        {[...items, ...items].map((item, idx) => (
          <span
            key={`${item.symbol}-${idx}`}
            className="inline-flex flex-shrink-0 items-baseline gap-2"
          >
            <span className="font-mono font-semibold text-[#f1f5f9]">
              {item.label}
            </span>
            <span className="font-mono text-[#cbd5e1]">
              {formatPrice(item.symbol, item.price)}
            </span>
            <span
              className={`font-mono text-[11px] ${
                item.up ? "text-[#34d399]" : "text-[#f87171]"
              }`}
            >
              {item.up ? "+" : ""}
              {item.changePct.toFixed(2)}%
            </span>
            <span className="ml-10 text-[#475569]" aria-hidden>
              ·
            </span>
          </span>
        ))}
      </div>

      <style jsx>{`
        .ticker-track {
          animation: tickerScroll 90s linear infinite;
          will-change: transform;
        }
        @keyframes tickerScroll {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(-50%);
          }
        }
      `}</style>
    </div>
  );
}
