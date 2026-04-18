import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

/**
 * Typography (2026-04 hybrid-v2 redesign):
 *   - Inter: body + headings. Utilitarian, familiar, excellent
 *     small-size readability. Variable weights 400-700.
 *   - JetBrains Mono: tabular numbers, ticker symbols, citations.
 *
 * Dropped Fraunces / serif entirely — the previous editorial direction
 * read "too formal" per user feedback. Lighter, more generic.
 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
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
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        {/* Default to light — hybrid-v2 is calibrated for light-mode-
            first. Users can toggle via the theme switch; system
            preference still overrides when enableSystem. */}
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
          <TooltipProvider>{children}</TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
