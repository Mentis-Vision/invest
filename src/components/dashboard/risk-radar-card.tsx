"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Info,
  Radar,
  ShieldAlert,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { RadarAlert } from "@/lib/decision-engine/radar";

function severityTone(severity: RadarAlert["severity"]): string {
  if (severity === "action") {
    return "border-[var(--sell)]/30 bg-[var(--sell)]/10 text-[var(--sell)]";
  }
  if (severity === "warn") {
    return "border-[var(--hold)]/30 bg-[var(--hold)]/10 text-[var(--hold)]";
  }
  return "border-border bg-muted text-muted-foreground";
}

function IconFor({ severity }: { severity: RadarAlert["severity"] }) {
  if (severity === "action") {
    return <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--sell)]" />;
  }
  if (severity === "warn") {
    return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--hold)]" />;
  }
  return <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />;
}

export function RiskRadarCard() {
  const [alerts, setAlerts] = useState<RadarAlert[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/radar?limit=8")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { alerts?: RadarAlert[] } | null) => {
        if (!alive) return;
        setAlerts(data?.alerts ?? []);
      })
      .catch(() => {
        if (alive) setAlerts([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (alerts === null) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Radar className="h-4 w-4" />
            Risk Radar
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-20 animate-pulse rounded-md bg-muted/40" />
        </CardContent>
      </Card>
    );
  }

  if (alerts.length === 0) return null;

  return (
    <Card className="border-[var(--hold)]/25 bg-[var(--hold)]/[0.03]">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Radar className="h-4 w-4" />
              Risk Radar
            </CardTitle>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
              Risk Radar found holdings that may deserve review based on
              changing market, trend, valuation, or portfolio conditions. This
              is decision support only, not investment advice.
            </p>
          </div>
          <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
            {alerts.length} review{alerts.length === 1 ? "" : "s"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {alerts.slice(0, 5).map((alert, idx) => (
          <div
            key={`${alert.ticker}-${alert.kind}-${idx}`}
            className="rounded-md border border-border/70 bg-background/70 p-3"
          >
            <div className="flex items-start gap-3">
              <IconFor severity={alert.severity} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-semibold">
                    {alert.ticker}
                  </span>
                  <Badge
                    variant="outline"
                    className={`${severityTone(alert.severity)} text-[10px] uppercase tracking-wider`}
                  >
                    {alert.severity}
                  </Badge>
                  <span className="text-sm font-medium">{alert.title}</span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {alert.body}
                </p>
                {alert.dataPoints.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {alert.dataPoints.slice(0, 4).map((point) => (
                      <span
                        key={point}
                        className="inline-flex items-center gap-1 rounded-sm border border-border/70 bg-muted/30 px-2 py-1 font-mono text-[10px] text-muted-foreground"
                      >
                        <Activity className="h-3 w-3" />
                        {point}
                      </span>
                    ))}
                  </div>
                )}
                <p className="mt-2 text-xs text-foreground/85">
                  {alert.recommendedReview}
                </p>
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
