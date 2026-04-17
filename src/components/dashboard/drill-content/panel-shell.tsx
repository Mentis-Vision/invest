"use client";

import Link from "next/link";
import { X, ExternalLink } from "lucide-react";
import { useDrill } from "../drill-context";
import type { ReactNode } from "react";

/**
 * Shared chrome for every drill-panel body — editorial header with
 * eyebrow label, display title in Fraunces, optional secondary action,
 * and a close button. Keeps the 6 content modules visually cohesive.
 */
export function DrillHeader({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow: string;
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  const { close } = useDrill();
  return (
    <header className="relative border-b border-[var(--border)] bg-[var(--secondary)]/40 px-6 pt-6 pb-5">
      <button
        onClick={close}
        aria-label="Close"
        className="absolute right-4 top-4 rounded-full p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--background)] hover:text-[var(--foreground)] transition-colors"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--muted-foreground)]">
        {eyebrow}
      </div>
      <h2 className="mt-1.5 font-serif text-3xl leading-tight text-[var(--foreground)] tracking-tight">
        {title}
      </h2>
      {subtitle && (
        <div className="mt-2 text-sm text-[var(--muted-foreground)]">
          {subtitle}
        </div>
      )}
      {action && <div className="mt-4">{action}</div>}
    </header>
  );
}

export function DrillBody({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
      {children}
    </div>
  );
}

export function DrillSection({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between border-b border-[var(--border)] pb-1.5">
        <h3 className="text-[11px] uppercase tracking-[0.18em] font-medium text-[var(--foreground)]">
          {label}
        </h3>
        {description && (
          <span className="text-[10px] text-[var(--muted-foreground)]">
            {description}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

export function StatRow({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "neutral" | "up" | "down" | "warn";
}) {
  const color =
    tone === "up"
      ? "text-[var(--buy)]"
      : tone === "down"
        ? "text-[var(--sell)]"
        : tone === "warn"
          ? "text-[var(--decisive)]"
          : "text-[var(--foreground)]";
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <div className="text-[var(--muted-foreground)]">{label}</div>
      <div className={`font-mono tabular-nums text-right ${color}`}>
        {value}
        {hint && (
          <span className="ml-2 text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
            {hint}
          </span>
        )}
      </div>
    </div>
  );
}

export function DrillFooterLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--buy)] hover:underline underline-offset-4"
    >
      {children}
      <ExternalLink className="h-3 w-3" />
    </Link>
  );
}
