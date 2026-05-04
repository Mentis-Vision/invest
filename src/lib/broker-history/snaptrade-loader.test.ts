import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db", () => ({ pool: { query: vi.fn() } }));
vi.mock("../snaptrade", () => ({
  snaptradeClient: vi.fn(),
  ensureSnaptradeUser: vi.fn().mockResolvedValue({
    snaptradeUserId: "stu_user_a",
    userSecret: "secret",
  }),
  encryptSecret: vi.fn((s: string) => `v2:fake:${s}`),
}));
vi.mock("./normalize", () => ({
  normalizeAction: vi.fn((_src: string, raw: string) =>
    raw === "BUY" ? "buy" : raw === "SELL" ? "sell" : "other",
  ),
}));

import { pool } from "../db";
import { snaptradeClient } from "../snaptrade";
import { backfillSnaptradeAccount } from "./snaptrade-loader";

const Q = pool.query as unknown as ReturnType<typeof vi.fn>;
const SC = snaptradeClient as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  Q.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe("backfillSnaptradeAccount", () => {
  it("returns inserted=0 when no activities returned", async () => {
    SC.mockReturnValue({
      transactionsAndReporting: {
        getActivities: vi.fn().mockResolvedValue({ data: [] }),
      },
    });
    const out = await backfillSnaptradeAccount("user_a", "auth_1");
    expect(out.inserted).toBe(0);
    expect(out.earliestTxnDate).toBeNull();
    expect(out.unknownActionCount).toBe(0);
  });

  it("inserts activities and reports earliest date", async () => {
    SC.mockReturnValue({
      transactionsAndReporting: {
        getActivities: vi.fn().mockResolvedValue({
          data: [
            {
              id: "tx1",
              trade_date: "2024-05-04",
              action: "BUY",
              symbol: { symbol: "AAPL" },
              units: 10,
              price: 150,
              amount: -1500,
              fee: 1,
              currency: { code: "USD" },
            },
            {
              id: "tx2",
              trade_date: "2025-01-15",
              action: "BUY",
              symbol: { symbol: "NVDA" },
              units: 5,
              price: 600,
              amount: -3000,
              fee: 1,
              currency: { code: "USD" },
            },
          ],
        }),
      },
    });
    Q.mockResolvedValue({ rowCount: 1, rows: [] });
    const out = await backfillSnaptradeAccount("user_a", "auth_1");
    expect(out.inserted).toBe(2);
    expect(out.earliestTxnDate).toBe("2024-05-04");
  });

  it("counts unknown actions in telemetry", async () => {
    SC.mockReturnValue({
      transactionsAndReporting: {
        getActivities: vi.fn().mockResolvedValue({
          data: [
            {
              id: "tx1",
              trade_date: "2024-05-04",
              action: "WEIRD_BROKER_THING",
              symbol: null,
              units: 0,
              price: 0,
              amount: 0,
              fee: 0,
              currency: { code: "USD" },
            },
          ],
        }),
      },
    });
    Q.mockResolvedValue({ rowCount: 1, rows: [] });
    const out = await backfillSnaptradeAccount("user_a", "auth_1");
    expect(out.unknownActionCount).toBe(1);
  });

  it("skips activities with no id or trade_date", async () => {
    SC.mockReturnValue({
      transactionsAndReporting: {
        getActivities: vi.fn().mockResolvedValue({
          data: [
            {
              id: "tx1",
              trade_date: "2024-05-04",
              action: "BUY",
              symbol: { symbol: "AAPL" },
              units: 10,
              price: 150,
              amount: -1500,
              fee: 1,
              currency: { code: "USD" },
            },
            { id: null, trade_date: "2025-01-15", action: "BUY" }, // no id
            { id: "tx3" }, // no trade_date
          ],
        }),
      },
    });
    Q.mockResolvedValue({ rowCount: 1, rows: [] });
    const out = await backfillSnaptradeAccount("user_a", "auth_1");
    expect(out.inserted).toBe(1);
  });
});
