// src/lib/dashboard/metrics/stress-test-loader.ts
//
// Phase 4 Batch K5 — stress-test loader.
//
// Pulls the user's Fama-French factor exposure from the Batch J1
// loader and applies the hardcoded historical scenarios in
// stress-test.ts. Returns null when the exposure regression returned
// null (less than ~120 aligned daily observations of portfolio
// history) — the card renders an empty-state hint in that case.

import { getFactorExposure } from "./fama-french-loader";
import { log, errorInfo } from "../../log";
import {
  runStressScenarios,
  type StressScenarioResult,
} from "./stress-test";

/**
 * Load and run all stress scenarios for a given user. Returns null
 * when the underlying factor regression is null. Each scenario is
 * independently emitted; consumers iterate the array.
 */
export async function getStressScenarios(
  userId: string,
): Promise<StressScenarioResult[] | null> {
  try {
    const exposure = await getFactorExposure(userId);
    return runStressScenarios(exposure);
  } catch (err) {
    log.warn("stress-test-loader", "failed", {
      userId,
      ...errorInfo(err),
    });
    return null;
  }
}
