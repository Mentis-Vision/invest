// src/components/dashboard/legacy-dashboard-section.tsx
"use client";

// Thin client wrapper around the legacy hybrid-v2 DashboardView so we
// can render it inside the server-rendered /app overview composition
// without re-introducing AppShell (DashboardClient brings AppShell
// with it; embedding it would stack two top nav bars).
//
// The DashboardView body needs `onNavigateToPortfolio`. In the
// DashboardClient world that flips an internal `currentView` state;
// here we instead push to `/app?view=portfolio` so the top nav lights
// up Portfolio and the inner Suspense client picks up the param.

import { useRouter } from "next/navigation";
import DashboardView from "@/components/views/dashboard";

export function LegacyDashboardSection({ userName }: { userName: string }) {
  const router = useRouter();
  return (
    <DashboardView
      userName={userName}
      onNavigateToPortfolio={() => router.push("/app?view=portfolio")}
    />
  );
}
