"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import ThemeToggle from "@/components/theme-toggle";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LayoutDashboard,
  PieChart,
  Search,
  Lightbulb,
  Plug,
  Menu,
  LogOut,
  TrendingUp,
  History as HistoryIcon,
  Settings as SettingsIcon,
} from "lucide-react";

type View =
  | "dashboard"
  | "portfolio"
  | "research"
  | "strategy"
  | "integrations";

type DashboardNav = {
  kind: "view";
  id: View;
  label: string;
  icon: typeof LayoutDashboard;
};
type LinkNav = {
  kind: "link";
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
};

const dashboardNavItems: DashboardNav[] = [
  { kind: "view", id: "dashboard", label: "Overview", icon: LayoutDashboard },
  { kind: "view", id: "portfolio", label: "My Portfolio", icon: PieChart },
  { kind: "view", id: "research", label: "Research", icon: Search },
  { kind: "view", id: "strategy", label: "AI Strategy", icon: Lightbulb },
  { kind: "view", id: "integrations", label: "Data & APIs", icon: Plug },
];

const linkNavItems: LinkNav[] = [
  { kind: "link", href: "/app/history", label: "History", icon: HistoryIcon },
  { kind: "link", href: "/app/settings", label: "Settings", icon: SettingsIcon },
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

  async function handleSignOut() {
    await authClient.signOut();
    // Full page reload — ensures the Set-Cookie: <cleared> response actually
    // lands BEFORE any SSR-authed route tries to re-read the cookie. This is
    // the same pattern as sign-in/page.tsx where router.push() races the
    // cookie commit and can flash authed state.
    window.location.href = "/sign-in";
  }

  function handleViewNav(view: View) {
    if (onDashboard && onViewChange) {
      onViewChange(view);
    } else {
      // Navigate back to dashboard with the view in a query param.
      router.push(`/app?view=${view}`);
    }
    setMobileOpen(false);
  }

  function NavLinks() {
    return (
      <div className="space-y-1">
        {dashboardNavItems.map((item) => {
          const Icon = item.icon;
          const active = onDashboard && currentView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => handleViewNav(item.id)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </button>
          );
        })}
        {linkNavItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden w-56 flex-col border-r bg-card md:flex">
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <Link href="/app" className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            <span className="font-semibold">ClearPath</span>
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto p-3">
          <NavLinks />
        </nav>
        <div className="px-3 pb-2">
          <ThemeToggle />
        </div>
        <Separator />
        <div className="space-y-1 p-3">
          {/* User chip — tap opens the dropdown for more account actions. */}
          <DropdownMenu>
            <DropdownMenuTrigger aria-label="Account menu">
              <button
                aria-label="Account menu"
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-accent/50"
              >
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                </Avatar>
                <div className="flex-1 text-left">
                  <p className="truncate font-medium leading-none">{user.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuItem onClick={handleSignOut}>
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {/* Explicit sign-out — always visible. The dropdown above was too
              hidden; users reported 'there's no logout' because they didn't
              know to click the avatar. Keep both paths so discoverability
              doesn't depend on avatar-hover intuition. */}
          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center gap-3 border-b px-4 md:hidden">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger aria-label="Open navigation menu">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label="Open navigation menu"
              >
                <Menu className="h-4 w-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-56 p-3">
              <div className="mb-4 flex items-center gap-2 px-3 pt-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                <span className="font-semibold">ClearPath</span>
              </div>
              <NavLinks />
              <Separator className="my-3" />
              <ThemeToggle />
              <button
                onClick={handleSignOut}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </SheetContent>
          </Sheet>
          <Link href="/app" className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            <span className="font-semibold">ClearPath</span>
          </Link>
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
