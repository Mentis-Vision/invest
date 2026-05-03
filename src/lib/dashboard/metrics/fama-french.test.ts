// src/lib/dashboard/metrics/fama-french.test.ts
//
// Synthetic-data tests for the Fama-French regression. We construct a
// series whose returns are a known linear combination of the factors
// plus a small intercept and noise, then assert the regression
// recovers the betas to within tolerance.

import { describe, it, expect } from "vitest";
import {
  regressFactors,
  interpretExposure,
  type FactorReturns,
} from "./fama-french";

/**
 * Mulberry32 — fast deterministic PRNG. Only used here so factor
 * inputs are reproducible and the tolerance assertions don't flake.
 */
function makePrng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build N observations of factor returns sampled from a normal-ish
 * distribution. Values are kept in a daily-fractional range
 * (~±2%) so the resulting "portfolio" return doesn't blow up.
 */
function buildFactors(n: number, seed: number): FactorReturns {
  const rng = makePrng(seed);
  const rand = () => (rng() - 0.5) * 0.04; // ±2% per day
  const mktRf: number[] = [];
  const smb: number[] = [];
  const hml: number[] = [];
  const rf: number[] = [];
  for (let i = 0; i < n; i++) {
    mktRf.push(rand());
    smb.push(rand());
    hml.push(rand());
    rf.push(0.04 / 252); // flat 4% annual
  }
  return { mktRf, smb, hml, rf };
}

describe("regressFactors", () => {
  it("recovers known betas (3-factor) within tolerance", () => {
    const n = 252;
    const factors = buildFactors(n, 42);
    const trueBetas = { mktRf: 1.05, smb: 0.35, hml: -0.25 };
    const trueAlphaDaily = 0.0001; // ~2.5% annualized
    const noiseRng = makePrng(7);
    const portfolio: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const eps = (noiseRng() - 0.5) * 0.001; // 5bp/day noise
      portfolio[i] =
        factors.rf[i] +
        trueAlphaDaily +
        trueBetas.mktRf * factors.mktRf[i] +
        trueBetas.smb * factors.smb[i] +
        trueBetas.hml * factors.hml[i] +
        eps;
    }

    const result = regressFactors(portfolio, factors);
    expect(result).not.toBeNull();
    const r = result!;
    expect(r.betas.mktRf).toBeCloseTo(trueBetas.mktRf, 1);
    expect(r.betas.smb).toBeCloseTo(trueBetas.smb, 1);
    expect(r.betas.hml).toBeCloseTo(trueBetas.hml, 1);
    expect(r.alpha).toBeCloseTo(trueAlphaDaily * 252, 1);
    expect(r.rSquared).toBeGreaterThan(0.9);
    expect(r.observations).toBe(n);
    expect(r.fiveFactor).toBe(false);
  });

  it("recovers 5-factor betas when rmw + cma supplied", () => {
    const n = 300;
    const baseFactors = buildFactors(n, 99);
    const rng = makePrng(13);
    const rmw: number[] = [];
    const cma: number[] = [];
    for (let i = 0; i < n; i++) {
      rmw.push((rng() - 0.5) * 0.04);
      cma.push((rng() - 0.5) * 0.04);
    }
    const factors: FactorReturns = { ...baseFactors, rmw, cma };
    const trueBetas = { mktRf: 0.95, smb: 0.1, hml: 0.05, rmw: 0.4, cma: -0.2 };
    const portfolio: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      portfolio[i] =
        factors.rf[i] +
        trueBetas.mktRf * factors.mktRf[i] +
        trueBetas.smb * factors.smb[i] +
        trueBetas.hml * factors.hml[i] +
        trueBetas.rmw * rmw[i] +
        trueBetas.cma * cma[i];
    }

    const result = regressFactors(portfolio, factors);
    expect(result).not.toBeNull();
    const r = result!;
    expect(r.fiveFactor).toBe(true);
    expect(r.betas.rmw).toBeCloseTo(trueBetas.rmw, 1);
    expect(r.betas.cma).toBeCloseTo(trueBetas.cma, 1);
    expect(r.rSquared).toBeGreaterThan(0.99);
  });

  it("returns null when sample is too small", () => {
    const n = 30;
    const factors = buildFactors(n, 1);
    const portfolio = new Array(n).fill(0.001);
    const result = regressFactors(portfolio, factors);
    expect(result).toBeNull();
  });

  it("returns null on length mismatch", () => {
    const factors = buildFactors(100, 1);
    const portfolio = new Array(99).fill(0);
    const result = regressFactors(portfolio, factors);
    expect(result).toBeNull();
  });

  it("returns null on non-finite inputs", () => {
    const factors = buildFactors(252, 1);
    const portfolio = new Array(252).fill(0);
    portfolio[10] = Number.NaN;
    const result = regressFactors(portfolio, factors);
    expect(result).toBeNull();
  });
});

describe("interpretExposure", () => {
  it("flags small-cap value tilt", () => {
    const exp = {
      alpha: 0,
      betas: { mktRf: 1.0, smb: 0.5, hml: 0.4 },
      rSquared: 0.7,
      observations: 252,
      fiveFactor: false,
    };
    expect(interpretExposure(exp).tilt).toBe("small-cap value");
  });

  it("flags large-cap growth tilt", () => {
    const exp = {
      alpha: 0,
      betas: { mktRf: 1.0, smb: -0.3, hml: -0.4 },
      rSquared: 0.8,
      observations: 252,
      fiveFactor: false,
    };
    expect(interpretExposure(exp).tilt).toBe("large-cap growth");
  });

  it("returns broad-market when neither size nor value tilts", () => {
    const exp = {
      alpha: 0,
      betas: { mktRf: 1.0, smb: 0.05, hml: -0.1 },
      rSquared: 0.85,
      observations: 252,
      fiveFactor: false,
    };
    expect(interpretExposure(exp).tilt).toBe("broad-market");
  });

  it("flags high beta when MktRF beta > 1.1", () => {
    const exp = {
      alpha: 0,
      betas: { mktRf: 1.25, smb: 0, hml: 0 },
      rSquared: 0.7,
      observations: 252,
      fiveFactor: false,
    };
    expect(interpretExposure(exp).betaTag).toContain("high beta");
  });

  it("marks regression unmeaningful when R² < 0.3", () => {
    const exp = {
      alpha: 0,
      betas: { mktRf: 1.0, smb: 0, hml: 0 },
      rSquared: 0.1,
      observations: 252,
      fiveFactor: false,
    };
    expect(interpretExposure(exp).meaningful).toBe(false);
  });
});
