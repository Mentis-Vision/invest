import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db", () => ({ pool: { query: vi.fn() } }));
vi.mock("../plaid", () => ({
  plaidClient: vi.fn(),
  getAccessTokenForItem: vi.fn().mockResolvedValue("access-token-stub"),
}));
vi.mock("../snaptrade", () => ({
  encryptSecret: vi.fn((s: string) => `v2:fake:${s}`),
}));
vi.mock("./normalize", () => ({
  normalizeAction: vi.fn((_src: string, raw: string) =>
    raw === "buy" ? "buy" : "other",
  ),
}));

import { pool } from "../db";
import { plaidClient } from "../plaid";
import { backfillPlaidItem } from "./plaid-loader";

const Q = pool.query as unknown as ReturnType<typeof vi.fn>;
const PC = plaidClient as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  Q.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe("backfillPlaidItem", () => {
  it("returns inserted=0 when no transactions", async () => {
    PC.mockReturnValue({
      investmentsTransactionsGet: vi.fn().mockResolvedValue({
        data: {
          investment_transactions: [],
          securities: [],
          total_investment_transactions: 0,
        },
      }),
    });
    const out = await backfillPlaidItem("user_a", "item_1", "acct_1");
    expect(out.inserted).toBe(0);
  });

  it("inserts and reports earliest date across pages", async () => {
    const txnPage1 = Array.from({ length: 100 }, (_, i) => ({
      investment_transaction_id: `tx${i}`,
      account_id: "acct_1",
      type: "buy",
      subtype: "buy",
      date: i === 0 ? "2024-05-04" : "2025-01-15",
      quantity: 1,
      price: 100,
      amount: -100,
      fees: 0,
      iso_currency_code: "USD",
      security_id: "sec1",
    }));
    const txnPage2 = [
      {
        investment_transaction_id: "tx_last",
        account_id: "acct_1",
        type: "buy",
        subtype: "buy",
        date: "2025-03-01",
        quantity: 1,
        price: 100,
        amount: -100,
        fees: 0,
        iso_currency_code: "USD",
        security_id: "sec1",
      },
    ];
    const securities = [
      { security_id: "sec1", ticker_symbol: "AAPL", name: "Apple Inc" },
    ];

    const calls: number[] = [];
    PC.mockReturnValue({
      investmentsTransactionsGet: vi
        .fn()
        .mockImplementation((args: { options?: { offset?: number } }) => {
          const offset = args.options?.offset ?? 0;
          calls.push(offset);
          if (offset === 0) {
            return Promise.resolve({
              data: {
                investment_transactions: txnPage1,
                securities,
                total_investment_transactions: 101,
              },
            });
          }
          return Promise.resolve({
            data: {
              investment_transactions: txnPage2,
              securities,
              total_investment_transactions: 101,
            },
          });
        }),
    });
    Q.mockResolvedValue({ rowCount: 1, rows: [] });

    const out = await backfillPlaidItem("user_a", "item_1", "acct_1");
    expect(out.inserted).toBe(101);
    expect(out.earliestTxnDate).toBe("2024-05-04");
    expect(calls).toEqual([0, 100]);
  });

  it("returns 0 when no access token", async () => {
    const { getAccessTokenForItem } = await import("../plaid");
    (getAccessTokenForItem as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const out = await backfillPlaidItem("user_a", "item_1", "acct_1");
    expect(out.inserted).toBe(0);
  });
});
