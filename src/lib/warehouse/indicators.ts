import { RSI, MACD, BollingerBands } from "technicalindicators";

/**
 * Pure computation of technical indicators from OHLC close series.
 * All inputs: array of numbers, oldest first, newest last.
 * All outputs: the latest single value (null if insufficient history).
 *
 * Used by the nightly warehouse refresh to compute signals without an
 * external data call.
 */

/** 14-day RSI — null if closes.length < 15. */
export function computeRsi14(closes: number[]): number | null {
  if (closes.length < 15) return null;
  const series = RSI.calculate({ values: closes, period: 14 });
  const last = series[series.length - 1];
  return typeof last === "number" && Number.isFinite(last) ? last : null;
}

/** MACD and signal line (12/26/9). Null if closes.length < 35. */
export function computeMacd(closes: number[]): {
  macd: number | null;
  signal: number | null;
} {
  if (closes.length < 35) return { macd: null, signal: null };
  const series = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  const last = series[series.length - 1];
  if (!last) return { macd: null, signal: null };
  return {
    macd: typeof last.MACD === "number" && Number.isFinite(last.MACD) ? last.MACD : null,
    signal:
      typeof last.signal === "number" && Number.isFinite(last.signal)
        ? last.signal
        : null,
  };
}

/** Bollinger Bands (20 SMA, 2 stdev). Null if closes.length < 20. */
export function computeBollinger(closes: number[]): {
  upper: number | null;
  lower: number | null;
} {
  if (closes.length < 20) return { upper: null, lower: null };
  const series = BollingerBands.calculate({
    values: closes,
    period: 20,
    stdDev: 2,
  });
  const last = series[series.length - 1];
  if (!last) return { upper: null, lower: null };
  return {
    upper:
      typeof last.upper === "number" && Number.isFinite(last.upper)
        ? last.upper
        : null,
    lower:
      typeof last.lower === "number" && Number.isFinite(last.lower)
        ? last.lower
        : null,
  };
}

/** Simple moving average of the last N values. */
export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

/**
 * 20-day VWAP — requires close + volume arrays of equal length.
 * Returns null if insufficient data.
 */
export function vwap20d(closes: number[], volumes: number[]): number | null {
  if (closes.length !== volumes.length) return null;
  if (closes.length < 20) return null;
  const closeSlice = closes.slice(-20);
  const volSlice = volumes.slice(-20);
  let num = 0;
  let denom = 0;
  for (let i = 0; i < 20; i++) {
    num += closeSlice[i] * volSlice[i];
    denom += volSlice[i];
  }
  return denom > 0 ? num / denom : null;
}

/**
 * Relative strength over N days: (ticker_return - spy_return) in percentage points.
 * Inputs: aligned arrays of closes (oldest → newest). Null if either too short.
 */
export function relStrength(
  tickerCloses: number[],
  spyCloses: number[],
  days: number
): number | null {
  const tRet = periodReturn(tickerCloses, days);
  const sRet = periodReturn(spyCloses, days);
  if (tRet === null || sRet === null) return null;
  return (tRet - sRet) * 100;
}

function periodReturn(closes: number[], days: number): number | null {
  if (closes.length <= days) return null;
  const last = closes[closes.length - 1];
  const prior = closes[closes.length - 1 - days];
  if (!prior || prior <= 0) return null;
  return last / prior - 1;
}
