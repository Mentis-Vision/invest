"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function PortfolioView() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">My Portfolio</h2>
          <p className="text-sm text-muted-foreground">
            A detailed look at your current holdings.
          </p>
        </div>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Connect Brokerage
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Holdings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Plus className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-medium">No holdings yet</h3>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Connect your brokerage account to sync your portfolio automatically,
              or add holdings manually.
            </p>
            <Button variant="outline" size="sm" className="mt-4">
              Connect Brokerage
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
