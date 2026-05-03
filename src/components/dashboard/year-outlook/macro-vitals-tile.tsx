// src/components/dashboard/year-outlook/macro-vitals-tile.tsx
//
// Phase 4 Batch K2 — server component composing three secondary
// macro signals into one compact card:
//   * CBOE SKEW (^SKEW) tail-risk reading + 2y percentile
//   * 10y nominal / TIPS real / breakeven inflation triad (FRED)
//   * FOMC dot-plot median for the current calendar year (hardcoded
//     SEP constant) with current funds rate from FRED for context
//
// Each leg is independently null-tolerant — if Yahoo or FRED is down
// we render a "—" tile with explanatory hint copy rather than
// crashing the surface.

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSkewReading } from "@/lib/dashboard/metrics/skew";
import { getTipsRealYield } from "@/lib/dashboard/metrics/tips-real-yield";
import { getFedWatchSnapshot } from "@/lib/dashboard/metrics/fed-watch";
import { AsOfFootnote } from "@/components/dashboard/as-of-footnote";
import { log, errorInfo } from "@/lib/log";

const SKEW_BAND_LABEL: Record<string, string> = {
  complacent: "Complacent",
  neutral: "Neutral",
  elevated: "Elevated",
  extreme: "Extreme",
};

const SKEW_BAND_COLOR: Record<string, string> = {
  complacent: "var(--buy)",
  neutral: "var(--foreground)",
  elevated: "var(--decisive)",
  extreme: "var(--sell)",
};

const STANCE_COLOR: Record<string, string> = {
  restrictive: "var(--sell)",
  accommodative: "var(--buy)",
  neutral: "var(--foreground)",
};

function fmtPct(n: number | null, digits = 2): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

function fmtPercentile(n: number): string {
  return `${Math.round(n * 100)}th`;
}

export async function MacroVitalsTile() {
  const [skew, tips, fedWatch] = await Promise.all([
    getSkewReading().catch((err) => {
      log.warn("macro-vitals.tile", "skew load failed", { ...errorInfo(err) });
      return null;
    }),
    getTipsRealYield().catch((err) => {
      log.warn("macro-vitals.tile", "tips load failed", { ...errorInfo(err) });
      return null;
    }),
    getFedWatchSnapshot().catch((err) => {
      log.warn("macro-vitals.tile", "fed-watch load failed", { ...errorInfo(err) });
      return null;
    }),
  ]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          Macro vitals
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {/* SKEW */}
          <div className="rounded border border-border bg-card p-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              CBOE SKEW
            </div>
            {skew ? (
              <>
                <div
                  className="text-lg font-bold tabular-nums"
                  style={{ color: SKEW_BAND_COLOR[skew.band] }}
                >
                  {skew.value.toFixed(1)}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {SKEW_BAND_LABEL[skew.band]} · {fmtPercentile(skew.percentile2y)} pct (2y)
                </div>
                <AsOfFootnote source="^SKEW (Yahoo)" asOf={skew.asOf} />
              </>
            ) : (
              <>
                <div className="text-lg font-bold tabular-nums">—</div>
                <div className="text-[10px] text-muted-foreground">
                  ^SKEW unavailable
                </div>
              </>
            )}
          </div>

          {/* TIPS / real yields */}
          <div className="rounded border border-border bg-card p-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              10y real yield (TIPS)
            </div>
            {tips ? (
              <>
                <div
                  className="text-lg font-bold tabular-nums"
                  style={{
                    color: tips.stance ? STANCE_COLOR[tips.stance] : undefined,
                  }}
                >
                  {fmtPct(tips.real10y)}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Nom {fmtPct(tips.nominal10y)} · Brk {fmtPct(tips.breakeven10y)}
                </div>
                <AsOfFootnote source="FRED" asOf={tips.asOf} />
              </>
            ) : (
              <>
                <div className="text-lg font-bold tabular-nums">—</div>
                <div className="text-[10px] text-muted-foreground">
                  FRED unavailable
                </div>
              </>
            )}
          </div>

          {/* FOMC dot-plot */}
          <div className="rounded border border-border bg-card p-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              FOMC median dot
            </div>
            {fedWatch ? (
              <>
                <div className="text-lg font-bold tabular-nums">
                  {fedWatch.medianDot.toFixed(2)}%
                </div>
                <div className="text-[10px] text-muted-foreground">
                  by {fedWatch.targetYear} · current{" "}
                  {fmtPct(fedWatch.currentFunds)}
                </div>
                <AsOfFootnote source="FOMC SEP" asOf={fedWatch.asOf} />
              </>
            ) : (
              <>
                <div className="text-lg font-bold tabular-nums">—</div>
                <div className="text-[10px] text-muted-foreground">
                  SEP unavailable
                </div>
              </>
            )}
          </div>
        </div>

        <div className="space-y-1 text-xs text-muted-foreground">
          {tips?.interpretation ? <p>{tips.interpretation}</p> : null}
          {fedWatch?.interpretation ? <p>{fedWatch.interpretation}</p> : null}
        </div>

        <p className="text-[10px] text-muted-foreground">
          SKEW via CBOE / Yahoo. Treasury yields via FRED. Dot-plot:
          FOMC SEP{fedWatch ? ` (as of ${fedWatch.asOf})` : ""}, refreshed
          quarterly. Informational only, not investment advice.
        </p>
      </CardContent>
    </Card>
  );
}
