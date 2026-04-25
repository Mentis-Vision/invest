"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * Per-widget React error boundary.
 *
 * Why this exists:
 *   Financial app — any one widget rendering null/undefined where it
 *   expects a number crashes the whole page. One null value in the
 *   Macro block used to blank the entire dashboard via React's
 *   propagation. A scoped boundary isolates failure to the single
 *   widget so everything else renders.
 *
 * What users see on error:
 *   A muted "(unavailable)" card in the widget's slot. NOT a red scary
 *   error — financial context, we don't want to alarm. The failure is
 *   still logged to the console (and any configured error reporter)
 *   for debugging.
 *
 * Use around any widget that:
 *   - Renders user-fetched data (network can fail)
 *   - Does numeric formatting (.toFixed, Intl.NumberFormat)
 *   - Consumes AI-generated output
 */
export class WidgetBoundary extends Component<
  {
    children: ReactNode;
    /** Short name for the widget — shown in the fallback + logs. */
    name?: string;
    /** Optional custom fallback. Default is a muted "unavailable" card. */
    fallback?: ReactNode;
  },
  { hasError: boolean; message: string | null }
> {
  state = { hasError: false, message: null as string | null };

  static getDerivedStateFromError(err: Error) {
    return { hasError: true, message: err.message ?? "Unknown error" };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    // Surface to console so the developer can see it in browser devtools.
    // Intentionally NOT reporting to the user — a scary alert on a
    // financial app is worse than a gracefully degraded card.
    console.error(
      `[WidgetBoundary:${this.props.name ?? "widget"}]`,
      err,
      info.componentStack
    );
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    return (
      <div className="flex min-h-[80px] items-center justify-center rounded-md border border-dashed border-border bg-secondary/20 p-4 text-center">
        <div>
          <AlertTriangle className="mx-auto h-4 w-4 text-muted-foreground" />
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {this.props.name ? `${this.props.name} unavailable` : "Unavailable"}
          </p>
        </div>
      </div>
    );
  }
}
