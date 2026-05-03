// src/lib/dashboard/headline-template.ts
// Deterministic template rendering for Daily Headline + Decision Queue body text.
// Spec §5.2. Zero LLM calls. Same inputs → same outputs.

import type { ItemTypeKey } from "./types";

export interface TemplateContext {
  itemType: ItemTypeKey;
  ticker: string | null;
  data: Record<string, string | number | null | undefined>;
}

export interface TemplateOutput {
  title: string;
  body: string;
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

function fmtPct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}

function fmtSign(s: string | number | undefined): string {
  if (s === undefined || s === null) return "flat";
  if (typeof s === "number") return s >= 0 ? `+${fmtPct(s)}` : fmtPct(s);
  return String(s);
}

export function renderTemplate(ctx: TemplateContext): TemplateOutput {
  const { itemType, ticker, data } = ctx;
  const t = ticker ?? "";

  switch (itemType) {
    case "concentration_breach_severe":
    case "concentration_breach_moderate": {
      const delta = data.deltaPp as number;
      const cur = data.currentPct as number;
      const min = data.minCapPct as number;
      const max = data.maxCapPct as number;
      const evt = data.nextEvent as string | undefined;
      const tail = evt ? ` before ${evt}` : "";
      return {
        title: `${t} concentration ${fmtPct(cur)} — above your cap`,
        body: `Trim ${t} by ~${delta}pp${tail}. Concentration is ${fmtPct(cur)}, your cap is ${min}–${max}%.`,
      };
    }

    case "stale_rec_held":
    case "stale_rec_watched": {
      const days = data.daysAgo as number;
      const move = String(data.moveSinceRec ?? "flat");
      const verdict = String(data.originalVerdict ?? "HOLD");
      const price = data.priceAtRec as number;
      return {
        title: `${t} thesis is ${days}d old`,
        body: `Re-research ${t} — last analyzed ${days}d ago, price ${move} since ${verdict} at ${fmtMoney(price)}.`,
      };
    }

    case "catalyst_prep_imminent":
    case "catalyst_prep_upcoming": {
      const eventName = String(data.eventName ?? "earnings");
      const eventDate = String(data.eventDate ?? "soon");
      const dte = data.daysToEvent as number;
      const prior = data.priorReaction
        ? `Last earnings reaction: ${data.priorReaction}.`
        : "";
      const pos = data.currentPct as number;
      const posStr = Number.isFinite(pos)
        ? ` Position is ${fmtPct(pos)} of portfolio.`
        : "";
      return {
        title: `${t} reports ${eventName} on ${eventDate}`,
        body: `${t} reports ${eventName} on ${eventDate} (${dte}d). ${prior}${posStr}`.trim(),
      };
    }

    case "outcome_action_mark": {
      const origDate = String(data.originalDate ?? "earlier");
      const origVerdict = String(data.originalVerdict ?? "HOLD");
      const move = fmtSign(data.outcomeMove);
      const ov = String(data.outcomeVerdict ?? "scored");
      return {
        title: `${t} outcome — ${ov}`,
        body: `Did you act on the ${origDate} ${origVerdict} on ${t}? Outcome scored ${move} (${ov}).`,
      };
    }

    case "cash_idle": {
      const cash = data.cashAmount as number;
      const idle = data.daysIdle as number;
      const cands = data.numCandidates as number;
      return {
        title: `${fmtMoney(cash)} idle for ${idle}d`,
        body: `${fmtMoney(cash)} idle for ${idle}d. ${cands} BUY-rated candidates fit your sector budget.`,
      };
    }

    case "broker_reauth": {
      const broker = String(data.brokerName ?? "Your broker");
      return {
        title: `${broker} disconnected`,
        body: `${broker} disconnected — reauthorize to refresh holdings.`,
      };
    }

    case "year_pace_review": {
      const ytdPct = data.ytdPct as number;
      const benchPct = data.spyYtdPct as number;
      return {
        title: `2026 year-pace review`,
        body: `Portfolio YTD: ${fmtSign(ytdPct)} vs SPY ${fmtSign(benchPct)}.`,
      };
    }
  }
}
