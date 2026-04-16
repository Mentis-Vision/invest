import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { ticker } = await req.json();
  if (!ticker) {
    return NextResponse.json({ error: "Ticker required" }, { status: 400 });
  }

  // TODO: Wire to Vercel AI SDK with Gemini for real analysis
  return NextResponse.json({
    analysis: `Analysis for ${ticker} coming soon. Connect your AI provider to enable real-time stock research.`,
  });
}
