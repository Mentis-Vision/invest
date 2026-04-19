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
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LayoutDashboard,
  PieChart,
  Search,
  Lightbulb,
  History as HistoryIcon,
  Menu,
  LogOut,
  Settings as SettingsIcon,
  KeyRound,
  HelpCircle,
  ChevronDown,
} from "lucide-react";
import TickerTape from "@/components/ticker-tape";

type View =
  | "dashboard"
  | "portfolio"
  | "research"
  | "strategy"
  | "integrations";

type NavItem = {
  id: View | "history";
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
  { id: "dashboard", label: "Dashboard", kind: "view", icon: LayoutDashboard },
  { id: "portfolio", label: "Portfolio", kind: "view", icon: PieChart },
  { id: "research", label: "Research", kind: "view", icon: Search },
  { id: "strategy", label: "Strategy", kind: "view", icon: Lightbulb },
  {
    id: "history",
    label: "History",
    kind: "link",
    icon: HistoryIcon,
    href: "/app/history",
  },
];

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
      return pathname === item.href || pathname.startsWith(item.href + "/");
    }
    return onDashboard && currentView === item.id;
  }

  /**
   * Account dropdown — unchanged shape from previous round: Settings,
   * Change password, Contact support, Sign out. Triggers from the
   * name-chip in the top-right.
   */
  function AccountMenu() {
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
            onClick={handleSignOut}
            variant="destructive"
            className="cursor-pointer"
          >
            <LogOut className="mr-2.5 h-3.5 w-3.5" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* ─── Ticker tape (very top) ─── */}
      <TickerTape />

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
              from 28→40 (h-10) on 2026-04-18 for stronger brand presence.
            */}
            <Image
              src="/logo.png"
              alt=""
              width={1024}
              height={1014}
              priority
              className="h-10 w-10 object-contain"
            />
            <span className="text-[16px] font-semibold tracking-[-0.015em]">
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
                    className="h-8 w-8 object-contain"
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
            <AccountMenu />
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
