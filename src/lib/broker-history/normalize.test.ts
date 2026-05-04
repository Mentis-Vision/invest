import { describe, it, expect } from "vitest";
import { normalizeAction } from "./normalize";

describe("normalizeAction", () => {
  describe("SnapTrade types", () => {
    it("maps buy variants", () => {
      expect(normalizeAction("snaptrade", "BUY")).toBe("buy");
      expect(normalizeAction("snaptrade", "MARKET_BUY")).toBe("buy");
      expect(normalizeAction("snaptrade", "LIMIT_BUY")).toBe("buy");
      expect(normalizeAction("snaptrade", "buy")).toBe("buy");
    });
    it("maps sell variants", () => {
      expect(normalizeAction("snaptrade", "SELL")).toBe("sell");
      expect(normalizeAction("snaptrade", "MARKET_SELL")).toBe("sell");
    });
    it("maps dividend variants", () => {
      expect(normalizeAction("snaptrade", "DIVIDEND")).toBe("dividend");
      expect(normalizeAction("snaptrade", "DIV")).toBe("dividend");
      expect(normalizeAction("snaptrade", "REINVESTMENT_DIV")).toBe("dividend");
    });
    it("maps interest", () => {
      expect(normalizeAction("snaptrade", "INTEREST")).toBe("interest");
      expect(normalizeAction("snaptrade", "INT_INCOME")).toBe("interest");
    });
    it("maps splits", () => {
      expect(normalizeAction("snaptrade", "STOCK_SPLIT")).toBe("split");
      expect(normalizeAction("snaptrade", "SPLIT")).toBe("split");
    });
    it("maps transfers", () => {
      expect(normalizeAction("snaptrade", "TRANSFER_IN")).toBe("transfer");
      expect(normalizeAction("snaptrade", "JNL")).toBe("transfer");
    });
    it("maps fees", () => {
      expect(normalizeAction("snaptrade", "COMMISSION")).toBe("fee");
      expect(normalizeAction("snaptrade", "REGFEE")).toBe("fee");
    });
    it("maps contributions and withdrawals", () => {
      expect(normalizeAction("snaptrade", "CONTRIBUTION")).toBe("contribution");
      expect(normalizeAction("snaptrade", "DEPOSIT")).toBe("contribution");
      expect(normalizeAction("snaptrade", "WITHDRAWAL")).toBe("withdrawal");
    });
    it("falls back to 'other' for unknown types", () => {
      expect(normalizeAction("snaptrade", "VERY_RARE_BROKER_THING")).toBe("other");
      expect(normalizeAction("snaptrade", "")).toBe("other");
    });
  });

  describe("Plaid types", () => {
    it("maps Plaid buy/sell", () => {
      expect(normalizeAction("plaid", "buy")).toBe("buy");
      expect(normalizeAction("plaid", "sell")).toBe("sell");
    });
    it("maps Plaid cash subtype dividends/interest", () => {
      expect(normalizeAction("plaid", "dividend")).toBe("dividend");
      expect(normalizeAction("plaid", "interest")).toBe("interest");
    });
    it("maps Plaid transfer subtypes", () => {
      expect(normalizeAction("plaid", "transfer")).toBe("transfer");
      expect(normalizeAction("plaid", "deposit")).toBe("contribution");
      expect(normalizeAction("plaid", "withdrawal")).toBe("withdrawal");
    });
    it("falls back to 'other'", () => {
      expect(normalizeAction("plaid", "unknown_subtype")).toBe("other");
    });
  });
});
