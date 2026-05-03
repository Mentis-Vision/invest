"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { authClient } from "@/lib/auth-client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import ThemeToggle from "@/components/theme-toggle";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LayoutDashboard,
  PieChart,
  Search,
  History as HistoryIcon,
  TrendingUp,
  Menu,
  LogOut,
  Settings as SettingsIcon,
  KeyRound,
  HelpCircle,
  ChevronDown,
  CreditCard,
} from "lucide-react";
import TickerTape from "@/components/ticker-tape";
import TrialBanner from "@/components/trial-banner";

type View =
  | "dashboard"
  | "portfolio"
  | "research"
  | "strategy"
  | "integrations";

type NavItem = {
  id: View | "history" | "year-outlook";
  label: string;
  kind: "view" | "link";
  icon: typeof LayoutDashboard;
  href?: string;
};

/**
 * Primary workspace navigation. No "Account" here anymore — Account
 * lives in the name-dropdown. Sidebar was removed entirely in the
 * hybrid-v2 redesign; these now ride as horizontal tabs in the top bar.
 */
const navItems: NavItem[] = [
  // Dashboard is a real link to /app rather than a `kind: "view"`
  // entry — the /app overview now hosts the actionable Headline +
  // Queue layer above the legacy DashboardView (2026-05-02), so
  // there's a meaningful difference between "/app" (composed
  // overview) and "/app?view=dashboard" (legacy DashboardView only,
  // routed through DashboardClient). Linking to /app keeps the
  // composed page reachable from the top nav.
  {
    id: "dashboard",
    label: "Dashboard",
    kind: "link",
    icon: LayoutDashboard,
    href: "/app",
  },
  { id: "portfolio", label: "Portfolio", kind: "view", icon: PieChart },
  { id: "research", label: "Research", kind: "view", icon: Search },
  {
    id: "year-outlook",
    label: "Year Outlook",
    kind: "link",
    icon: TrendingUp,
    href: "/app/year-outlook",
  },
  {
    id: "history",
    label: "Journal",
    kind: "link",
    icon: HistoryIcon,
    href: "/app/history",
  },
];

/**
 * Account dropdown — extracted as a module-level component so its
 * identity is stable across AppShell re-renders.
 *
 * ROOT CAUSE OF THE "PAGE COULDN'T LOAD" REGRESSION:
 * When AccountMenu was defined as an inner function inside AppShell,
 * every AppShell re-render (triggered by child state changes — e.g.
 * the Dashboard fetching portfolio-review, latest-strategy-action,
 * track-record, holdings) created a NEW AccountMenu function reference.
 * React treats a changed component-type as a full subtree remount, so
 * it unmounted the old DropdownMenu (from @base-ui/react/menu) and
 * mounted a fresh one. Base UI's portal-based Menu throws error #31
 * when the trigger element is unmounted mid-reconciliation — exactly
 * the "page couldn't load" symptom seen when clicking the name chip.
 *
 * Extracting AccountMenu to module scope gives it a constant identity.
 * AppShell re-renders now propagate to AccountMenu as a prop update
 * (stable component type, new prop values) instead of an unmount/remount.
 */
