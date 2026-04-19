"use client";

import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [
    twoFactorClient({
      // If the user has 2FA enabled, BetterAuth signals this after the
      // password step and we redirect to a second-factor page. Pass the
      // originally-intended `callbackURL` through so a successful TOTP
      // verification lands the user where they were going.
      onTwoFactorRedirect({ twoFactorMethods }) {
        const methods = twoFactorMethods ?? ["totp"];
        // Preserve intended destination — sign-in flow uses /app as
        // the default landing; a ?next= query survives the round trip.
        const next =
          typeof window !== "undefined"
            ? new URLSearchParams(window.location.search).get("next") ?? "/app"
            : "/app";
        window.location.href = `/verify-2fa?next=${encodeURIComponent(next)}&methods=${methods.join(",")}`;
      },
    }),
  ],
});
