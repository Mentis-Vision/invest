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
    default: "ClearPath Invest — Evidence-based stock research",
    template: "%s · ClearPath Invest",
  },
  description:
    "Evidence-based stock research for retail investors. Three independent lenses — Quality, Momentum, Context — examine live SEC, Federal Reserve, and market data. Every claim traces to a primary source.",
  keywords: [
    "investment research",
    "AI stock analysis",
    "stock research tool",
    "equity research",
    "portfolio analysis",
    "SEC EDGAR",
    "evidence-based investing",
    "AI investment research",
  ],
  authors: [{ name: "ClearPath Invest" }],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteUrl,
    siteName: "ClearPath Invest",
    title: "Stock research. Every claim sourced.",
    description:
      "Three independent lenses — Quality, Momentum, Context — examine live SEC, Fed, and market data. Every claim traces to a primary source.",
  },
  twitter: {
    card: "summary_large_image",
    title: "ClearPath Invest — Stock research, every claim sourced",
    description:
      "Three independent lenses examine live SEC + Fed data. Every number traces to its source.",
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
};

// Site-wide JSON-LD: Organization + WebSite. Rendered once in the root
// layout so every page inherits the structured data. Page-level pages add
// their own schemas (SoftwareApplication, HowTo, Article, FAQPage,
// Product) on top. Crawlers + LLM citation bots weight this heavily for
// AI Overviews / Perplexity / ChatGPT citations.
//
// XSS-safety note: dangerouslySetInnerHTML below is safe because the
// content is a hard-coded server-side constant — no user input, no DB
// value, no query param. JSON.stringify handles the serialization. This
// is the pattern the Next.js docs recommend for JSON-LD (see
// https://nextjs.org/docs/app/guides/json-ld).
const organizationLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "ClearPath Invest",
  url: siteUrl,
  logo: `${siteUrl}/logo.png`,
  description:
    "Evidence-based stock research for retail investors. Three independent lenses — Quality, Momentum, Context — examine live SEC, Federal Reserve, and market data.",
  email: "hello@clearpathinvest.app",
  sameAs: [] as string[],
} as const;

const websiteLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "ClearPath Invest",
  url: siteUrl,
  description:
    "Evidence-based stock research. Three lenses, live data, every claim sourced.",
  publisher: { "@type": "Organization", name: "ClearPath Invest" },
} as const;

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
        {/* Site-wide JSON-LD — see safety note above. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteLd) }}
        />

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
