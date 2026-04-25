import type { MetadataRoute } from "next";

const BASE_URL =
  process.env.BETTER_AUTH_URL?.replace(/\/$/, "") ??
  "https://clearpathinvest.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // /embed/* are iframe-only widgets — noindex via page metadata
        // to avoid competing with the canonical /stocks/[ticker] pages.
        // Kept crawlable so JSON-LD still propagates; disallow lines
        // would also hide legitimate backlinks to the widget.
        disallow: ["/app", "/app/", "/app/*", "/api/"],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  };
}
