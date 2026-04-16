import type { Metadata } from "next";
import { Geist, Geist_Mono, Fraunces } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["SOFT", "opsz"],
});

const siteUrl =
  process.env.BETTER_AUTH_URL?.replace(/\/$/, "") ??
  "https://clearpath-invest.vercel.app";

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
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
          <TooltipProvider>{children}</TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
