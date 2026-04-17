"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/app-shell";
import DashboardView from "@/components/views/dashboard";
import PortfolioView from "@/components/views/portfolio";
import ResearchView from "@/components/views/research";
import StrategyView from "@/components/views/strategy";
import IntegrationsView from "@/components/views/integrations";

type View = "dashboard" | "portfolio" | "research" | "strategy" | "integrations";

const VALID: View[] = ["dashboard", "portfolio", "research", "strategy", "integrations"];

export default function DashboardClient({
  user,
}: {
  user: { name: string; email: string };
}) {
  return (
    <Suspense fallback={null}>
      <DashboardClientInner user={user} />
    </Suspense>
  );
}

function DashboardClientInner({
  user,
}: {
  user: { name: string; email: string };
}) {
  const searchParams = useSearchParams();
  const initial = (searchParams.get("view") as View) ?? "dashboard";
  const [currentView, setCurrentView] = useState<View>(
    VALID.includes(initial) ? initial : "dashboard"
  );

  // Keep URL in sync without history pollution
  useEffect(() => {
    const url = new URL(window.location.href);
    if (currentView === "dashboard") {
      url.searchParams.delete("view");
    } else {
      url.searchParams.set("view", currentView);
    }
    window.history.replaceState({}, "", url.toString());
  }, [currentView]);

  return (
    <AppShell user={user} currentView={currentView} onViewChange={setCurrentView}>
      {currentView === "dashboard" && <DashboardView userName={user.name} />}
      {currentView === "portfolio" && <PortfolioView />}
      {currentView === "research" && <ResearchView />}
      {currentView === "strategy" && <StrategyView />}
      {currentView === "integrations" && <IntegrationsView />}
    </AppShell>
  );
}
