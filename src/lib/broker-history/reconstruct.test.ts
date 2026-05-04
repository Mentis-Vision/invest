import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db", () => ({ pool: { query: vi.fn() } }));

import { pool } from "../db";
import { reconstructHistoricalSnapshots } from "./reconstruct";

const Q = pool.query as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("reconstructHistoricalSnapshots", () => {
  it("returns 0 when no transactions exist", async () => {
    Q.mockImplementation((sql: string) => {
      if (sql.includes("FROM broker_transactions")) return Promise.resolve({ rows: [] });
      if (sql.includes("FROM holding")) return Promise.resolve({ rows: [] });
      if (sql.includes('MIN("capturedAt")')) return Promise.resolve({ rows: [{ oldest: null }] });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const out = await reconstructHistoricalSnapshots("user_new");
    expect(out.snapshotsInserted).toBe(0);
  });

  it("never tries to insert dates on or after the earliest observed snapshot", async () => {
    let insertCalls = 0;
    const insertedDates: string[] = [];
    Q.mockImplementation((sql: string, params?: unknown[]) => {
      if (sql.includes('MIN("capturedAt")') && sql.includes("'observed'")) {
        return Promise.resolve({ rows: [{ oldest: new Date("2026-04-15T00:00:00Z") }] });
      }
      if (sql.includes("FROM holding")) {
        return Promise.resolve({ rows: [{ ticker: "AAPL", shares: 10, last_value: 2000 }] });
      }
      if (sql.includes("FROM broker_transactions")) {
        return Promise.resolve({
          rows: [
            { txn_date: "2026-04-01", action: "buy", ticker: "AAPL", quantity: 5, price: 190, amount: -950 },
            { txn_date: "2026-03-01", action: "buy", ticker: "AAPL", quantity: 5, price: 180, amount: -900 },
          ],
        });
      }
      if (sql.includes("FROM ticker_market_daily")) {
        return Promise.resolve({
          rows: [
            { ticker: "AAPL", captured_at: "2026-03-15", close: 185 },
            { ticker: "AAPL", captured_at: "2026-04-01", close: 190 },
            { ticker: "AAPL", captured_at: "2026-04-10", close: 195 },
          ],
        });
      }
      if (sql.includes("INSERT INTO portfolio_snapshot")) {
        insertCalls++;
        const date = (params?.[1] as string) ?? "";
        insertedDates.push(date);
        return Promise.resolve({ rowCount: 1, rows: [] });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    await reconstructHistoricalSnapshots("user_a");
    expect(insertCalls).toBeGreaterThan(0);
    // No insert should have a date >= 2026-04-15 (the observed cutoff)
    for (const d of insertedDates) {
      expect(d < "2026-04-15").toBe(true);
    }
  });

  it("skips dates without a price in ticker_market_daily", async () => {
    Q.mockImplementation((sql: string) => {
      if (sql.includes('MIN("capturedAt")')) {
        return Promise.resolve({ rows: [{ oldest: new Date("2026-04-15T00:00:00Z") }] });
      }
      if (sql.includes("FROM holding")) {
        return Promise.resolve({ rows: [{ ticker: "OBSCURE", shares: 100, last_value: 1000 }] });
      }
      if (sql.includes("FROM broker_transactions")) {
        return Promise.resolve({
          rows: [
            {
              txn_date: "2026-03-01",
              action: "buy",
              ticker: "OBSCURE",
              quantity: 100,
              price: 10,
              amount: -1000,
            },
          ],
        });
      }
      if (sql.includes("FROM ticker_market_daily")) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const out = await reconstructHistoricalSnapshots("user_a");
    expect(out.snapshotsInserted).toBe(0);
    expect(out.skippedDays).toBeGreaterThan(0);
  });
});
