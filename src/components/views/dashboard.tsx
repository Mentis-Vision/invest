"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, DollarSign, Activity } from "lucide-react";

const stats = [
  { label: "Portfolio Value", value: "$0.00", icon: DollarSign, change: null },
  { label: "Day Change", value: "$0.00", icon: Activity, change: null },
  { label: "Total Return", value: "$0.00", icon: TrendingUp, change: null },
];

const macroIndicators = [
  { indicator: "US GDP Growth", value: "2.3%", change: "+0.2%", trend: "up" as const },
  { indicator: "Inflation (CPI)", value: "3.1%", change: "-0.1%", trend: "down" as const },
  { indicator: "Unemployment", value: "3.8%", change: "0.0%", trend: "neutral" as const },
];

export default function DashboardView() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Overview</h2>
        <p className="text-sm text-muted-foreground">
          Here&apos;s what&apos;s happening with your money today.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label}>
              <CardContent className="flex items-center gap-4 p-5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Icon className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  <p className="text-2xl font-semibold tracking-tight">{stat.value}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI Action Items</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Connect your brokerage to get personalized trade/no-trade recommendations.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Macro Snapshot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {macroIndicators.map((m) => (
              <div key={m.indicator} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{m.indicator}</span>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{m.value}</span>
                  <Badge
                    variant={m.trend === "up" ? "default" : m.trend === "down" ? "destructive" : "secondary"}
                    className="text-xs"
                  >
                    {m.trend === "up" && <TrendingUp className="mr-1 h-3 w-3" />}
                    {m.trend === "down" && <TrendingDown className="mr-1 h-3 w-3" />}
                    {m.change}
                  </Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
