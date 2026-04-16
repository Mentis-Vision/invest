"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";

const dataSources = [
  { name: "SEC EDGAR", category: "Public", status: "active", description: "Corporate filings (10-K, 10-Q, 8-K)." },
  { name: "FRED", category: "Public", status: "active", description: "Macro data: rates, inflation, employment." },
  { name: "Yahoo Finance", category: "Public", status: "active", description: "Delayed quotes and historical prices." },
  { name: "Plaid / SnapTrade", category: "Brokerage", status: "available", description: "Read-only brokerage account sync." },
  { name: "Morningstar", category: "Premium", status: "available", description: "Fund/ETF fundamentals and ratings." },
];

export default function IntegrationsView() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Data & APIs</h2>
        <p className="text-sm text-muted-foreground">
          Manage connections to brokerages, public databases, and premium APIs.
        </p>
      </div>

      <div className="grid gap-3">
        {dataSources.map((source) => (
          <Card key={source.name}>
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{source.name}</span>
                  <Badge variant="outline" className="text-xs">
                    {source.category}
                  </Badge>
                  <Badge
                    variant={source.status === "active" ? "default" : "secondary"}
                    className="text-xs"
                  >
                    {source.status}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {source.description}
                </p>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <ExternalLink className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
