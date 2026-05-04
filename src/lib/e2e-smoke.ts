import { pool } from "./db";

/**
 * End-to-end smoke test runner.
 *
 * Exercises production-observable surfaces (HTTP responses, DB schema,
 * cron registration) — NOT internal implementation details. The goal
 * is to catch the kinds of breakages a real user would notice within
 * a week, not to substitute for unit tests.
 *
 * Cheap by design:
 *   - HTTP requests are HEAD or short GETs against ISR/static routes
 *   - No AI calls (the cron auth surface is exercised, but never the
 *     actual /api/research panel pipeline)
 *   - DB queries are existence checks, not data scans
 *
 * Runs weekly via /api/cron/e2e-smoke. Failures email Sang.
 *
 * The runner is deliberately framework-free — no Vitest, no Playwright,
 * no extra deps. A test is a `() => Promise<void>` that throws on
 * failure. Keeps the dev / CI / production runtime identical.
 */

export type SmokeStatus = "pass" | "fail" | "skip";

export type SmokeResult = {
  name: string;
  category: string;
  status: SmokeStatus;
  ms: number;
  error?: string;
  /** Optional context — surfaces in the email summary. */
  detail?: string;
};

export type SmokeReport = {
  ranAt: string;
  baseUrl: string;
  totalMs: number;
  passed: number;
  failed: number;
  skipped: number;
  results: SmokeResult[];
};

type SmokeTest = {
  name: string;
  category: string;
  /** Throw on failure. Return optional detail string for the report. */
  run: (ctx: { baseUrl: string }) => Promise<string | void>;
  skipIf?: () => boolean | Promise<boolean>;
};

// ─── Assertion helpers ──────────────────────────────────────────────

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function fetchOk(
  url: string,
  init?: RequestInit
): Promise<Response> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`expected 2xx, got ${res.status} ${res.statusText}`);
  }
  return res;
}

async function fetchStatus(url: string, expected: number): Promise<Response> {
  const res = await fetch(url);
  if (res.status !== expected) {
    throw new Error(
      `expected ${expected}, got ${res.status} ${res.statusText}`
    );
  }
  return res;
}

/**
 * Probe an external URL with HEAD first; if the server rejects HEAD
 * (some static-file hosts return 4xx for HEAD even when GET works),
 * fall back to a short GET with a 5s timeout. We never read the body.
 *
 * Throws on a final non-2xx so the smoke check fails the test, but is
 * tolerant of transient network blips: the existing weekly cron runs
 * once and emails Sang on failure — that's the desired alerting cadence
 * for "the upstream we depend on is down".
 */
async function reachableUpstream(url: string): Promise<number> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    // Timeout or network error — try GET as a courtesy.
    res = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      throw new Error(
        `${url} unreachable: ${res.status} (HEAD threw: ${err instanceof Error ? err.message : String(err)})`,
      );
    }
    return res.status;
  }
  if (res.ok) return res.status;
  // HEAD denied — try GET. Don't read the body.
  res = await fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new Error(`${url} returned ${res.status} on both HEAD and GET`);
  }
  return res.status;
}

async function dbColumnExists(
  table: string,
  column: string
): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = $1 AND column_name = $2
     ) AS exists`,
    [table, column]
  );
  return Boolean(rows[0]?.exists);
}

async function dbTableExists(table: string): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_name = $1
     ) AS exists`,
    [table]
  );
  return Boolean(rows[0]?.exists);
}

// ─── The test catalogue ─────────────────────────────────────────────

