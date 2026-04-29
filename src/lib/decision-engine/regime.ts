import type { MarketRegime } from "./types";
import { isFiniteNumber } from "./utils";

export function classifyMarketRegime(input: {
  vix?: number | null;
  tenYearYield?: number | null;
  twoYearYield?: number | null;
  fedFunds?: number | null;
  cpiTrend?: "rising" | "falling" | "flat" | "unknown";
  unemploymentTrend?: "rising" | "falling" | "flat" | "unknown";
  spyAbove200d?: boolean | null;
  qqqAbove200d?: boolean | null;
}): MarketRegime {
  const vix = input.vix;
  const tenYear = input.tenYearYield;
  const twoYear = input.twoYearYield;
  const fedFunds = input.fedFunds;
  const cpiTrend = input.cpiTrend ?? "unknown";
  const unemploymentTrend = input.unemploymentTrend ?? "unknown";
  const spyAbove = input.spyAbove200d;
  const qqqAbove = input.qqqAbove200d;
  const missingCore = [vix, tenYear, twoYear, fedFunds].filter(
    (v) => !isFiniteNumber(v)
  ).length;
  const noTrend =
    cpiTrend === "unknown" &&
    unemploymentTrend === "unknown" &&
    spyAbove == null &&
    qqqAbove == null;

  if (missingCore >= 3 && noTrend) return "INSUFFICIENT_DATA";
  if (isFiniteNumber(vix) && vix > 30) return "HIGH_VOLATILITY_RISK_OFF";

  const equityTrendWeak = spyAbove === false || qqqAbove === false;
  if (isFiniteNumber(vix) && vix > 24 && equityTrendWeak) {
    return "LIQUIDITY_STRESS";
  }

  const inverted =
    isFiniteNumber(tenYear) && isFiniteNumber(twoYear)
      ? tenYear < twoYear - 0.1
      : false;
  if (inverted && unemploymentTrend === "rising") return "RECESSION_RISK";

  const yieldsElevated =
    (isFiniteNumber(tenYear) && tenYear >= 4.5) ||
    (isFiniteNumber(twoYear) && twoYear >= 4.75) ||
    (isFiniteNumber(fedFunds) && fedFunds >= 5);
  if (cpiTrend === "rising" && yieldsElevated) return "RATE_PRESSURE";

  if (
    spyAbove === true &&
    qqqAbove === true &&
    (!isFiniteNumber(vix) || vix < 20)
  ) {
    return "RISK_ON";
  }

  if (
    inverted ||
    cpiTrend === "rising" ||
    unemploymentTrend === "rising" ||
    (isFiniteNumber(vix) && vix >= 20 && vix <= 24)
  ) {
    return "LATE_CYCLE_CAUTION";
  }

  if (isFiniteNumber(vix) && vix < 18 && !equityTrendWeak) {
    return "RISK_ON";
  }

  return "NEUTRAL";
}
