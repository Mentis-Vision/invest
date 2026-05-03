// src/components/dashboard/year-outlook/factor-exposure-card.tsx
//
// Server component. Renders the rolling Fama-French factor exposure
// for the user's portfolio: market beta, SMB (size), HML (value),
// and — when 5-factor data is available — RMW (profitability) +
// CMA (investment). Adds a one-line interpretation tag (small-cap
// value, large-cap growth, broad-market…) above the grid.
//
// Empty-state convention: when the regression returns null (sample
// too small or singular matrix), the card renders a "—" tile and
// short hint copy. Same em-dash pattern the other Year-Outlook
// surfaces use.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  interpretExposure,
  type FactorExposure,
} from "@/lib/dashboard/metrics/fama-french";
import { AsOfFootnote } from "@/components/dashboard/as-of-footnote";

interface FactorExposureCardProps {
  exposure: FactorExposure | null;
  /** ISO date of the most-recent factor row used. */
  asOf?: string | null;
  /** Provenance: "live" Kenneth French CSV, or "synthetic" baseline fallback. */
  dataSource?: "live" | "synthetic";
}

function fmtBeta(n: number | undefined | null): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}`;
}

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

interface CellProps {
  label: string;
  value: string;
  hint?: string;
}

function Cell({ label, value, hint }: CellProps) {
  return (
    <div className="rounded border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="text-lg font-bold tabular-nums">{value}</div>
      {hint ? (
        <div className="text-[10px] text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}

export function FactorExposureCard({
  exposure,
  asOf,
  dataSource = "live",
}: FactorExposureCardProps) {
  const sourceLabel =
    dataSource === "live"
      ? "Kenneth French Library"
      : "Synthetic baseline (live fetch unavailable)";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          Factor exposure
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {exposure ? (
          <>
            <ExposureBody exposure={exposure} />
          </>
        ) : (
          <div className="text-xs text-muted-foreground">
            Not enough portfolio history yet — factor exposure becomes
            meaningful after roughly four months of aligned daily
            returns. Holdings sync nightly; check back once the
            history fills in.
          </div>
        )}
        <p className="text-[10px] text-muted-foreground">
          Fama-French regression vs. Mkt-RF / SMB / HML
          {exposure?.fiveFactor ? " / RMW / CMA" : ""}.
          Informational only, not investment advice.
        </p>
        <AsOfFootnote
          source={sourceLabel}
          asOf={asOf ?? null}
          fallback={dataSource === "synthetic" ? "synthetic baseline" : undefined}
        />
      </CardContent>
    </Card>
  );
}

function ExposureBody({ exposure }: { exposure: FactorExposure }) {
  const interp = interpretExposure(exposure);
  const tagParts = [interp.tilt];
  if (interp.betaTag) tagParts.push(interp.betaTag);

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-base font-semibold capitalize">
          {tagParts.join(" · ")}
        </span>
        {!interp.meaningful ? (
          <span className="text-[10px] text-muted-foreground">
            (low explanatory power, R² {fmtPct(exposure.rSquared, 0)})
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground">
            R² {fmtPct(exposure.rSquared, 0)}
          </span>
        )}
      </div>
      <div
        className={`grid gap-2 ${exposure.fiveFactor ? "grid-cols-3 sm:grid-cols-6" : "grid-cols-2 sm:grid-cols-4"}`}
      >
        <Cell
          label="α (annualized)"
          value={fmtPct(exposure.alpha, 1)}
          hint="excess return after factor adjustment"
        />
        <Cell label="Mkt-RF β" value={fmtBeta(exposure.betas.mktRf)} hint="market beta" />
        <Cell label="SMB β" value={fmtBeta(exposure.betas.smb)} hint="size tilt" />
        <Cell label="HML β" value={fmtBeta(exposure.betas.hml)} hint="value tilt" />
        {exposure.fiveFactor ? (
          <>
            <Cell
              label="RMW β"
              value={fmtBeta(exposure.betas.rmw)}
              hint="profitability"
            />
            <Cell
              label="CMA β"
              value={fmtBeta(exposure.betas.cma)}
              hint="investment style"
            />
          </>
        ) : null}
      </div>
      <p className="text-[10px] text-muted-foreground tabular-nums">
        {exposure.observations} aligned daily observations
      </p>
    </>
  );
}
