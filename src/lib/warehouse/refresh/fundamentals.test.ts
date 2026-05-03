// src/lib/warehouse/refresh/fundamentals.test.ts
//
// Phase 4 Batch I — covers the pure XBRL extraction logic added to the
// warehouse fundamentals refresh. We don't exercise the cron path (it
// hits Yahoo + Postgres) — only enrichFromSecXbrl with a synthetic
// CompanyFacts shape.
//
// The factsOverride parameter lets tests skip the real SEC fetch and
// pass an inline fixture. Production callers always go through the
// network helper.

import { describe, it, expect } from "vitest";
import { enrichFromSecXbrl } from "./fundamentals";
import type { CompanyFacts } from "../../data/sec";

function point(
  end: string,
  val: number,
  fp: string,
  form: string,
  fy = 2024,
  filed = "2024-11-01",
) {
  return { period: end, fiscalYear: fy, fiscalPeriod: fp, value: val, form, filed };
}

function buildFacts(
  series: Record<
    string,
    Array<ReturnType<typeof point>>
  >,
): CompanyFacts {
  const out: CompanyFacts = { cik: "0000320193", entityName: "Apple Inc.", series: {} };
  for (const [tag, points] of Object.entries(series)) {
    out.series[tag] = { label: tag, unit: "USD", points };
  }
  return out;
}

describe("enrichFromSecXbrl", () => {
  it("extracts the canonical eight fields for an annual period", async () => {
    const facts = buildFacts({
      RetainedEarningsAccumulatedDeficit: [
        point("2024-09-30", 100_000_000_000, "FY", "10-K"),
      ],
      AssetsCurrent: [point("2024-09-30", 152_000_000_000, "FY", "10-K")],
      LiabilitiesCurrent: [point("2024-09-30", 176_000_000_000, "FY", "10-K")],
      AccountsReceivableNetCurrent: [
        point("2024-09-30", 33_000_000_000, "FY", "10-K"),
      ],
      DepreciationDepletionAndAmortization: [
        point("2024-09-30", 11_500_000_000, "FY", "10-K"),
      ],
      SellingGeneralAndAdministrativeExpense: [
        point("2024-09-30", 26_000_000_000, "FY", "10-K"),
      ],
      IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest:
        [point("2024-09-30", 123_000_000_000, "FY", "10-K")],
      PropertyPlantAndEquipmentNet: [
        point("2024-09-30", 45_000_000_000, "FY", "10-K"),
      ],
    });

    const enrichment = await enrichFromSecXbrl("AAPL", "annual", facts);

    expect(enrichment.retainedEarnings).toBe(100_000_000_000);
    expect(enrichment.currentAssets).toBe(152_000_000_000);
    expect(enrichment.currentLiabilities).toBe(176_000_000_000);
    expect(enrichment.accountsReceivable).toBe(33_000_000_000);
    expect(enrichment.depreciation).toBe(11_500_000_000);
    expect(enrichment.sga).toBe(26_000_000_000);
    expect(enrichment.ebit).toBe(123_000_000_000);
    expect(enrichment.propertyPlantEquipment).toBe(45_000_000_000);
  });

  it("uses the alt Depreciation tag when DDA is missing", async () => {
    const facts = buildFacts({
      Depreciation: [point("2024-09-30", 9_000_000_000, "FY", "10-K")],
    });
    const enrichment = await enrichFromSecXbrl("AAPL", "annual", facts);
    expect(enrichment.depreciation).toBe(9_000_000_000);
  });

  it("falls back to OperatingIncomeLoss for ebit when pre-tax income is missing", async () => {
    const facts = buildFacts({
      OperatingIncomeLoss: [point("2024-09-30", 100_000_000, "FY", "10-K")],
    });
    const enrichment = await enrichFromSecXbrl("AAPL", "annual", facts);
    expect(enrichment.ebit).toBe(100_000_000);
  });

  it("returns all-null when the company has no XBRL coverage", async () => {
    const enrichment = await enrichFromSecXbrl("UNKNOWN", "annual", null);
    expect(enrichment.retainedEarnings).toBeNull();
    expect(enrichment.currentAssets).toBeNull();
    expect(enrichment.currentLiabilities).toBeNull();
    expect(enrichment.accountsReceivable).toBeNull();
    expect(enrichment.depreciation).toBeNull();
    expect(enrichment.sga).toBeNull();
    expect(enrichment.ebit).toBeNull();
    expect(enrichment.propertyPlantEquipment).toBeNull();
  });

  it("returns null per-field when only some concepts are present", async () => {
    const facts = buildFacts({
      AssetsCurrent: [point("2024-09-30", 152_000_000_000, "FY", "10-K")],
      // No other tags: enrichment should populate currentAssets only.
    });
    const enrichment = await enrichFromSecXbrl("AAPL", "annual", facts);
    expect(enrichment.currentAssets).toBe(152_000_000_000);
    expect(enrichment.retainedEarnings).toBeNull();
    expect(enrichment.depreciation).toBeNull();
    expect(enrichment.ebit).toBeNull();
  });

  it("picks a quarterly point when periodType is quarterly", async () => {
    const facts = buildFacts({
      AssetsCurrent: [
        point("2024-06-30", 145_000_000_000, "Q3", "10-Q"),
        point("2024-09-30", 152_000_000_000, "FY", "10-K"),
      ],
    });
    const enrichment = await enrichFromSecXbrl("AAPL", "quarterly", facts);
    // Q3 quarterly point should be picked even though FY appears later
    // in the array — the helper filters by fiscalPeriod / form before
    // returning.
    expect(enrichment.currentAssets).toBe(145_000_000_000);
  });

  it("picks an annual point when periodType is annual", async () => {
    const facts = buildFacts({
      AssetsCurrent: [
        point("2024-06-30", 145_000_000_000, "Q3", "10-Q"),
        point("2024-09-30", 152_000_000_000, "FY", "10-K"),
      ],
    });
    const enrichment = await enrichFromSecXbrl("AAPL", "annual", facts);
    expect(enrichment.currentAssets).toBe(152_000_000_000);
  });
});
