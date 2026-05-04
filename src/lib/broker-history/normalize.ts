// src/lib/broker-history/normalize.ts
// Maps broker-specific transaction types to a canonical action.
// Per AGENTS.md trust tenet: unknown types fall back to 'other' rather
// than being silently mapped — log them in telemetry for mapper expansion.

import type { BrokerSource, CanonicalAction } from "./types";

const SNAPTRADE_MAP: Record<string, CanonicalAction> = {
  BUY: "buy", MARKET_BUY: "buy", LIMIT_BUY: "buy",
  SELL: "sell", MARKET_SELL: "sell", LIMIT_SELL: "sell",
  DIVIDEND: "dividend", DIV: "dividend", REINVESTMENT_DIV: "dividend",
  INTEREST: "interest", INT_INCOME: "interest",
  STOCK_SPLIT: "split", SPLIT: "split",
  TRANSFER_IN: "transfer", TRANSFER_OUT: "transfer", JNL: "transfer",
  COMMISSION: "fee", REGFEE: "fee", FEE: "fee",
  CONTRIBUTION: "contribution", DEPOSIT: "contribution",
  WITHDRAWAL: "withdrawal",
};

const PLAID_MAP: Record<string, CanonicalAction> = {
  buy: "buy",
  sell: "sell",
  dividend: "dividend",
  interest: "interest",
  transfer: "transfer",
  deposit: "contribution",
  withdrawal: "withdrawal",
  fee: "fee",
};

export function normalizeAction(source: BrokerSource, raw: string): CanonicalAction {
  if (!raw) return "other";
  if (source === "snaptrade") {
    return SNAPTRADE_MAP[raw.toUpperCase()] ?? "other";
  }
  return PLAID_MAP[raw.toLowerCase()] ?? "other";
}
