"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink } from "react-plaid-link";
import { AlertCircle, Loader2 } from "lucide-react";

/**
 * Plaid OAuth return page.
 *
 * OAuth institutions (Schwab, Fidelity, Vanguard, TD Ameritrade, etc.)
 * redirect the user's full browser window to the institution's login
 * page during Plaid Link. After authentication the institution redirects
 * back to this URL with an `oauth_state_id` query parameter.
 *
 * Plaid Link resumes automatically when we re-initialize `usePlaidLink`
 * with:
 *   - the same `link_token` that started the flow (persisted in
 *     localStorage by the picker before `open()` was called)
 *   - `receivedRedirectUri: window.location.href` so the SDK can parse
 *     the oauth_state_id
 *
 * On success we exchange the public_token via our existing endpoint,
 * clear the persisted token, and return the user to /app. On failure or
 * cancellation we clear the token and surface an error with a link home.
 */
export default function PlaidOAuthPage() {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exchanging, setExchanging] = useState(false);
  const openedRef = useRef(false);

  useEffect(() => {
    let token: string | null = null;
    try {
      token = localStorage.getItem("plaid_link_token");
    } catch {
      /* ignore */
    }
    if (!token) {
      setError(
        "We lost track of your connection. Please return to the app and start linking again."
      );
      return;
    }
    setLinkToken(token);
  }, []);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    receivedRedirectUri:
      typeof window !== "undefined" ? window.location.href : undefined,
    onSuccess: async (publicToken) => {
      setExchanging(true);
      setError(null);
      try {
        localStorage.removeItem("plaid_link_token");
      } catch {
        /* ignore */
      }
      try {
        const res = await fetch("/api/plaid/exchange-public-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ publicToken }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(
            data.error ?? "Could not complete linking. Please try again."
          );
          return;
        }
        router.replace("/app?linked=1");
      } catch {
        setError("Network error. Please try again.");
      } finally {
        setExchanging(false);
      }
    },
    onExit: (err) => {
      try {
        localStorage.removeItem("plaid_link_token");
      } catch {
        /* ignore */
      }
      if (err) {
        setError(
          err.display_message ??
            err.error_message ??
            "Linking was cancelled before it finished."
        );
        return;
      }
      router.replace("/app");
    },
  });

  // Auto-resume as soon as Plaid's SDK is ready. `openedRef` prevents a
  // second open() call if React re-renders — `usePlaidLink` is not
  // idempotent about reopening.
  useEffect(() => {
    if (!ready || !linkToken || openedRef.current || exchanging || error) {
      return;
    }
    openedRef.current = true;
    open();
  }, [ready, linkToken, exchanging, error, open]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md text-center">
        {error ? (
          <>
            <AlertCircle className="mx-auto h-10 w-10 text-destructive" />
            <h1 className="mt-4 text-[18px] font-semibold tracking-tight">
              Connection interrupted
            </h1>
            <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
              {error}
            </p>
            <button
              type="button"
              onClick={() => router.replace("/app")}
              className="mt-5 inline-flex items-center rounded-md bg-foreground px-4 py-2 text-[13px] font-semibold text-background hover:bg-foreground/85"
            >
              Back to the app
            </button>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />
            <h1 className="mt-4 text-[18px] font-semibold tracking-tight">
              {exchanging
                ? "Syncing your holdings…"
                : "Finishing your connection…"}
            </h1>
            <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
              One moment while we complete the link to your brokerage.
              Don&rsquo;t close this tab.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
