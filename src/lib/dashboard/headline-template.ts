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

function fmtSign(s: string | number | null | undefined): string {
  if (s === undefined || s === null) return "flat";
  if (typeof s === "number") {
    if (!Number.isFinite(s)) return "flat";
    return s >= 0 ? `+${fmtPct(s)}` : fmtPct(s);
  }
  return String(s);
}

function asNumber(v: string | number | null | undefined): number {
  return typeof v === "number" ? v : Number.NaN;
}

function asString(v: string | number | null | undefined, fallback: string): string {
  if (v === undefined || v === null) return fallback;
  return String(v);
}

export function renderTemplate(ctx: TemplateContext): TemplateOutput {
  const { itemType, ticker, data } = ctx;
  const t = ticker ?? "";

  switch (itemType) {
    case "concentration_breach_severe":
    case "concentration_breach_moderate": {
      const delta = asNumber(data.deltaPp);
      const cur = asNumber(data.currentPct);
      const min = asNumber(data.minCapPct);
      const max = asNumber(data.maxCapPct);
      const evtRaw = data.nextEvent;
      const evt = typeof evtRaw === "string" ? evtRaw : undefined;
      const tail = evt ? ` before ${evt}` : "";
      return {
        title: `${t} concentration ${fmtPct(cur)} — above your cap`,
        body: `Trim ${t} by ~${delta}pp${tail}. Concentration is ${fmtPct(cur)}, your cap is ${min}–${max}%.`,
      };
    }

    case "stale_rec_held":
    case "stale_rec_watched": {
      const days = asNumber(data.daysAgo);
      const move = asString(data.moveSinceRec, "flat");
      const verdict = asString(data.originalVerdict, "HOLD");
      const price = asNumber(data.priceAtRec);
      return {
        title: `${t} thesis is ${days}d old`,
        body: `Re-research ${t} — last analyzed ${days}d ago, price ${move} since ${verdict} at ${fmtMoney(price)}.`,
      };
    }

    case "catalyst_prep_imminent":
    case "catalyst_prep_upcoming": {
      const eventName = asString(data.eventName, "earnings");
      const eventDate = asString(data.eventDate, "soon");
      const dte = asNumber(data.daysToEvent);
      const prior =
        data.priorReaction !== undefined && data.priorReaction !== null
          ? `Last earnings reaction: ${String(data.priorReaction)}.`
          : "";
      const pos = asNumber(data.currentPct);
      const posStr = Number.isFinite(pos)
        ? ` Position is ${fmtPct(pos)} of portfolio.`
        : "";
      return {
        title: `${t} reports ${eventName} on ${eventDate}`,
        body: `${t} reports ${eventName} on ${eventDate} (${dte}d). ${prior}${posStr}`.trim(),
      };
    }

    case "outcome_action_mark": {
      const origDate = asString(data.originalDate, "earlier");
      const origVerdict = asString(data.originalVerdict, "HOLD");
      const move = fmtSign(data.outcomeMove);
      const ov = asString(data.outcomeVerdict, "scored");
      return {
        title: `${t} outcome — ${ov}`,
        body: `Did you act on the ${origDate} ${origVerdict} on ${t}? Outcome scored ${move} (${ov}).`,
      };
    }

    case "cash_idle": {
      const cash = asNumber(data.cashAmount);
      const idle = asNumber(data.daysIdle);
      const cands = asNumber(data.numCandidates);
      return {
        title: `${fmtMoney(cash)} idle for ${idle}d`,
        body: `${fmtMoney(cash)} idle for ${idle}d. ${cands} BUY-rated candidates fit your sector budget.`,
      };
    }

    case "broker_reauth": {
      const broker = asString(data.brokerName, "Your broker");
      return {
        title: `${broker} disconnected`,
        body: `${broker} disconnected — reauthorize to refresh holdings.`,
      };
    }

    case "year_pace_review": {
      const ytdPct = data.ytdPct;
      const benchPct = data.spyYtdPct;
      return {
        title: `2026 year-pace review`,
        body: `Portfolio YTD: ${fmtSign(ytdPct)} vs SPY ${fmtSign(benchPct)}.`,
      };
    }
  }
}
