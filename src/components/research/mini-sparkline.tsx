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
}: {
  data: number[];
  width?: number;
  height?: number;
  responsive?: boolean;
  className?: string;
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

  const points = data
    .map((v, i) => {
      const x = i * stepX;
      // Invert y because SVG origin is top-left.
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  // Build a closed area path (line + bottom edge) for the soft fill.
  const areaPath =
    `M 0,${height} L ${points.split(" ").join(" L ")} L ${width.toFixed(1)},${height} Z`;
  const linePath = `M ${points.split(" ").join(" L ")}`;

  const first = data[0];
  const last = data[data.length - 1];
  const up = last >= first;
  const stroke = up ? "var(--buy)" : "var(--sell)";
  const fill = up ? "var(--buy)" : "var(--sell)";

  const id = `spark-${gradId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const sizeProps = responsive
    ? { width: "100%" as const, height: "100%" as const }
    : { width, height };

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
      <path
        d={linePath}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
