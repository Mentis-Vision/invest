import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // TODO: Wire to Vercel AI SDK with Gemini for portfolio advice
  return NextResponse.json({
    advice:
      "Portfolio strategy analysis coming soon. Connect your brokerage and AI provider to get personalized buy/sell/hold recommendations.",
  });
}
