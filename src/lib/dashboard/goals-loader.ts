// src/lib/dashboard/goals-loader.ts
// DB read/write helpers for the user_profile goals columns added in
// migrations/2026-05-04-user-goals.sql. Lives next to the rest of the
// dashboard layer so queue-builder and the GoalsForm component can
// import from a single typed surface.
//
// All shape-validation happens at the API boundary (src/app/api/goals
// /route.ts). This module trusts its inputs are within range — it
// only handles pg type coercion (Date / numeric → ISO string / number).

import { pool } from "../db";
import { log, errorInfo } from "../log";
import type { RiskTolerance } from "./goals";

export interface UserGoals {
  targetWealth: number | null;
  targetDate: string | null; // ISO yyyy-mm-dd
  monthlyContribution: number | null;
  currentAge: number | null;
  riskTolerance: RiskTolerance | null;
}

interface GoalsRow {
  targetWealth: string | number | null;
  targetDate: Date | string | null;
  monthlyContribution: string | number | null;
  currentAge: number | null;
  riskTolerance: string | null;
}

const EMPTY: UserGoals = {
  targetWealth: null,
  targetDate: null,
  monthlyContribution: null,
  currentAge: null,
  riskTolerance: null,
};

function coerceNumber(v: string | number | null): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function coerceDate(v: Date | string | null): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return v.toISOString().slice(0, 10);
  }
  // pg may return the string already — slice off any time portion.
  return String(v).slice(0, 10);
}

function coerceRisk(v: string | null): RiskTolerance | null {
  if (v === "conservative" || v === "moderate" || v === "aggressive") {
    return v;
  }
  return null;
}

/**
 * Read the user's goals row. Missing user_profile row → all-nulls; any
 * read error is logged and also degrades to all-nulls so the dashboard
 * still renders the goals_setup queue item.
 */
export async function getUserGoals(userId: string): Promise<UserGoals> {
  try {
    const { rows } = await pool.query<GoalsRow>(
      `SELECT "targetWealth", "targetDate", "monthlyContribution",
              "currentAge", "riskTolerance"
         FROM "user_profile"
        WHERE "userId" = $1
        LIMIT 1`,
      [userId],
    );
    if (rows.length === 0) return { ...EMPTY };
    const r = rows[0];
    return {
      targetWealth: coerceNumber(r.targetWealth),
      targetDate: coerceDate(r.targetDate),
      monthlyContribution: coerceNumber(r.monthlyContribution),
      currentAge: r.currentAge === null ? null : Number(r.currentAge),
      riskTolerance: coerceRisk(r.riskTolerance),
    };
  } catch (err) {
    log.warn("goals-loader", "getUserGoals failed", {
      userId,
      ...errorInfo(err),
    });
    return { ...EMPTY };
  }
}

/**
 * Upsert the goals columns. Existing user_profile rows have their
 * other columns (riskTolerance, investmentGoals, preferences, etc.)
 * preserved — we only touch the keys present in `update`.
 *
 * Insert path uses NOW() for updatedAt and creates a fresh empty
 * preferences blob; the COALESCE branch on UPDATE only writes the
 * columns whose new value is non-NULL so a partial PATCH doesn't blow
 * away other fields.
 */
export async function saveUserGoals(
  userId: string,
  update: Partial<UserGoals>,
): Promise<void> {
  // Map undefined → null so pg parameter binding is consistent. Note
  // that COALESCE in the UPDATE branch only takes the new value when
  // it's NOT NULL, so explicitly-cleared fields require a different
  // call shape (we don't currently expose "clear my targetWealth" —
  // the GoalsForm submits a full form snapshot every time).
  const params = [
    userId,
    update.targetWealth ?? null,
    update.targetDate ?? null,
    update.monthlyContribution ?? null,
    update.currentAge ?? null,
    update.riskTolerance ?? null,
  ];

  try {
    await pool.query(
      `INSERT INTO "user_profile"
         ("userId", "targetWealth", "targetDate", "monthlyContribution",
          "currentAge", "riskTolerance", preferences, "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, '{}'::jsonb, NOW())
       ON CONFLICT ("userId") DO UPDATE SET
         "targetWealth"        = COALESCE(EXCLUDED."targetWealth",        "user_profile"."targetWealth"),
         "targetDate"          = COALESCE(EXCLUDED."targetDate",          "user_profile"."targetDate"),
         "monthlyContribution" = COALESCE(EXCLUDED."monthlyContribution", "user_profile"."monthlyContribution"),
         "currentAge"          = COALESCE(EXCLUDED."currentAge",          "user_profile"."currentAge"),
         "riskTolerance"       = COALESCE(EXCLUDED."riskTolerance",       "user_profile"."riskTolerance"),
         "updatedAt"           = NOW()`,
      params,
    );
  } catch (err) {
    log.error("goals-loader", "saveUserGoals failed", {
      userId,
      ...errorInfo(err),
    });
    throw err;
  }
}
