import type { Metadata } from "next";
import { Onest, JetBrains_Mono, Fraunces } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

/**
 * Typography (2026-04 redesign):
 *   - Onest: body. Geometric-humanist sans with distinctive character
 *     (single-story 'a', quiet descenders). Not Inter. Not Geist.
 *   - JetBrains Mono: tabular numbers, ticker symbols, citations.
 *   - Fraunces: small editorial eyebrows only ("QUICK READ", "ISSUE 01")
 *     where the serif quality is earned. Never body.
 */
const onest = Onest({
  variable: "--font-onest",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["SOFT", "opsz"],
});

const siteUrl =
  process.env.BETTER_AUTH_URL?.replace(/\/$/, "") ??
  "https://clearpathinvest.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "ClearPath Invest — Know what to do with your money",
    template: "%s · ClearPath Invest",
  },
  description:
    "Evidence-based investing research. Three independent AI models cross-verify every recommendation against live SEC, FRED, and market data. Every claim traces to a source.",
  keywords: [
    "investment research",
    "AI stock analysis",
    "portfolio review",
    "SEC EDGAR",
    "evidence-based investing",
  ],
  authors: [{ name: "ClearPath Invest" }],
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteUrl,
    siteName: "ClearPath Invest",
    title: "Know what to do with your money",
    description:
      "Three independent AI models cross-verify every recommendation. Every claim traces to a source.",
  },
  twitter: {
    card: "summary_large_image",
    title: "ClearPath Invest",
    description:
      "Three independent AI models cross-verify every recommendation. Every claim traces to a source.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${onest.variable} ${jetbrainsMono.variable} ${fraunces.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        {/* Default to dark — the editorial-trading-floor direction is
            calibrated for dark-first. Users can toggle via the theme
            switch. System preference still overrides when enableSystem. */}
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <TooltipProvider>{children}</TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
