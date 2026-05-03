// src/components/dashboard/as-of-footnote.tsx
//
// Tiny credibility-layer footnote: "{source} · as-of {asOf}". Mounted
// under tile numerics to surface the freshness of the data the tile
// is rendering. Returns null when neither asOf nor a fallback string
// is supplied — keeps the surface tight when data is missing.
//
// Usage:
//   <AsOfFootnote source="VIX (FRED)" asOf={vixAsOfDate} />
//   <AsOfFootnote source="Damodaran" asOf={erp.asOf} fallback="anchor" />

interface AsOfFootnoteProps {
  /** Short data-source label, e.g. "Kenneth French Library". */
  source: string;
  /** ISO date or human-readable freshness label. null hides the footnote unless `fallback` is supplied. */
  asOf?: string | null;
  /** Static fallback text when asOf is missing (e.g. "anchor", "synthetic baseline"). */
  fallback?: string;
}

export function AsOfFootnote({ source, asOf, fallback }: AsOfFootnoteProps) {
  if (!asOf && !fallback) return null;
  const text = asOf
    ? `${source} · as-of ${asOf}`
    : `${source} · ${fallback ?? ""}`;
  return (
    <div className="text-[9px] text-[var(--muted-foreground)] mt-1 opacity-70">
      {text}
    </div>
  );
}
