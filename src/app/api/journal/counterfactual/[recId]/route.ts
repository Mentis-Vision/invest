import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { computeCounterfactual } from "@/lib/counterfactual";
import { log, errorInfo } from "@/lib/log";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ recId: string }> }
) {
  const { recId } = await ctx.params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await computeCounterfactual(session.user.id, recId);
    if (!result) {
      return NextResponse.json(
        { error: "not_available" },
        { status: 404 }
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    log.error("journal.counterfactual", "failed", {
      userId: session.user.id,
      recId,
      ...errorInfo(err),
    });
    return NextResponse.json({ error: "compute failed" }, { status: 500 });
  }
}
