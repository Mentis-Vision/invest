"use client";

import { useEffect } from "react";

/**
 * SnapTrade Connection Portal landing page.
 *
 * When SNAPTRADE_REDIRECT_URI is set to this URL, clicking "Done" in the
 * SnapTrade popup navigates here (same origin as the opener). Once we're
 * back on our own origin, window.close() is allowed by the browser — the
 * cross-origin close block only applies while the popup is on snaptrade.com.
 *
 * We also postMessage the parent before closing so the parent can react
 * immediately instead of waiting for the 1s popup-closed poll. Defense in
 * depth: if anything breaks, the user can still manually close and our
 * poll detects it.
 */
export default function SnapTradeCallback() {
  useEffect(() => {
    try {
      if (window.opener && !window.opener.closed) {
        // Signal the parent window so it can trigger a holdings refresh
        // without waiting for the polling timer.
        window.opener.postMessage(
          { type: "snaptrade:connection_complete" },
          window.location.origin
        );
      }
    } catch {
      /* opener might be cross-origin by now; close() still works */
    }
    // A tiny delay so users see the confirmation flash rather than an
    // abrupt blank-window close.
    const t = setTimeout(() => {
      try {
        window.close();
      } catch {
        /* some browsers block this in certain contexts — fallback UI shows */
      }
    }, 400);
    return () => clearTimeout(t);
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background)] p-6 text-center">
      <div className="max-w-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--buy)]/10">
          <svg
            viewBox="0 0 24 24"
            className="h-6 w-6 text-[var(--buy)]"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Connection complete
        </h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          You can close this window. Returning to ClearPath…
        </p>
        <button
          type="button"
          onClick={() => {
            try {
              window.close();
            } catch {
              /* ignore */
            }
          }}
          className="mt-5 inline-flex items-center rounded-md border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)]"
        >
          Close window
        </button>
      </div>
    </main>
  );
}
