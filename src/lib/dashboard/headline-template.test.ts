// src/lib/dashboard/headline-template.test.ts
import { describe, it, expect } from "vitest";
import { renderTemplate, type TemplateContext } from "./headline-template";

describe("renderTemplate — concentration_breach", () => {
  it("renders severe variant with delta and next event", () => {
    const ctx: TemplateContext = {
      itemType: "concentration_breach_severe",
      ticker: "NVDA",
      data: {
        deltaPp: 2,
        currentPct: 8.4,
        minCapPct: 5,
        maxCapPct: 6,
        nextEvent: "Wed CPI",
      },
    };
    const out = renderTemplate(ctx);
    expect(out.title).toContain("NVDA");
    expect(out.body).toContain("Trim NVDA");
    expect(out.body).toContain("~2pp");
    expect(out.body).toContain("Wed CPI");
    expect(out.body).toContain("8.4%");
    expect(out.body).toContain("5–6%");
    expect(out.body).not.toMatch(/\{\{|\}\}/);
  });

  it("falls back gracefully when nextEvent is missing", () => {
    const ctx: TemplateContext = {
      itemType: "concentration_breach_moderate",
      ticker: "NVDA",
      data: { deltaPp: 1, currentPct: 7.2, minCapPct: 5, maxCapPct: 6 },
    };
    const out = renderTemplate(ctx);
    expect(out.body).toMatch(/Trim NVDA/);
    expect(out.body).not.toMatch(/\{\{|\}\}|undefined|null/);
  });
});

describe("renderTemplate — stale_rec_held", () => {
  it("renders move-since-rec correctly", () => {
    const out = renderTemplate({
      itemType: "stale_rec_held",
      ticker: "AMD",
      data: {
        daysAgo: 47,
        moveSinceRec: "+12%",
        originalVerdict: "BUY",
        priceAtRec: 142,
      },
    });
    expect(out.title).toContain("AMD");
    expect(out.body).toContain("47d ago");
    expect(out.body).toContain("+12%");
    expect(out.body).toContain("BUY");
    expect(out.body).toContain("$142");
  });
});

describe("renderTemplate — catalyst_prep", () => {
  it("renders imminent earnings prep", () => {
    const out = renderTemplate({
      itemType: "catalyst_prep_imminent",
      ticker: "AMD",
      data: {
        eventName: "Q1 earnings",
        eventDate: "May 7",
        daysToEvent: 5,
        priorReaction: "+4.2%",
        currentPct: 6.1,
      },
    });
    expect(out.body).toContain("AMD reports");
    expect(out.body).toContain("Q1 earnings");
    expect(out.body).toContain("May 7");
    expect(out.body).toContain("(5d)");
    expect(out.body).toContain("+4.2%");
    expect(out.body).toContain("6.1%");
  });
});

describe("renderTemplate — tax_harvest", () => {
  it("renders aggregate loss + position count + advisor disclaimer", () => {
    const out = renderTemplate({
      itemType: "tax_harvest",
      ticker: null,
      data: {
        totalLossDollars: 1450,
        numPositions: 3,
      },
    });
    expect(out.title).toContain("$1,450");
    expect(out.title).toContain("Tax-loss harvest");
    expect(out.body).toContain("3 positions");
    expect(out.body).toContain("$1,450");
    expect(out.body).toContain("tax advisor");
    expect(out.body).toContain("wash-sale");
  });

  it("renders singular noun when only one harvestable position", () => {
    const out = renderTemplate({
      itemType: "tax_harvest",
      ticker: null,
      data: {
        totalLossDollars: 250,
        numPositions: 1,
      },
    });
    expect(out.body).toMatch(/1 position has/);
    expect(out.body).toContain("$250");
  });
});

describe("renderTemplate — outcome_action_mark", () => {
  it("renders outcome ask", () => {
    const out = renderTemplate({
      itemType: "outcome_action_mark",
      ticker: "META",
      data: {
        originalDate: "Mar 18",
        originalVerdict: "BUY",
        outcomeMove: "+8.2%",
        outcomeVerdict: "win",
      },
    });
    expect(out.body).toContain("Mar 18");
    expect(out.body).toContain("BUY");
    expect(out.body).toContain("META");
    expect(out.body).toContain("+8.2%");
    expect(out.body).toContain("win");
  });
});

describe("renderTemplate — cash_idle", () => {
  it("renders cash deploy prompt", () => {
    const out = renderTemplate({
      itemType: "cash_idle",
      ticker: null,
      data: { cashAmount: 3200, daysIdle: 14, numCandidates: 3 },
    });
    expect(out.body).toContain("$3,200");
    expect(out.body).toContain("14d");
    expect(out.body).toContain("3 BUY");
  });
});

describe("renderTemplate — broker_reauth", () => {
  it("renders reauth ask", () => {
    const out = renderTemplate({
      itemType: "broker_reauth",
      ticker: null,
      data: { brokerName: "Schwab" },
    });
    expect(out.body).toContain("Schwab");
    expect(out.body).toContain("disconnected");
    expect(out.body.toLowerCase()).toContain("reauthorize");
  });
});

describe("renderTemplate — never produces LLM-style prose", () => {
  it("output never contains prose-y AI hedge words", () => {
    const out = renderTemplate({
      itemType: "concentration_breach_severe",
      ticker: "NVDA",
      data: { deltaPp: 2, currentPct: 8.4, minCapPct: 5, maxCapPct: 6, nextEvent: "Wed CPI" },
    });
    expect(out.body.toLowerCase()).not.toMatch(/\b(perhaps|i think|maybe|seems|appears to|likely)\b/);
  });
});
