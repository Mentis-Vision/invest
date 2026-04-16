"use client";

import { useState } from "react";
import AppShell from "@/components/app-shell";
import DashboardView from "@/components/views/dashboard";
import PortfolioView from "@/components/views/portfolio";
import ResearchView from "@/components/views/research";
import StrategyView from "@/components/views/strategy";
import IntegrationsView from "@/components/views/integrations";

type View = "dashboard" | "portfolio" | "research" | "strategy" | "integrations";

export default function DashboardClient({
  user,
}: {
  user: { name: string; email: string };
}) {
  const [currentView, setCurrentView] = useState<View>("dashboard");

  return (
    <AppShell user={user} currentView={currentView} onViewChange={setCurrentView}>
      {currentView === "dashboard" && <DashboardView />}
      {currentView === "portfolio" && <PortfolioView />}
      {currentView === "research" && <ResearchView />}
      {currentView === "strategy" && <StrategyView />}
      {currentView === "integrations" && <IntegrationsView />}
    </AppShell>
  );
}
