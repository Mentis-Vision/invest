"use client";

import { useId } from "react";

/**
 * Inline sparkline used in the corner of research result cards.
 *
 * Pure SVG so it doesn't pull in recharts overhead for what's a 30-point
 * line. Renders nothing when given fewer than two points (a single dot
 * isn't a chart).
 *
 * The line color tracks first-vs-last direction — visually echoes the
 * verdict pill colors so the chart and the BUY/HOLD/SELL badge agree
 * at a glance even before the user reads any text.
 *
 * Responsive: pass `responsive` (or omit width/height) to let the SVG
 * fill its container via viewBox + width="100%". Fixed-size use still
 * works by passing explicit width/height.
 */

export function MiniSparkline({
  data,
  width = 140,
  height = 36,
  responsive = false,
  className = "",
  sources,
}: {
  data: number[];
  width?: number;
  height?: number;
  responsive?: boolean;
  className?: string;
  /**
   * Optional per-point provenance flag. When provided (length must equal
   * `data.length`) the sparkline splits its line into two visual segments:
   *   - "observed"      → solid line at full opacity
   *   - "reconstructed" → dashed line at reduced opacity
   *
   * AGENTS.md trust tenet (rule #13): never silently merge observed +
   * reconstructed history. Callers passing this prop get a chart that
   * is honest about which range came from broker observation vs
   * transaction-replay reconstruction.
   */
  sources?: ReadonlyArray<"observed" | "reconstructed">;
}) {
  // IMPORTANT: useId() is stable across SSR + client hydration. Using
  // Math.random() here — as a previous revision did — generated a
  // different <linearGradient id> on the server vs the client, which
  // threw React #418 (hydration mismatch) on every dashboard load and
  // cascaded into a Base UI error when the account-menu dropdown tried
  // to render into the corrupted tree.
  const gradId = useId();

  if (!data || data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);

  const coords = data.map((v, i) => {
    const x = i * stepX;
    // Invert y because SVG origin is top-left.
    const y = height - ((v - min) / range) * height;
    return { x, y };
  });

  const points = coords
    .map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");

  // Build a closed area path (line + bottom edge) for the soft fill.
  const areaPath =
    `M 0,${height} L ${points.split(" ").join(" L ")} L ${width.toFixed(1)},${height} Z`;

  const first = data[0];
  const last = data[data.length - 1];
  const up = last >= first;
  const stroke = up ? "var(--buy)" : "var(--sell)";
  const fill = up ? "var(--buy)" : "var(--sell)";

  const id = `spark-${gradId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const sizeProps = responsive
    ? { width: "100%" as const, height: "100%" as const }
    : { width, height };

  // Build per-segment paths. Each segment between coords[i] and
  // coords[i+1] is tagged "reconstructed" if EITHER endpoint is
  // reconstructed; this produces a single hand-off point at the
  // boundary rather than a one-segment overlap.
  const hasSources =
    sources !== undefined && sources.length === data.length;

  const observedSubpaths: string[] = [];
  const reconstructedSubpaths: string[] = [];

  if (hasSources) {
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i];
      const b = coords[i + 1];
      const segmentReconstructed =
        sources![i] === "reconstructed" ||
        sources![i + 1] === "reconstructed";
      const seg = `M ${a.x.toFixed(1)},${a.y.toFixed(1)} L ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
      if (segmentReconstructed) {
        reconstructedSubpaths.push(seg);
      } else {
        observedSubpaths.push(seg);
      }
    }
  }

  const linePath = `M ${points.split(" ").join(" L ")}`;

  return (
    <svg
      {...sizeProps}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fill} stopOpacity={0.18} />
          <stop offset="100%" stopColor={fill} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${id})`} />
      {hasSources ? (
        <>
          {reconstructedSubpaths.length > 0 && (
            <path
              d={reconstructedSubpaths.join(" ")}
              fill="none"
              stroke={stroke}
              strokeOpacity={0.6}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {observedSubpaths.length > 0 && (
            <path
              d={observedSubpaths.join(" ")}
              fill="none"
              stroke={stroke}
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </>
      ) : (
        <path
          d={linePath}
          fill="none"
          stroke={stroke}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}
