// src/lib/dashboard/chip-prefs.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db", () => ({
  pool: { query: vi.fn() },
}));

vi.mock("../log", () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  errorInfo: (err: unknown) => ({ err: String(err) }),
}));

import { getChipPrefs, saveChipPrefs } from "./chip-prefs";
import { pool } from "../db";

const Q = pool.query as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getChipPrefs", () => {
  it("returns empty prefs when user has no row", async () => {
    Q.mockResolvedValueOnce({ rows: [] });
    const prefs = await getChipPrefs("user_a");
    expect(prefs).toEqual({ pinned: [], hidden: [] });
  });

  it("returns parsed prefs when JSONB is populated", async () => {
    Q.mockResolvedValueOnce({
      rows: [
        {
          chip_prefs: {
            pinned: ["F-Score", "TQ"],
            hidden: ["accruals"],
          },
        },
      ],
    });
    const prefs = await getChipPrefs("user_a");
    expect(prefs.pinned).toEqual(["F-Score", "TQ"]);
    expect(prefs.hidden).toEqual(["accruals"]);
  });

  it("returns empty when chip_prefs is empty object", async () => {
    Q.mockResolvedValueOnce({ rows: [{ chip_prefs: {} }] });
    const prefs = await getChipPrefs("user_a");
    expect(prefs).toEqual({ pinned: [], hidden: [] });
  });

  it("drops non-string array entries", async () => {
    Q.mockResolvedValueOnce({
      rows: [
        {
          chip_prefs: {
            pinned: ["F-Score", 42, null, "TQ"],
            hidden: [],
          },
        },
      ],
    });
    const prefs = await getChipPrefs("user_a");
    expect(prefs.pinned).toEqual(["F-Score", "TQ"]);
  });

  it("returns empty when chip_prefs is null", async () => {
    Q.mockResolvedValueOnce({ rows: [{ chip_prefs: null }] });
    const prefs = await getChipPrefs("user_a");
    expect(prefs).toEqual({ pinned: [], hidden: [] });
  });

  it("degrades to empty on DB failure", async () => {
    Q.mockRejectedValueOnce(new Error("boom"));
    const prefs = await getChipPrefs("user_a");
    expect(prefs).toEqual({ pinned: [], hidden: [] });
  });
});

describe("saveChipPrefs", () => {
  it("upserts the prefs as JSON", async () => {
    Q.mockResolvedValueOnce({ rows: [] });
    await saveChipPrefs("user_a", {
      pinned: ["F-Score"],
      hidden: ["mom"],
    });
    expect(Q).toHaveBeenCalledTimes(1);
    const args = Q.mock.calls[0];
    expect(String(args[0])).toContain("user_profile");
    expect(args[1]?.[0]).toBe("user_a");
    const payload = JSON.parse(args[1]?.[1] as string);
    expect(payload.pinned).toEqual(["F-Score"]);
    expect(payload.hidden).toEqual(["mom"]);
  });

  it("re-coerces garbage input before writing", async () => {
    Q.mockResolvedValueOnce({ rows: [] });
    // @ts-expect-error — intentionally bypassing types to verify
    // defensive coercion at the storage layer.
    await saveChipPrefs("user_a", { pinned: "not-an-array", hidden: [42] });
    const payload = JSON.parse(Q.mock.calls[0][1][1] as string);
    expect(payload.pinned).toEqual([]);
    expect(payload.hidden).toEqual([]);
  });
});
