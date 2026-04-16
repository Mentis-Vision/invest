import type { MetadataRoute } from "next";

const BASE_URL =
  process.env.BETTER_AUTH_URL?.replace(/\/$/, "") ??
  "https://clearpath-invest.vercel.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/app", "/app/", "/app/*", "/api/"],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  };
}
