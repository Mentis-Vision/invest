import { pool } from "./db";
import { log, errorInfo } from "./log";

/**
 * User investment profile.
 *
 * Drives persona-aware analysis: when a profile is set, the analyst
 * system prompts receive a concise rider (e.g. "User is conservative,
 * retirement horizon 20yr — emphasize capital preservation, downside,
 * and income") that tilts the lens. Profile is NEVER used as a hard
 * filter — we still show the full view; we only shade the analysis.
 *
 * Schema lives in the `user_profile` table (already migrated):
 *   userId PK -> user.id
 *   riskTolerance TEXT           (conservative | moderate | aggressive)
 *   investmentGoals TEXT[]        (subset of RISK_GOALS)
 *   horizon TEXT                  (short | medium | long)
 *   preferences JSONB             (free-form bag: excludedSectors, ESG, ...)
 *   disclaimerAcceptedAt TIMESTAMP (set by the research flow, not here)
 */

export type RiskTolerance = "conservative" | "moderate" | "aggressive";
export type Horizon = "short" | "medium" | "long";
export type InvestmentGoal =
  | "retirement"
  | "growth"
  | "income"
  | "preservation"
  | "speculation";

export const RISK_TOLERANCES: RiskTolerance[] = [
  "conservative",
  "moderate",
  "aggressive",
];
export const HORIZONS: Horizon[] = ["short", "medium", "long"];
export const INVESTMENT_GOALS: InvestmentGoal[] = [
  "retirement",
  "growth",
  "income",
  "preservation",
  "speculation",
];

export type UserProfile = {
  userId: string;
  riskTolerance: RiskTolerance | null;
  investmentGoals: InvestmentGoal[];
  horizon: Horizon | null;
  preferences: {
    excludedSectors?: string[];
    esgPreference?: boolean;
    notes?: string;
  };
  disclaimerAcceptedAt: string | null;
  updatedAt: string | null;
};

const DEFAULT_PROFILE = (userId: string): UserProfile => ({
  userId,
  riskTolerance: null,
  investmentGoals: [],
  horizon: null,
  preferences: {},
  disclaimerAcceptedAt: null,
  updatedAt: null,
});

export async function getUserProfile(userId: string): Promise<UserProfile> {
  try {
    const { rows } = await pool.query(
      `SELECT "userId", "riskTolerance", "investmentGoals", horizon,
              "disclaimerAcceptedAt", preferences, "updatedAt"
       FROM "user_profile" WHERE "userId" = $1`,
      [userId]
    );
    if (rows.length === 0) return DEFAULT_PROFILE(userId);

    const r = rows[0] as {
      userId: string;
      riskTolerance: string | null;
      investmentGoals: string[] | null;
      horizon: string | null;
      disclaimerAcceptedAt: Date | null;
      preferences: Record<string, unknown> | null;
      updatedAt: Date;
    };
    return {
      userId: r.userId,
      riskTolerance: (r.riskTolerance as RiskTolerance | null) ?? null,
      investmentGoals: (r.investmentGoals as InvestmentGoal[] | null) ?? [],
      horizon: (r.horizon as Horizon | null) ?? null,
      preferences: (r.preferences as UserProfile["preferences"]) ?? {},
      disclaimerAcceptedAt: r.disclaimerAcceptedAt
        ? new Date(r.disclaimerAcceptedAt).toISOString()
        : null,
      updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : null,
    };
  } catch (err) {
    log.warn("user-profile", "read failed", { userId, ...errorInfo(err) });
    return DEFAULT_PROFILE(userId);
  }
}

export type ProfileUpdate = {
  riskTolerance?: RiskTolerance | null;
  investmentGoals?: InvestmentGoal[];
  horizon?: Horizon | null;
  preferences?: UserProfile["preferences"];
};

