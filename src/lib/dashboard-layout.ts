import { pool } from "./db";
import { log, errorInfo } from "./log";

/**
 * Dashboard layout persistence.
 *
 * A layout is an ordered list of blocks — each with a stable `id` that
 * maps to a registered block component, and a `size` (CSS grid col-span
 * value 3, 4, 6, 8, or 12). Stored as a single JSONB column per user.
 *
 * Why one row per user, not one row per block:
 *   - Typical layouts are 6-12 blocks; the whole thing fits in one JSONB.
 *   - Updates are atomic — reordering is a single UPDATE.
 *   - No join on read; dashboard-layout is a single SELECT.
 *
 * Block IDs are opaque strings defined in `dashboard-blocks.ts`. When a
 * block ID in the saved layout no longer exists in the registry (e.g.
 * we remove a block), the grid just skips it silently — no migration
 * dance required.
 */

export type BlockSize = 3 | 4 | 6 | 8 | 12;

export type LayoutBlock = {
  id: string;
  size: BlockSize;
};

export const DEFAULT_LAYOUT: LayoutBlock[] = [
  // Note: the "summary" block (Portfolio summary — total value, day
  // change, positions, cash, hit rate) was removed in Phase 8 because
  // PortfolioHero above the BlockGrid renders the same data. Keeping
  // it would have shown the same numbers twice on first-visit users.
  { id: "holdings", size: 8 },
  { id: "alerts", size: 4 },
  { id: "chart", size: 6 },
  { id: "news", size: 6 },
  { id: "calendar", size: 4 },
  { id: "sector", size: 4 },
  { id: "research", size: 4 },
];

function normalizeBlock(raw: unknown): LayoutBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  const sz = Number(r.size);
  if (![3, 4, 6, 8, 12].includes(sz)) return null;
  return { id: r.id, size: sz as BlockSize };
}

/**
 * Read a user's dashboard layout. Falls back to DEFAULT_LAYOUT on:
 *   - no row for the user (first-time sign-in)
 *   - empty blocks array
 *   - any DB error
 * Always returns a usable layout — the UI never has to handle null.
 */
export async function getDashboardLayout(
  userId: string
): Promise<LayoutBlock[]> {
  try {
    const { rows } = await pool.query(
      `SELECT blocks FROM "dashboard_layout" WHERE "userId" = $1 LIMIT 1`,
      [userId]
    );
    if (rows.length === 0) return DEFAULT_LAYOUT;
    const raw = rows[0].blocks as unknown;
    if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_LAYOUT;
    const normalized = raw
      .map(normalizeBlock)
      .filter((b): b is LayoutBlock => b !== null);
    return normalized.length > 0 ? normalized : DEFAULT_LAYOUT;
  } catch (err) {
    log.warn("dashboard-layout", "read failed", { userId, ...errorInfo(err) });
    return DEFAULT_LAYOUT;
  }
}

/**
 * Save a user's dashboard layout. Upserts by userId. Validates each
 * block strictly — unknown shapes are dropped before persisting so we
 * never store garbage.
 */
export async function saveDashboardLayout(
  userId: string,
  blocks: unknown
): Promise<{ ok: boolean; blocks: LayoutBlock[] }> {
  if (!Array.isArray(blocks)) return { ok: false, blocks: DEFAULT_LAYOUT };
  const normalized = blocks
    .map(normalizeBlock)
    .filter((b): b is LayoutBlock => b !== null)
    // Cap at 20 blocks to prevent runaway layouts.
    .slice(0, 20);
  try {
    await pool.query(
      `INSERT INTO "dashboard_layout" ("userId", blocks, "updatedAt")
         VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT ("userId") DO UPDATE SET
         blocks = EXCLUDED.blocks,
         "updatedAt" = NOW()`,
      [userId, JSON.stringify(normalized)]
    );
    return { ok: true, blocks: normalized };
  } catch (err) {
    log.error("dashboard-layout", "save failed", {
      userId,
      ...errorInfo(err),
    });
    return { ok: false, blocks: DEFAULT_LAYOUT };
  }
}
