import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getUserHistory } from "@/lib/history";
import { log, errorInfo } from "@/lib/log";

/**
 * Export the user's recommendation history + their recorded actions
 * as CSV. One row per recommendation; outcomes collapsed into summary
 * columns (first-hit verdict + best-window %).
 *
 * Intended uses:
 *   - Personal journaling / tax records
 *   - "Can I see my whole call log" export
 *   - Audit trail if the user wants to review 90-day patterns
 *
 * Privacy: never includes a user's email or name — just the
 * recommendation data they already see on /app/history. Safe to share.
 */

function csvEscape(value: string | number | null | undefined): string {
  if (value == null) return "";
  const s = String(value);
  // Wrap in quotes if the field contains a comma, quote, or newline.
  // Double any internal quotes.
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Pull the full history (cap at 500 rows — a pragmatic ceiling so
    // this route stays cheap; if a user hits it we add pagination).
    const items = await getUserHistory(session.user.id, 500);

    const header = [
      "date",
      "ticker",
      "recommendation",
      "confidence",
      "consensus",
      "price_at_rec",
      "summary",
      "your_action",
      "action_recorded_at",
      "your_note",
      "outcome_7d_verdict",
      "outcome_7d_percent_move",
      "outcome_30d_verdict",
      "outcome_30d_percent_move",
      "outcome_90d_verdict",
      "outcome_90d_percent_move",
    ];

    const lines: string[] = [header.join(",")];

    for (const it of items) {
      const byWindow = new Map(it.outcomes.map((o) => [o.window, o]));
      const o7 = byWindow.get("7d");
      const o30 = byWindow.get("30d");
      const o90 = byWindow.get("90d");

      const row = [
        new Date(it.createdAt).toISOString().slice(0, 10),
        it.ticker,
        it.recommendation,
        it.confidence,
        it.consensus,
        it.priceAtRec.toFixed(2),
        it.summary,
        it.userAction ?? "",
        it.userActionAt ?? "",
        it.userNote ?? "",
        o7?.verdict ?? "",
        o7?.percentMove ?? "",
        o30?.verdict ?? "",
        o30?.percentMove ?? "",
        o90?.verdict ?? "",
        o90?.percentMove ?? "",
      ].map(csvEscape);

      lines.push(row.join(","));
    }

    const csv = lines.join("\r\n");
    // `clearpath-history-2026-04-19.csv` format for filename
    const today = new Date().toISOString().slice(0, 10);
    const filename = `clearpath-history-${today}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    log.error("history.export", "csv export failed", {
      userId: session.user.id,
      ...errorInfo(err),
    });
    return NextResponse.json(
      { error: "Export failed" },
      { status: 500 }
    );
  }
}
