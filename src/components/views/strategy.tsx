"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Lightbulb, Loader2 } from "lucide-react";

export default function StrategyView() {
  const [loading, setLoading] = useState(false);
  const [advice, setAdvice] = useState<string | null>(null);

  async function handleGetAdvice() {
    setLoading(true);
    try {
      const res = await fetch("/api/strategy", { method: "POST" });
      const data = await res.json();
      setAdvice(data.advice ?? "No advice available.");
    } catch {
      setAdvice("Failed to get advice. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">AI Strategy</h2>
        <p className="text-sm text-muted-foreground">
          Get personalized, easy-to-understand advice.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Portfolio Review</CardTitle>
            <Badge variant="secondary">AI-Powered</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!advice ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Lightbulb className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="text-sm font-medium">Ready for your review</h3>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                AI will analyze your portfolio and tell you what to buy, sell, or
                hold — in plain English.
              </p>
              <Button className="mt-4" onClick={handleGetAdvice} disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Get AI Advice
              </Button>
            </div>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
              {advice}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
