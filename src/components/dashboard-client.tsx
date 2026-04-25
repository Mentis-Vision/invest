"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/app-shell";
import DashboardView from "@/components/views/dashboard";
import PortfolioView from "@/components/views/portfolio";
import ResearchView from "@/components/views/research";
import StrategyView from "@/components/views/strategy";
import IntegrationsView from "@/components/views/integrations";
import { ReauthBanner } from "@/components/app/reauth-banner";

type View = "dashboard" | "portfolio" | "research" | "strategy" | "integrations";

// "strategy" is no longer in the nav (Phase 2) but kept in the type
// so StrategyView can be inlined under the Next Move hero in Phase 4.
const VALID: View[] = ["dashboard", "portfolio", "research", "integrations"];

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
  const rawView = (searchParams.get("view") as View) ?? "dashboard";
  // ?view=strategy is no longer a nav destination — alias to dashboard so
  // existing deep-links land on the briefing rather than a blank view.
  const initial: View = rawView === "strategy" ? "dashboard" : rawView;
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

  // ?ticker=AAPL arrives from alert-feed "Research →" deep links and the
  // drill-panel "Run full research" buttons. Forward it to ResearchView
  // so the analysis kicks off automatically on arrival instead of greeting
  // the user with a blank search box.
  const initialTicker = searchParams.get("ticker")?.trim().toUpperCase() ?? null;

  return (
    <AppShell user={user} currentView={currentView} onViewChange={setCurrentView}>
      {/* Reauth banner renders across all views — sits above the
          per-view content so a broken brokerage connection is always
          visible no matter where the user is in the app. */}
      <div className="mb-4">
        <ReauthBanner />
      </div>
      {currentView === "dashboard" && (
        <DashboardView
          userName={user.name}
          onNavigateToPortfolio={() => setCurrentView("portfolio")}
        />
      )}
      {currentView === "portfolio" && <PortfolioView />}
      {currentView === "research" && (
        <ResearchView
          initialTicker={initialTicker}
          onNavigateToPortfolio={() => setCurrentView("portfolio")}
        />
      )}
      {currentView === "strategy" && <StrategyView />}
      {currentView === "integrations" && <IntegrationsView />}
    </AppShell>
  );
}
