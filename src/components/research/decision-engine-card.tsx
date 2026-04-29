import {
  AlertTriangle,
  BarChart3,
  Gauge,
  Info,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  DecisionAction,
  DecisionEngineOutput,
  RiskLevel,
} from "@/lib/decision-engine/types";

const ACTION_LABEL: Record<DecisionAction, string> = {
  HIGH_CONVICTION_CANDIDATE: "High-Conviction Candidate",
  BUY_CANDIDATE: "Buy Candidate",
  HOLD_WATCH: "Hold / Watch",
  REDUCE_REVIEW: "Reduce / Review",
  AVOID: "Avoid",
  INSUFFICIENT_DATA: "Insufficient Data",
};

function riskTone(riskLevel: RiskLevel): string {
  if (riskLevel === "EXTREME" || riskLevel === "HIGH") {
    return "border-[var(--sell)]/30 bg-[var(--sell)]/10 text-[var(--sell)]";
  }
  if (riskLevel === "MEDIUM") {
    return "border-[var(--hold)]/30 bg-[var(--hold)]/10 text-[var(--hold)]";
  }
  return "border-[var(--buy)]/30 bg-[var(--buy)]/10 text-[var(--buy)]";
}

function actionTone(action: DecisionAction): string {
  if (action === "HIGH_CONVICTION_CANDIDATE" || action === "BUY_CANDIDATE") {
    return "border-[var(--buy)]/30 bg-[var(--buy)]/10 text-[var(--buy)]";
  }
  if (action === "HOLD_WATCH") {
    return "border-[var(--hold)]/30 bg-[var(--hold)]/10 text-[var(--hold)]";
  }
  if (action === "REDUCE_REVIEW" || action === "AVOID") {
    return "border-[var(--sell)]/30 bg-[var(--sell)]/10 text-[var(--sell)]";
  }
  return "border-border bg-muted text-muted-foreground";
}

function aiRank(value: string | null | undefined): number {
  if (value === "BUY") return 3;
  if (value === "HOLD") return 2;
  if (value === "SELL") return 1;
  return 0;
}

function engineRank(action: DecisionAction): number {
  if (action === "HIGH_CONVICTION_CANDIDATE" || action === "BUY_CANDIDATE") {
    return 3;
  }
  if (action === "HOLD_WATCH") return 2;
  if (action === "REDUCE_REVIEW" || action === "AVOID") return 1;
  return 0;
}

function fmtMoney(value: number | null): string {
  if (value == null) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function DecisionEngineCard({
  decisionEngine,
  aiRecommendation,
  showMissingFallback = false,
}: {
  decisionEngine?: DecisionEngineOutput | null;
  aiRecommendation?: string | null;
  showMissingFallback?: boolean;
}) {
  if (!decisionEngine) {
    if (!showMissingFallback) return null;
    return (
      <Card className="border-border/70 bg-muted/20">
        <CardContent className="flex items-start gap-3 py-4 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Risk overlay was not available for this older analysis.</span>
        </CardContent>
      </Card>
    );
  }

  const triggeredGates = decisionEngine.riskGates.filter(
    (gate) => gate.triggered
  );
  const moreConservative =
    aiRank(aiRecommendation) > engineRank(decisionEngine.action);

  return (
    <Card className="border-[var(--hold)]/25 bg-[var(--hold)]/[0.03]">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4" />
              Trade Quality Score and Risk Overlay
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Deterministic risk overlay for decision support.
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Badge className={`${actionTone(decisionEngine.action)} border`}>
              {ACTION_LABEL[decisionEngine.action]}
            </Badge>
            <Badge className={`${riskTone(decisionEngine.riskLevel)} border`}>
              {decisionEngine.riskLevel} risk
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {moreConservative && (
          <div className="flex items-start gap-2 rounded-md border border-[var(--hold)]/30 bg-[var(--hold)]/10 p-3 text-xs">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--hold)]" />
            <span>
              The deterministic risk overlay is more conservative than the AI
              research verdict.
            </span>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            icon={<Gauge className="h-4 w-4" />}
            label="Trade Quality Score"
            value={`${decisionEngine.tradeQualityScore}/100`}
          />
          <Metric
            icon={<BarChart3 className="h-4 w-4" />}
            label="Confidence"
            value={decisionEngine.confidence}
          />
          <Metric
            label="Market Regime"
            value={decisionEngine.marketRegime.replace(/_/g, " ")}
          />
          <Metric
            label="Suggested max allocation"
            value={`${decisionEngine.positionSizing.suggestedMaxPositionPct}%`}
          />
          <Metric
            label="Max risk per trade"
            value={`${decisionEngine.positionSizing.maxRiskPerTradePct}%`}
          />
          <Metric
            label="Reward/risk"
            value={
              decisionEngine.positionSizing.rewardRiskRatio == null
                ? "Unknown"
                : `${decisionEngine.positionSizing.rewardRiskRatio.toFixed(2)}:1`
            }
          />
          <Metric
            label="Review level"
            value={fmtMoney(decisionEngine.positionSizing.suggestedReviewPrice)}
          />
          <Metric
            label="Stop reference"
            value={fmtMoney(decisionEngine.positionSizing.suggestedStopPrice)}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <ListBlock title="Top reasons" items={decisionEngine.reasons.slice(0, 3)} />
          <ListBlock title="Top risks" items={decisionEngine.risks.slice(0, 3)} />
        </div>

        {triggeredGates.length > 0 && (
          <div>
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Triggered risk gates
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {triggeredGates.map((gate) => (
                <div
                  key={gate.id}
                  className="rounded-md border border-border/70 bg-background/70 p-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{gate.title}</span>
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {gate.severity}
                    </Badge>
                  </div>
                  <p className="mt-1 leading-relaxed text-muted-foreground">
                    {gate.rationale}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <ListBlock
            title="Missing data"
            items={decisionEngine.missingData.slice(0, 5)}
            empty="No major missing inputs flagged."
          />
          <ListBlock
            title="What would change this view"
            items={decisionEngine.whatWouldChangeThisView.slice(0, 5)}
          />
        </div>

        <div className="rounded-md border border-border/70 bg-background/70 p-3 text-xs leading-relaxed text-muted-foreground">
          Decision support only. This is informational, not investment advice
          or an instruction to trade.
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({
  icon,
  label,
  value,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-border/70 bg-background/70 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}

function ListBlock({
  title,
  items,
  empty = "No items to show.",
}: {
  title: string;
  items: string[];
  empty?: string;
}) {
  return (
    <div>
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {title}
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {items.map((item) => (
            <li key={item} className="flex gap-2 text-muted-foreground">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-foreground/50" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
