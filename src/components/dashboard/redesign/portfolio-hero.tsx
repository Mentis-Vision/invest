// src/components/dashboard/redesign/portfolio-hero.tsx
// Spec §5.1. Server-renderable hero with greeting, $ total, day change,
// MTD/YTD, configurable benchmark pills, 30-day sparkline, top-5 movers.

import type { HeroData } from "@/lib/dashboard/types";
import { BenchmarkPickerLauncher } from "./benchmark-picker";
import { Card } from "@/components/ui/card";

function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function fmtPctSigned(n: number, digits = 2): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(digits)}%`;
}

function fmtPctSimple(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(1)}%`;
}

function formatDate(): string {
  const today = new Date();
  return today.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function buildSparklinePath(points: { date: string; value: number }[]): {
  line: string;
  area: string;
  width: number;
  height: number;
} {
  const width = 240;
  const height = 36;
  if (points.length < 2) return { line: "", area: "", width, height };
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = width / (points.length - 1);
  const coords = points.map((p, i) => {
    const x = i * step;
    const y = height - ((p.value - min) / range) * (height - 4) - 2;
    return [x, y] as const;
  });
  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area =
    line +
    ` L ${(coords[coords.length - 1][0]).toFixed(1)} ${height} L 0 ${height} Z`;
  return { line, area, width, height };
}

export function PortfolioHero({
  userName,
  hero,
}: {
  userName: string | null;
  hero: HeroData | null;
}) {
  const greeting = userName ? `Good morning, ${userName}` : "Good morning";
  const today = formatDate();

  if (!hero || hero.totalValue === null || hero.totalValue === 0) {
    return (
      <Card>
        <div className="px-5">
          <div className="text-[10px] tracking-widest uppercase text-[var(--hold)]">
            {today} · {greeting}
          </div>
          <div className="mt-2 text-base font-semibold">
            Connect a brokerage to see your portfolio →
          </div>
          <div className="mt-1 text-xs text-[var(--muted-foreground)]">
            We&apos;ll sync your holdings, sync prices nightly, and surface what to act on each morning.
          </div>
        </div>
      </Card>
    );
  }

  const sparkline = buildSparklinePath(hero.sparkline);
  const sparkDelta =
    hero.sparkline.length >= 2
      ? hero.sparkline[hero.sparkline.length - 1].value - hero.sparkline[0].value
      : 0;
  const sparkColor = sparkDelta >= 0 ? "var(--buy)" : "var(--sell)";

  return (
    <Card className="gap-0">
      <div className="px-5 grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-4">
        {/* LEFT: greeting + total + benchmarks */}
        <div>
        <div className="text-[10px] tracking-widest uppercase text-[var(--hold)]">
          {today} · {greeting}
        </div>
        <div className="flex items-baseline gap-3 mt-1.5">
          <div className="text-3xl font-extrabold tracking-tight">{fmtMoney(hero.totalValue)}</div>
          {hero.dayChange && (
            <div
              className="text-sm font-bold"
              style={{ color: hero.dayChange.dollars >= 0 ? "var(--buy)" : "var(--sell)" }}
            >
              {hero.dayChange.dollars >= 0 ? "+" : "−"}
              {fmtMoney(Math.abs(hero.dayChange.dollars))} today ({fmtPctSigned(hero.dayChange.pct)})
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 items-center mt-2.5">
          {hero.mtdPct !== null && (
            <span className="text-[10px] text-[var(--muted-foreground)]">
              MTD <b className="text-[var(--foreground)]">{fmtPctSimple(hero.mtdPct)}</b>
            </span>
          )}
          {hero.mtdPct !== null && hero.ytdPct !== null && (
            <span className="text-[var(--border)]">·</span>
          )}
          {hero.ytdPct !== null && (
            <span className="text-[10px] text-[var(--muted-foreground)]">
              YTD <b className="text-[var(--foreground)]">{fmtPctSimple(hero.ytdPct)}</b>
            </span>
          )}
          {hero.benchmarks.map((b) => (
            <span
              key={b.key}
              className="text-[10px] bg-[var(--background)] border border-[var(--border)] px-1.5 py-0.5 rounded-lg"
            >
              vs {b.label}{" "}
              <b style={{ color: b.deltaPct >= 0 ? "var(--buy)" : "var(--sell)" }}>
                {fmtPctSimple(b.deltaPct)}
              </b>
            </span>
          ))}
          <BenchmarkPickerLauncher initialKeys={hero.benchmarks.map((b) => b.key)} />
        </div>
      </div>

      {/* RIGHT: sparkline (top) + top movers (bottom) */}
      <div className="flex flex-col gap-2">
        <div>
          <div className="flex justify-between items-baseline">
            <div className="text-[8px] tracking-widest uppercase text-[var(--muted-foreground)]">
              30-day trend
            </div>
            {hero.sparkline.length >= 2 && (
              <div
                className="text-[9px] font-bold"
                style={{ color: sparkColor }}
              >
                {sparkDelta >= 0 ? "+" : "−"}
                {fmtMoney(Math.abs(sparkDelta))}
              </div>
            )}
          </div>
          {sparkline.line ? (
            <svg
              viewBox={`0 0 ${sparkline.width} ${sparkline.height}`}
              className="w-full h-9 mt-1"
              preserveAspectRatio="none"
            >
              <path d={sparkline.area} fill={sparkColor} fillOpacity={0.08} />
              <path d={sparkline.line} fill="none" stroke={sparkColor} strokeWidth={1.5} strokeLinejoin="round" />
            </svg>
          ) : (
            <div className="h-9 flex items-center justify-center text-[9px] text-[var(--muted-foreground)]">
              Not enough history yet
            </div>
          )}
        </div>
        <div>
          <div className="text-[8px] tracking-widest uppercase text-[var(--muted-foreground)] mb-1">
            Top movers today
          </div>
          {hero.topMovers.length === 0 ? (
            <div className="text-[10px] text-[var(--muted-foreground)]">No movers data yet</div>
          ) : (
            <div className="grid grid-cols-5 gap-1">
              {hero.topMovers.map((m) => (
                <div
                  key={m.ticker}
                  className="bg-[var(--background)] border border-[var(--border)] rounded px-1.5 py-1 text-center"
                >
                  <div className="text-[9px] font-bold">{m.ticker}</div>
                  <div
                    className="text-[10px] font-bold"
                    style={{ color: m.changePct >= 0 ? "var(--buy)" : "var(--sell)" }}
                  >
                    {fmtPctSimple(m.changePct)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      </div>
    </Card>
  );
}
