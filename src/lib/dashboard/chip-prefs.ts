// src/lib/dashboard/chip-prefs.ts
// Phase 3 Batch H — per-user chip preferences storage.
//
// Reads / writes the `user_profile.chip_prefs` JSONB column added by
// migrations/2026-05-04-chip-prefs.sql.
//
// Shape:
//
//   {
//     pinned: string[]   // tooltipKeys to render first, in this order
//     hidden: string[]   // tooltipKeys to skip rendering
//   }
//
// Both lists default to empty (`{}` in the DB collapses to both
// arrays empty). Unknown / removed tooltipKeys are tolerated — the
// renderer just ignores them, so we never throw on stale prefs.
//
// Defensive parsing: any non-array value or non-string item is
// dropped. This keeps the renderer side dead-simple — it can trust
// the loader's return value without revalidating.

import { pool } from "../db";
import { log, errorInfo } from "../log";

export interface ChipPrefs {
  pinned: string[];
  hidden: string[];
}

const EMPTY: ChipPrefs = { pinned: [], hidden: [] };

interface ChipPrefsRow {
  chip_prefs: unknown;
}

/**
 * Coerce an unknown value into a string-array safely. Any non-array
 * input → []; any non-string array element → dropped. Caps the array
 * length at 100 to bound memory in the unlikely case a malicious /
 * corrupted row stuffs the JSONB with thousands of entries.
 */
function coerceStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === "string" && item.length > 0 && item.length <= 64) {
      out.push(item);
      if (out.length >= 100) break;
    }
  }
  return out;
}

/**
 * Coerce the raw JSONB payload into a ChipPrefs. Tolerates:
 *   - null / undefined → EMPTY
 *   - empty object {} → EMPTY
 *   - missing keys → empty arrays
 *   - garbage values → empty arrays
 */
function coercePrefs(raw: unknown): ChipPrefs {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...EMPTY };
  }
  const obj = raw as Record<string, unknown>;
  return {
    pinned: coerceStringArray(obj.pinned),
    hidden: coerceStringArray(obj.hidden),
  };
}

/**
 * Read the user's chip prefs. Returns `{ pinned: [], hidden: [] }`
 * when the user_profile row doesn't exist yet, the column is empty,
 * or the read fails. Never throws.
 */
export async function getChipPrefs(userId: string): Promise<ChipPrefs> {
  try {
    const { rows } = await pool.query<ChipPrefsRow>(
      `SELECT chip_prefs
         FROM "user_profile"
        WHERE "userId" = $1
        LIMIT 1`,
      [userId],
    );
    if (rows.length === 0) return { ...EMPTY };
    return coercePrefs(rows[0].chip_prefs);
  } catch (err) {
    log.warn("chip-prefs", "getChipPrefs failed", {
      userId,
      ...errorInfo(err),
    });
    return { ...EMPTY };
  }
}

/**
 * Upsert the chip prefs JSONB. Inputs are re-coerced before write so
 * we never persist garbage even if a caller bypasses the API
 * validation. Insert path uses NOW() for updatedAt and creates a
 * fresh user_profile row if one doesn't already exist (defaults all
 * other columns).
 */
export async function saveChipPrefs(
  userId: string,
  prefs: ChipPrefs,
): Promise<void> {
  const safe = coercePrefs(prefs);
  try {
    await pool.query(
      `INSERT INTO "user_profile" ("userId", chip_prefs, "updatedAt")
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT ("userId")
       DO UPDATE SET chip_prefs = EXCLUDED.chip_prefs,
                     "updatedAt" = NOW()`,
      [userId, JSON.stringify(safe)],
    );
  } catch (err) {
    log.warn("chip-prefs", "saveChipPrefs failed", {
      userId,
      ...errorInfo(err),
    });
    throw err;
  }
}
