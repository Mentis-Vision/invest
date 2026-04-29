import { describe, expect, it } from "vitest";
import { redactLogPayload } from "./log";

describe("redactLogPayload", () => {
  it("redacts sensitive fields and preserves safe fields", () => {
    expect(
      redactLogPayload({
        email: "investor@example.com",
        ip: "203.0.113.10",
        to: "ops@example.com",
        seenAt: new Date("2026-04-29T00:00:00.000Z"),
        count: BigInt(1),
        nested: { accessToken: "secret", ticker: "SPY" },
      })
    ).toEqual({
      email: "[redacted]",
      ip: "[redacted]",
      to: "[redacted]",
      seenAt: "2026-04-29T00:00:00.000Z",
      count: "1",
      nested: { accessToken: "[redacted]", ticker: "SPY" },
    });
  });

  it("handles circular objects without throwing", () => {
    const circular: Record<string, unknown> = { ticker: "SPY" };
    circular.self = circular;

    expect(redactLogPayload(circular)).toEqual({
      ticker: "SPY",
      self: "[circular]",
    });
  });
});