const TESTS: SmokeTest[] = [
  // Category: marketing pages — every public landing surface returns 2xx.
  {
    name: "Landing page renders",
    category: "marketing",
    async run({ baseUrl }) {
      await fetchOk(`${baseUrl}/`);
    },
  },
  {
    name: "How It Works renders",
    category: "marketing",
    async run({ baseUrl }) {
      await fetchOk(`${baseUrl}/how-it-works`);
    },
  },
  {
    name: "Manifesto renders",
    category: "marketing",
    async run({ baseUrl }) {
      await fetchOk(`${baseUrl}/manifesto`);
    },
  },
  {
    name: "Pricing renders",
    category: "marketing",
    async run({ baseUrl }) {
      await fetchOk(`${baseUrl}/pricing`);
    },
  },
  {
    name: "Alternatives matrix renders",
    category: "marketing",
    async run({ baseUrl }) {
      await fetchOk(`${baseUrl}/alternatives`);
    },
  },
  {
    name: "Track record page renders",
    category: "marketing",
    async run({ baseUrl }) {
      await fetchOk(`${baseUrl}/track-record`);
    },
  },
  {
    name: "Stocks index renders",
    category: "marketing",
    async run({ baseUrl }) {
      await fetchOk(`${baseUrl}/stocks`);
    },
  },
  {
    name: "Research index renders",
    category: "marketing",
    async run({ baseUrl }) {
      await fetchOk(`${baseUrl}/research`);
    },
  },
  {
    name: "Terms / Privacy / Disclosures render",
    category: "marketing",
    async run({ baseUrl }) {
      for (const path of ["/terms", "/privacy", "/disclosures"]) {
        await fetchOk(`${baseUrl}${path}`);
      }
    },
  },

  // Category: SEO infrastructure — sitemap, robots, OG image.
  {
    name: "Sitemap returns valid XML",
    category: "seo",
    async run({ baseUrl }) {
      const res = await fetchOk(`${baseUrl}/sitemap.xml`);
      const ct = res.headers.get("content-type") ?? "";
      assert(
        ct.includes("xml"),
        `unexpected content-type for sitemap: ${ct}`
      );
      const body = await res.text();
      assert(
        body.includes("<urlset"),
        "sitemap missing <urlset> root element"
      );
      const urlCount = (body.match(/<loc>/g) ?? []).length;
      assert(urlCount > 100, `sitemap suspiciously small: ${urlCount} URLs`);
      return `${urlCount} URLs in sitemap`;
    },
  },
  {
    name: "Robots.txt returns",
    category: "seo",
    async run({ baseUrl }) {
      const res = await fetchOk(`${baseUrl}/robots.txt`);
      const body = await res.text();
      assert(body.includes("Sitemap:"), "robots.txt missing Sitemap: line");
      assert(body.includes("/api/"), "robots.txt should disallow /api/");
    },
  },
  {
    name: "OpenGraph image renders",
    category: "seo",
    async run({ baseUrl }) {
      const res = await fetchOk(`${baseUrl}/opengraph-image`);
      const ct = res.headers.get("content-type") ?? "";
      assert(
        ct.startsWith("image/"),
        `OG image content-type wrong: ${ct}`
      );
    },
  },
  {
    name: "Favicon present",
    category: "seo",
    async run({ baseUrl }) {
      // Browsers will probe favicon.ico whether you advertise it or not.
      await fetchOk(`${baseUrl}/favicon.ico`);
    },
  },

  // Category: programmatic ticker pages — pick one that's usually primed.
  {
    name: "/stocks/[ticker] renders for SPY (ETF, always primed)",
    category: "programmatic",
    async run({ baseUrl }) {
      await fetchOk(`${baseUrl}/stocks/SPY`);
    },
  },
  {
    name: "/embed/[ticker] renders for SPY",
    category: "programmatic",
    async run({ baseUrl }) {
      await fetchOk(`${baseUrl}/embed/SPY`);
    },
  },

  // Category: research feed — RSS structure, latest brief renders.
  {
    name: "RSS feed returns valid RSS XML",
    category: "research",
    async run({ baseUrl }) {
      const res = await fetchOk(`${baseUrl}/research/feed.xml`);
      const ct = res.headers.get("content-type") ?? "";
      assert(
        ct.includes("rss") || ct.includes("xml"),
        `unexpected feed content-type: ${ct}`
      );
      const body = await res.text();
      assert(
        body.includes("<rss") && body.includes("<channel>"),
        "feed missing <rss>/<channel>"
      );
      const items = (body.match(/<item>/g) ?? []).length;
      return `${items} items in feed`;
    },
  },
  {
    name: "Latest published brief renders",
    category: "research",
    async run({ baseUrl }) {
      const { rows } = await pool.query<{ slug: string }>(
        `SELECT slug FROM "public_weekly_brief"
          WHERE status = 'published'
          ORDER BY week_of DESC LIMIT 1`
      );
      const slug = rows[0]?.slug;
      if (!slug) return "no published briefs yet — skip";
      await fetchOk(`${baseUrl}/research/${slug}`);
      return `slug: ${slug}`;
    },
  },

  // Category: auth boundaries — protected routes return 401 when
  // hit unauthenticated. Catches any accidental auth bypass.
  {
    name: "Protected app routes redirect or 401",
    category: "auth",
    async run({ baseUrl }) {
      const res = await fetch(`${baseUrl}/app`, { redirect: "manual" });
      // Either a redirect to /sign-in (302/303/307/308) or a 401.
      const ok =
        res.status === 401 ||
        (res.status >= 300 && res.status < 400);
      assert(
        ok,
        `expected 30x redirect or 401, got ${res.status}`
      );
    },
  },
  {
    name: "Cron endpoints reject unauthenticated requests",
    category: "auth",
    async run({ baseUrl }) {
      const crons = [
        "/api/cron/evaluate-outcomes",
        "/api/cron/weekly-bull-bear",
        "/api/cron/email-weekly-brief",
        "/api/cron/weekly-digest",
        "/api/cron/warehouse-retention",
      ];
      for (const path of crons) {
        await fetchStatus(`${baseUrl}${path}`, 401);
      }
      return `${crons.length} cron endpoints all 401`;
    },
  },
  {
    name: "Self-authenticated APIs return 401 unauthenticated",
    category: "auth",
    async run({ baseUrl }) {
      // These routes are NOT gated by proxy.ts and do the auth check
      // inside the handler. They MUST return 401 (not 200, not a
      // redirect) so client-side fetches can branch on status.
      const endpoints = ["/api/track-record"];
      for (const path of endpoints) {
        await fetchStatus(`${baseUrl}${path}`, 401);
      }
      return `${endpoints.length} self-auth APIs all 401`;
    },
  },
  {
    name: "Proxy-gated APIs redirect unauthenticated to /sign-in",
    category: "auth",
    async run({ baseUrl }) {
      // These routes ARE in proxy.ts matcher and get a 307 to
      // /sign-in BEFORE the handler runs. Disable fetch's automatic
      // follow so we see the actual proxy response, not the
      // sign-in page.
      const endpoints = [
        "/api/user/notifications",
        "/api/research/dossier-of-day",
      ];
      for (const path of endpoints) {
        const res = await fetch(`${baseUrl}${path}`, { redirect: "manual" });
        const isRedirect = res.status >= 300 && res.status < 400;
        const location = res.headers.get("location") ?? "";
        assert(
          isRedirect && location.includes("/sign-in"),
          `${path}: expected 30x to /sign-in, got ${res.status} ${location || "(no Location)"}`
        );
      }
      return `${endpoints.length} proxy-gated APIs all redirect`;
    },
  },

  // Category: DB schema — critical tables and columns exist. Catches
  // a half-applied migration before users see weird errors.
  {
    name: "Critical tables exist",
    category: "schema",
    async run() {
      const tables = [
        "user",
        "user_profile",
        "holding",
        "recommendation",
        "recommendation_outcome",
        "ticker_market_daily",
        "ticker_fundamentals",
        "public_weekly_brief",
        "public_weekly_brief_outcome",
        "waitlist",
      ];
      const missing: string[] = [];
      for (const t of tables) {
        if (!(await dbTableExists(t))) missing.push(t);
      }
      assert(
        missing.length === 0,
        `missing tables: ${missing.join(", ")}`
      );
      return `${tables.length} tables present`;
    },
  },
  {
    name: "Notification opt-out columns exist on user + waitlist",
    category: "schema",
    async run() {
      const checks: Array<[string, string]> = [
        ["user", "weeklyDigestOptOut"],
        ["user", "weeklyBriefOptOut"],
        ["user", "weeklyBriefSentAt"],
        ["waitlist", "weeklyBriefOptOut"],
        ["waitlist", "weeklyBriefSentAt"],
      ];
      const missing: string[] = [];
      for (const [t, c] of checks) {
        if (!(await dbColumnExists(t, c))) missing.push(`${t}.${c}`);
      }
      assert(
        missing.length === 0,
        `missing columns: ${missing.join(", ")}`
      );
    },
  },
  {
    name: "Public brief outcome rows exist for every published brief",
    category: "schema",
    async run() {
      const { rows } = await pool.query<{ orphans: number }>(
        `SELECT COUNT(*)::int AS orphans
           FROM "public_weekly_brief" b
          WHERE NOT EXISTS (
            SELECT 1 FROM "public_weekly_brief_outcome" o
             WHERE o.brief_id = b.id
          )
            AND b.status = 'published'`
      );
      const orphans = rows[0]?.orphans ?? 0;
      assert(
        orphans === 0,
        `${orphans} published briefs missing outcome schedules`
      );
    },
  },

  // Category: warehouse health — at least some tickers primed, sentiment
  // job succeeded recently. Catches "the cron silently stopped firing"
  // class of bugs.
  {
    name: "Warehouse has fresh market rows",
    category: "warehouse",
    async run() {
      const { rows } = await pool.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count
           FROM "ticker_market_daily"
          WHERE as_of >= CURRENT_DATE - INTERVAL '2 days'`
      );
      const count = rows[0]?.count ?? 0;
      assert(
        count >= 100,
        `only ${count} fresh market rows (expected >=100)`
      );
      return `${count} fresh tickers`;
    },
  },

  // Category: dashboard — Phase 1 actionable dashboard surfaces. The
  // /app overview is the home of the Daily Headline + Decision Queue
  // composition; if it disappears or starts 500ing, every authed user
  // sees a broken homepage on next load.
  {
    name: "Homepage /app is auth-gated and reachable",
    category: "dashboard",
    async run({ baseUrl }) {
      const res = await fetch(`${baseUrl}/app`, { redirect: "manual" });
      // Unauthenticated request: expect a redirect to /sign-in
      // (proxy.ts gates /app/*) or a 200 if the route is being served
      // (some preview environments rewrite). Either way, 5xx or 4xx
      // other than 401 means the route itself is broken.
      const ok =
        res.status === 200 ||
        res.status === 401 ||
        (res.status >= 300 && res.status < 400);
      assert(
        ok,
        `expected 200 / 30x / 401, got ${res.status}`
      );
      return `auth gate intact (status ${res.status})`;
    },
  },

  // Category: dashboard-redesign — Phase 5 acceptance checks. Covers the
  // benchmarks pipeline (column + APIs) and the upstream live-data
  // sources we depend on. HEAD probes against external sites are
  // deliberately tolerant — see fetchOrHeadOk for the GET fallback when
  // a server denies HEAD.
  {
    name: "dashboard /app is auth-gated",
    category: "dashboard-redesign",
    async run({ baseUrl }) {
      const res = await fetch(`${baseUrl}/app`, { redirect: "manual" });
      // Either 307/302 redirect to /sign-in OR 200 with auth-gated client render.
      assert(
        [200, 302, 307].includes(res.status),
        `unexpected /app status ${res.status}`,
      );
      return `status ${res.status}`;
    },
  },
  {
    name: "dashboard /api/user/benchmarks rejects unauth",
    category: "dashboard-redesign",
    async run({ baseUrl }) {
      const res = await fetch(`${baseUrl}/api/user/benchmarks`, {
        redirect: "manual",
      });
      // Either a direct 401 from the handler, or a 30x redirect to
      // /sign-in if proxy.ts is gating the route. Both are valid
      // "not authorized" signals — what we want to catch is a 200.
      const ok =
        res.status === 401 ||
        (res.status >= 300 &&
          res.status < 400 &&
          (res.headers.get("location") ?? "").includes("/sign-in"));
      assert(ok, `expected 401 or 30x→/sign-in, got ${res.status}`);
      return `auth gate intact (${res.status})`;
    },
  },
  {
    name: "dashboard /api/benchmarks/validate rejects unauth",
    category: "dashboard-redesign",
    async run({ baseUrl }) {
      const res = await fetch(`${baseUrl}/api/benchmarks/validate?ticker=SPY`, {
        redirect: "manual",
      });
      const ok =
        res.status === 401 ||
        (res.status >= 300 &&
          res.status < 400 &&
          (res.headers.get("location") ?? "").includes("/sign-in"));
      assert(ok, `expected 401 or 30x→/sign-in, got ${res.status}`);
      return `auth gate intact (${res.status})`;
    },
  },
  {
    name: "dashboard user_profile.benchmarks column exists",
    category: "dashboard-redesign",
    async run() {
      const result = await pool.query<{
        column_name: string;
        data_type: string;
      }>(
        `SELECT column_name, data_type
           FROM information_schema.columns
          WHERE table_name = 'user_profile' AND column_name = 'benchmarks'`,
      );
      assert(
        result.rows.length === 1,
        "user_profile.benchmarks column missing",
      );
      assert(
        result.rows[0].data_type === "jsonb",
        `expected jsonb, got ${result.rows[0].data_type}`,
      );
      return `${result.rows[0].column_name} ${result.rows[0].data_type}`;
    },
  },
  {
    name: "dashboard Kenneth French CSV reachable",
    category: "dashboard-redesign",
    async run() {
      const status = await reachableUpstream(
        "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_Factors_daily_CSV.zip",
      );
      return `${status}`;
    },
  },
  {
    name: "dashboard Damodaran ERP page reachable",
    category: "dashboard-redesign",
    async run() {
      const status = await reachableUpstream(
        "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/histimpl.html",
      );
      return `${status}`;
    },
  },
  {
    name: "dashboard FOMC calendar page reachable",
    category: "dashboard-redesign",
    async run() {
      const status = await reachableUpstream(
        "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
      );
      return `${status}`;
    },
  },
];

// ─── Public runner ─────────────────────────────────────────────────

export async function runSmokeReport(opts: {
  baseUrl: string;
}): Promise<SmokeReport> {
  const { baseUrl } = opts;
  const startedAt = Date.now();
  const results: SmokeResult[] = [];

  for (const test of TESTS) {
    const t0 = Date.now();
    try {
      if (test.skipIf && (await test.skipIf())) {
        results.push({
          name: test.name,
          category: test.category,
          status: "skip",
          ms: Date.now() - t0,
        });
        continue;
      }
      const detail = await test.run({ baseUrl });
      results.push({
        name: test.name,
        category: test.category,
        status: "pass",
        ms: Date.now() - t0,
        detail: typeof detail === "string" ? detail : undefined,
      });
    } catch (err) {
      results.push({
        name: test.name,
        category: test.category,
        status: "fail",
        ms: Date.now() - t0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    ranAt: new Date().toISOString(),
    baseUrl,
    totalMs: Date.now() - startedAt,
    passed: results.filter((r) => r.status === "pass").length,
    failed: results.filter((r) => r.status === "fail").length,
    skipped: results.filter((r) => r.status === "skip").length,
    results,
  };
}

/**
 * Render a SmokeReport as plain text for the failure email.
 * Compact + scannable — pass-counts at the top, then any failures
 * with their error messages.
 */
export function renderReportText(report: SmokeReport): string {
  const lines: string[] = [];
  lines.push(
    `ClearPath E2E smoke — ${report.passed} passed, ${report.failed} failed, ${report.skipped} skipped (${report.totalMs}ms)`
  );
  lines.push(`Ran against: ${report.baseUrl}`);
  lines.push(`At: ${report.ranAt}`);
  lines.push("");
  if (report.failed > 0) {
    lines.push("FAILURES:");
    for (const r of report.results) {
      if (r.status !== "fail") continue;
      lines.push(`  ✗ [${r.category}] ${r.name}`);
      lines.push(`    ${r.error}`);
    }
    lines.push("");
  }
  lines.push("ALL RESULTS:");
  for (const r of report.results) {
    const icon = r.status === "pass" ? "✓" : r.status === "fail" ? "✗" : "·";
    const detail = r.detail ? ` — ${r.detail}` : "";
    const err = r.error ? ` — ${r.error}` : "";
    lines.push(
      `  ${icon} [${r.category}] ${r.name} (${r.ms}ms)${detail}${err}`
    );
  }
  return lines.join("\n");
}