function sanitizeUpdate(input: ProfileUpdate): ProfileUpdate {
  const out: ProfileUpdate = {};
  if (input.riskTolerance !== undefined) {
    out.riskTolerance =
      input.riskTolerance === null
        ? null
        : RISK_TOLERANCES.includes(input.riskTolerance)
        ? input.riskTolerance
        : null;
  }
  if (input.horizon !== undefined) {
    out.horizon =
      input.horizon === null
        ? null
        : HORIZONS.includes(input.horizon)
        ? input.horizon
        : null;
  }
  if (input.investmentGoals !== undefined) {
    out.investmentGoals = (input.investmentGoals ?? [])
      .filter((g): g is InvestmentGoal => INVESTMENT_GOALS.includes(g))
      .slice(0, INVESTMENT_GOALS.length);
  }
  if (input.preferences !== undefined) {
    const p = input.preferences ?? {};
    out.preferences = {
      excludedSectors: Array.isArray(p.excludedSectors)
        ? p.excludedSectors
            .filter((s): s is string => typeof s === "string")
            .slice(0, 15)
            .map((s) => s.slice(0, 60))
        : undefined,
      esgPreference:
        typeof p.esgPreference === "boolean" ? p.esgPreference : undefined,
      notes:
        typeof p.notes === "string" ? p.notes.slice(0, 500) : undefined,
    };
  }
  return out;
}

export async function upsertUserProfile(
  userId: string,
  update: ProfileUpdate
): Promise<UserProfile> {
  const safe = sanitizeUpdate(update);

  try {
    await pool.query(
      `INSERT INTO "user_profile"
         ("userId", "riskTolerance", "investmentGoals", horizon, preferences, "updatedAt")
       VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
       ON CONFLICT ("userId") DO UPDATE SET
         "riskTolerance" = COALESCE(EXCLUDED."riskTolerance", "user_profile"."riskTolerance"),
         "investmentGoals" = COALESCE(EXCLUDED."investmentGoals", "user_profile"."investmentGoals"),
         horizon = COALESCE(EXCLUDED.horizon, "user_profile".horizon),
         preferences = COALESCE(EXCLUDED.preferences, "user_profile".preferences),
         "updatedAt" = NOW()`,
      [
        userId,
        safe.riskTolerance ?? null,
        safe.investmentGoals ?? null,
        safe.horizon ?? null,
        safe.preferences !== undefined ? JSON.stringify(safe.preferences) : null,
      ]
    );
  } catch (err) {
    log.error("user-profile", "upsert failed", { userId, ...errorInfo(err) });
  }
  return getUserProfile(userId);
}

/**
 * Build a concise persona rider for injection into analyst system prompts.
 * Returns null when the profile is empty so analysts behave normally.
 *
 * Design intent: STEER, don't filter. We still produce the full verdict
 * (BUY/HOLD/SELL) from the model's core lens; we only add context that
 * tilts the analysis toward the user's situation. The AI isn't told to
 * skip tickers or withhold recommendations. Excluded sectors become a
 * soft mention ("user has flagged these sectors out of scope for their
 * portfolio — keep analysis generic if relevant").
 */
export function buildProfileRider(p: UserProfile): string | null {
  const parts: string[] = [];
  if (p.riskTolerance) {
    parts.push(`risk tolerance: ${p.riskTolerance}`);
  }
  if (p.horizon) {
    const horizonLabel = {
      short: "short (<2 years)",
      medium: "medium (2–7 years)",
      long: "long (7+ years)",
    }[p.horizon];
    parts.push(`time horizon: ${horizonLabel}`);
  }
  if (p.investmentGoals.length > 0) {
    parts.push(`goals: ${p.investmentGoals.join(", ")}`);
  }
  if (
    p.preferences.excludedSectors &&
    p.preferences.excludedSectors.length > 0
  ) {
    parts.push(
      `user has flagged these sectors as out-of-scope for their own portfolio: ${p.preferences.excludedSectors.join(", ")}`
    );
  }
  if (p.preferences.esgPreference) {
    parts.push("user prefers ESG-aligned investments");
  }
  if (p.preferences.notes) {
    parts.push(`user note: "${p.preferences.notes}"`);
  }

  if (parts.length === 0) return null;

  return [
    "USER CONTEXT (use to shade emphasis, NOT to skip analysis or withhold recommendations):",
    ...parts.map((x) => `- ${x}`),
    "Guidance: keep your lens's core discipline (value / growth / macro). Use this context to weight which risks and signals to emphasize. Never censor a valid BUY or SELL call because of user preference; surface it and note the mismatch.",
  ].join("\n");
}
