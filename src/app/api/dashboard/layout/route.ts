import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  getDashboardLayout,
  saveDashboardLayout,
} from "@/lib/dashboard-layout";
import { log, errorInfo } from "@/lib/log";

/**
 * GET  /api/dashboard/layout  → read user's layout (or default)
 * PATCH /api/dashboard/layout → save new layout
 *
 * Auth-gated; no rate limit needed (cheap DB read/write, no AI).
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const blocks = await getDashboardLayout(session.user.id);
    return NextResponse.json({ blocks });
  } catch (err) {
    log.error("dashboard-layout", "GET failed", errorInfo(err));
    return NextResponse.json(
      { error: "Could not load layout." },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = (await req.json()) as { blocks?: unknown };
    const result = await saveDashboardLayout(session.user.id, body.blocks);
    return NextResponse.json(result);
  } catch (err) {
    log.error("dashboard-layout", "PATCH failed", errorInfo(err));
    return NextResponse.json(
      { error: "Could not save layout." },
      { status: 500 }
    );
  }
}