function AccountMenu({
  initials,
  firstName,
  onSignOut,
}: {
  initials: string;
  firstName: string;
  onSignOut: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className="inline-flex items-center gap-2 rounded-full border border-border bg-card pl-1 pr-3 py-1 transition-colors hover:border-muted-foreground/40"
      >
        <Avatar className="h-7 w-7 border border-border/60">
          <AvatarFallback className="bg-foreground text-[11px] font-semibold text-background">
            {initials}
          </AvatarFallback>
        </Avatar>
        <span className="hidden text-[13px] text-foreground/80 sm:inline">
          {firstName}
        </span>
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" sideOffset={8}>
        {/*
          Base UI requires Menu.GroupLabel (our DropdownMenuLabel) to be
          a descendant of a Menu.Group (DropdownMenuGroup). Without the
          wrapper, MenuGroupLabel's useMenuGroupRootContext() throws
          Base UI error #31 — "MenuGroupRootContext is missing. Menu
          group parts must be used within <Menu.Group>." — on every menu
          open, which surfaces in production as the error-boundary
          "page couldn't load" screen. The wrapper is cheap + semantic
          (these four items really are one "Account" group).
        */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 pt-2 pb-1 text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground">
            Account
          </DropdownMenuLabel>
          {/*
            Intentional full-page nav via `window.location.href` instead
            of `router.push`. The prior `router.push("/app/settings")`
            raced with Base UI's menu-close focus return and with
            BetterAuth's 5-minute `cookieCache` refresh — on a stale
            cache, the RSC prefetch for /app/settings could resolve to
            a /sign-in redirect, which the navigation then followed,
            effectively logging the user out. Full reload sends fresh
            cookies and bypasses the prefetch cache. Matches the
            Sign Out pattern already in use below.
          */}
          <DropdownMenuItem
            onClick={() => {
              window.location.href = "/app/settings";
            }}
            className="cursor-pointer"
          >
            <SettingsIcon className="mr-2.5 h-3.5 w-3.5" />
            Settings &amp; preferences
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              window.location.href = "/app/upgrade";
            }}
            className="cursor-pointer"
          >
            <CreditCard className="mr-2.5 h-3.5 w-3.5" />
            Billing &amp; upgrade
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              window.location.href = "/forgot-password";
            }}
            className="cursor-pointer"
          >
            <KeyRound className="mr-2.5 h-3.5 w-3.5" />
            Change password
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              window.location.href = "mailto:support@clearpathinvest.app";
            }}
            className="cursor-pointer"
          >
            <HelpCircle className="mr-2.5 h-3.5 w-3.5" />
            Contact support
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={onSignOut}
            variant="destructive"
            className="cursor-pointer"
          >
            <LogOut className="mr-2.5 h-3.5 w-3.5" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function AppShell({
  user,
  children,
  currentView,
  onViewChange,
}: {
  user: { name: string; email: string };
  children: React.ReactNode;
  currentView?: View;
  onViewChange?: (view: View) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const onDashboard = pathname === "/app" || pathname === "/app/";

  const initials = (user.name || user.email || "U")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const firstName = (user.name || user.email.split("@")[0]).split(" ")[0];

  async function handleSignOut() {
    await authClient.signOut();
    window.location.href = "/sign-in";
  }

  function handleNavClick(item: NavItem) {
    setMobileOpen(false);
    if (item.kind === "link" && item.href) {
      router.push(item.href);
      return;
    }
    if (item.kind === "view") {
      if (onDashboard && onViewChange) {
        onViewChange(item.id as View);
      } else {
        router.push(`/app?view=${item.id}`);
      }
    }
  }

  function isActive(item: NavItem) {
    if (item.kind === "link" && item.href) {
      // /app is the dashboard overview itself — match exactly so the
      // Dashboard tab doesn't light up while the user is on
      // /app/history, /app/year-outlook, etc. Other links
      // (/app/history, /app/year-outlook) keep the prefix match so
      // sub-routes (e.g. /app/r/[id]) under those sections still
      // highlight correctly.
      if (item.href === "/app") {
        return pathname === "/app" || pathname === "/app/";
      }
      return pathname === item.href || pathname.startsWith(item.href + "/");
    }
    return onDashboard && currentView === item.id;
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* ─── Ticker tape (very top) ─── */}
      <TickerTape />

      {/* ─── Trial countdown / past-due banner (slots above the
          top nav, below the ticker). Self-fetches via
          /api/user/subscription on mount; renders nothing for
          users not in any nudge state, so it's safe to mount
          unconditionally. */}
      <TrialBanner />

      {/* ─── Top nav ─── */}
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto grid max-w-[1760px] grid-cols-[auto_1fr_auto] items-center gap-5 px-6 py-3 md:px-7">
          <Link
            href="/app"
            className="flex items-center gap-2.5 text-foreground"
          >
            {/*
              Logomark — founder-provided 1024×1014 PNG at /public/logo.png.
              next/image downscales and emits responsive srcset. Sized up
              from 28→40→48 (h-12) on 2026-04-20 for stronger brand
              presence per founder feedback.
            */}
            <Image
              src="/logo.png"
              alt=""
              width={1024}
              height={1014}
              priority
              className="h-12 w-12 object-contain"
            />
            <span className="text-[18px] font-semibold tracking-[-0.015em]">
              ClearPath
            </span>
          </Link>

          {/* Desktop tabs */}
          <nav className="hidden justify-center md:flex">
            <div className="flex gap-0.5">
              {navItems.map((item) => {
                const active = isActive(item);
                return (
                  <button
                    key={item.id}
                    onClick={() => handleNavClick(item)}
                    className={`rounded-md px-4 py-2 text-[13px] font-medium transition-colors ${
                      active
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </nav>

          {/* Mobile menu trigger */}
          <nav className="flex items-center justify-center md:hidden">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger
                aria-label="Open navigation menu"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-secondary/60"
              >
                <Menu className="h-4 w-4" />
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-0 bg-card">
                <div className="flex h-14 items-center gap-2.5 border-b border-border px-5">
                  <Image
                    src="/logo.png"
                    alt=""
                    width={1024}
                    height={1014}
                    className="h-10 w-10 object-contain"
                  />
                  <span className="text-[15px] font-semibold tracking-tight">
                    ClearPath
                  </span>
                </div>
                <div className="px-3 py-4">
                  <div className="mb-2 px-3 text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground/70">
                    Workspace
                  </div>
                  <div className="space-y-0.5">
                    {navItems.map((item) => {
                      const Icon = item.icon;
                      const active = isActive(item);
                      return (
                        <button
                          key={item.id}
                          onClick={() => handleNavClick(item)}
                          className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-[13px] transition-colors ${
                            active
                              ? "bg-secondary font-medium text-foreground"
                              : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                          }`}
                        >
                          <Icon
                            className={`h-[15px] w-[15px] ${
                              active
                                ? "text-primary"
                                : "text-muted-foreground/70"
                            }`}
                          />
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </nav>

          {/* Right: theme toggle + account */}
          <div className="flex items-center justify-end gap-2">
            <div className="hidden md:block">
              <ThemeToggle />
            </div>
            <AccountMenu
              initials={initials}
              firstName={firstName}
              onSignOut={handleSignOut}
            />
          </div>
        </div>
      </header>

      {/* ─── Main content ─── */}
      <main className="flex-1">
        <div className="mx-auto max-w-[1760px] px-5 py-6 md:px-7 md:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
