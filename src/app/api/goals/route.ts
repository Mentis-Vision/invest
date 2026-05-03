// src/app/api/goals/route.ts
// GET / POST the user's goals row. Auth-gated via the proxy matcher
// AND a redundant in-route session check (proxy can't see the body
// shape — we still need to know who's writing).
//
// POST validates each field independently so partial updates work:
// the UI submits the full form snapshot, but other callers (e.g. an
// onboarding step that only sets the targetWealth) can ship a partial
// body and the loader will preserve unmentioned fields.

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  getUserGoals,
  saveUserGoals,
  type UserGoals,
} from "@/lib/dashboard/goals-loader";
import { log, errorInfo } from "@/lib/log";

const RISK_VALUES = new Set(["conservative", "moderate", "aggressive"]);

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const goals = await getUserGoals(session.user.id);
    return NextResponse.json({ ok: true, goals });
  } catch (err) {
    log.error("goals", "goals.get_failed", {
      userId: session.user.id,
      ...errorInfo(err),
    });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Partial<UserGoals>;
  try {
    body = (await req.json()) as Partial<UserGoals>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (
    body.targetWealth !== undefined &&
    body.targetWealth !== null &&
    (typeof body.targetWealth !== "number" ||
      !Number.isFinite(body.targetWealth) ||
      body.targetWealth < 0 ||
      body.targetWealth > 1e10)
  ) {
    return NextResponse.json(
      { error: "invalid_target_wealth" },
      { status: 400 },
    );
  }
  if (
    body.riskTolerance !== undefined &&
    body.riskTolerance !== null &&
    !RISK_VALUES.has(body.riskTolerance)
  ) {
    return NextResponse.json(
      { error: "invalid_risk_tolerance" },
      { status: 400 },
    );
  }
  if (
    body.currentAge !== undefined &&
    body.currentAge !== null &&
    (typeof body.currentAge !== "number" ||
      !Number.isInteger(body.currentAge) ||
      body.currentAge < 18 ||
      body.currentAge > 120)
  ) {
    return NextResponse.json({ error: "invalid_age" }, { status: 400 });
  }
  if (
    body.monthlyContribution !== undefined &&
    body.monthlyContribution !== null &&
    (typeof body.monthlyContribution !== "number" ||
      !Number.isFinite(body.monthlyContribution) ||
      body.monthlyContribution < 0 ||
      body.monthlyContribution > 1e9)
  ) {
    return NextResponse.json(
      { error: "invalid_contribution" },
      { status: 400 },
    );
  }
  let coercedDate: string | null | undefined = body.targetDate ?? undefined;
  if (body.targetDate !== undefined && body.targetDate !== null) {
    const d = new Date(body.targetDate);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json(
        { error: "invalid_target_date" },
        { status: 400 },
      );
    }
    coercedDate = d.toISOString().slice(0, 10);
  }

  await saveUserGoals(session.user.id, {
    targetWealth: body.targetWealth ?? null,
    targetDate: coercedDate ?? null,
    monthlyContribution: body.monthlyContribution ?? null,
    currentAge: body.currentAge ?? null,
    riskTolerance: body.riskTolerance ?? null,
  });
  log.info("goals", "goals.saved", { userId: session.user.id });
  return NextResponse.json({ ok: true });
}
