// src/components/dashboard/goals-prompt-card.tsx
// Server component shown when the user hasn't set their goals yet.
// Used as a Decision Queue empty-state mirror, and as a header card on
// the dashboard for users who haven't completed onboarding. Pairs with
// the goals_setup queue item — clicking through opens /app/settings/goals.

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Target } from "lucide-react";

export default function GoalsPromptCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-4 w-4" /> Set your goals
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Tell ClearPath your target wealth, target date, monthly contribution,
          and risk tolerance. We use those to compute a target allocation
          glidepath and tell you when you&apos;re on (or off) pace.
        </p>
        <Button asChild>
          <Link href="/app/settings/goals">Set goals</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
