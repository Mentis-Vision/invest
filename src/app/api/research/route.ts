import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { streamText } from "ai";
import { auth } from "@/lib/auth";
import { getStockSnapshot, formatSnapshotForAI } from "@/lib/data/yahoo";
import { models } from "@/lib/ai/models";

export const maxDuration = 60;

const SYSTEM_PROMPT = `You are a disciplined financial analyst for ClearPath Invest, a platform built on ZERO TOLERANCE for hallucination.

ABSOLUTE RULES:
1. You may ONLY cite numbers and facts explicitly present in the DATA block below. Never invent figures.
2. If a data point is "N/A" or missing, say so — do not estimate, round from memory, or fabricate.
3. You are NOT a licensed advisor. Frame recommendations as informational, not advice.
4. Prefer HOLD when evidence is ambiguous. Bias toward caution, not action.
5. Cite the source of each claim ("Per Yahoo Finance snapshot: ...") to make verification trivial.

RESPONSE FORMAT (Markdown):
### Recommendation
One of: BUY / HOLD / SELL / INSUFFICIENT DATA — plus a 1-sentence why.

### Key Signals (from the data)
- 3–5 bullets, each citing a specific number from the DATA block.

### Risk Factors
- 2–3 bullets flagging what would change your view.

### Confidence
LOW / MEDIUM / HIGH — and why. Lower confidence if data is sparse.

### What's Missing
List specific data you'd want for a more confident call (e.g., recent filings, sector peers, insider transactions).

Keep the total response under 350 words. No filler, no hedged non-statements.`;

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { ticker?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ticker = body.ticker?.toUpperCase();
  if (!ticker) {
    return NextResponse.json({ error: "Ticker required" }, { status: 400 });
  }

  let dataBlock: string;
  try {
    const snapshot = await getStockSnapshot(ticker);
    dataBlock = formatSnapshotForAI(snapshot);
  } catch {
    return NextResponse.json(
      { error: `Could not fetch data for ${ticker}. Verify the ticker symbol.` },
      { status: 404 }
    );
  }

  const userMessage = `Analyze ${ticker} using ONLY the data below.\n\n--- DATA (verified from Yahoo Finance) ---\n${dataBlock}\n--- END DATA ---\n\nProduce your analysis in the required format.`;

  const result = streamText({
    model: models.claude,
    system: SYSTEM_PROMPT,
    prompt: userMessage,
  });

  return result.toTextStreamResponse();
}
