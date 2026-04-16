"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Loader2 } from "lucide-react";

/**
 * One-time acknowledgment for new users before they run their first AI analysis.
 * Persists acceptance to `user.disclaimerAcceptedAt`. Does not reappear after.
 *
 * Never styled as a deceptive / auto-accept pattern. User must click to proceed.
 */
export default function DisclaimerModal({
  open,
  onAccept,
}: {
  open: boolean;
  onAccept: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAccept() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/user/disclaimer", { method: "POST" });
      if (!res.ok) {
        setError("Could not save. Try again.");
        return;
      }
      onAccept();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <AlertTriangle className="h-5 w-5 text-[var(--hold)]" />
            Before you use ClearPath
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3 text-sm leading-relaxed">
            <p>
              ClearPath Invest is a research tool. It is{" "}
              <strong>not a financial advisor</strong> and does not provide
              investment advice.
            </p>
            <p>
              Analyses produced here are for{" "}
              <strong>informational purposes only</strong>. They are not a
              recommendation to buy, sell, or hold any security. AI models can
              and do make mistakes. Past performance (including ClearPath&rsquo;s
              own track record on previous recommendations) does not guarantee
              future results.
            </p>
            <p>
              You are solely responsible for your investment decisions.
              ClearPath, its creators, and its data providers are not liable for
              any losses resulting from actions you take based on information
              from this service. Consult a licensed financial advisor and
              your tax professional before making decisions with your money.
            </p>
            <p className="text-muted-foreground">
              By clicking &ldquo;I understand&rdquo;, you acknowledge these
              terms. You will not be asked again.
            </p>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            <a
              href="/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              Read full terms
            </a>
            <Button onClick={handleAccept} disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              I understand
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
