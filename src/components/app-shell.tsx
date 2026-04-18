"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import ThemeToggle from "@/components/theme-toggle";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
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
  Plug,
  Menu,
  LogOut,
  TrendingUp,
  History as HistoryIcon,
  Settings as SettingsIcon,
  KeyRound,
  HelpCircle,
  ChevronDown,
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
  { kind: "view", id: "strategy", label: "Strategy", icon: Lightbulb },
  { kind: "view", id: "integrations", label: "Account", icon: Plug },
];

/**
 * Settings used to live here. Moved to the name-dropdown at the
 * bottom of the sidebar so the nav stays focused on WORK surfaces,
 * not account admin.
 */
const linkNavItems: LinkNav[] = [
  { kind: "link", href: "/app/history", label: "History", icon: HistoryIcon },
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
    // lands BEFORE any SSR-authed route tries to re-read the cookie. Same
    // pattern as sign-in where router.push() races the cookie commit.
    window.location.href = "/sign-in";
  }

  function handleViewNav(view: View) {
    if (onDashboard && onViewChange) {
      onViewChange(view);
    } else {
      router.push(`/app?view=${view}`);
    }
    setMobileOpen(false);
  }

  function NavLinks() {
    return (
      <div className="space-y-0.5">
        {dashboardNavItems.map((item) => {
          const Icon = item.icon;
          const active = onDashboard && currentView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => handleViewNav(item.id)}
              className={`group relative flex w-full items-center gap-3 rounded-md px-3 py-2 text-[13px] transition-all ${
                active
                  ? "bg-secondary text-foreground font-medium"
                  : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
              }`}
            >
              {/* Left accent rail — amber bar on the active item. A
                  quieter alternative to the filled-pill active state
                  common in SaaS nav. */}
              {active && (
                <span
                  aria-hidden
                  className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-full bg-primary"
                />
              )}
              <Icon
                className={`h-[15px] w-[15px] ${
                  active ? "text-primary" : "text-muted-foreground/70"
                }`}
              />
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
              className={`group relative flex w-full items-center gap-3 rounded-md px-3 py-2 text-[13px] transition-all ${
                active
                  ? "bg-secondary text-foreground font-medium"
                  : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
              }`}
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-full bg-primary"
                />
              )}
              <Icon
                className={`h-[15px] w-[15px] ${
                  active ? "text-primary" : "text-muted-foreground/70"
                }`}
              />
              {item.label}
            </Link>
          );
        })}
      </div>
    );
  }

  /**
   * Unified account dropdown — Settings + password + help + sign out
   * all live here now. Previously Settings was a sidebar link (removed
   * per redesign) and sign-out existed in two places (dropdown +
   * standalone button). Consolidating both reduces visual clutter in
   * the sidebar and makes account actions a consistent click-the-name
   * interaction.
   *
   * Base UI Menu doesn't support `asChild` on Trigger/Item the way
   * Radix does — we navigate via router.push onClick instead of
   * wrapping each item in a Link.
   */
  function AccountMenu({ align }: { align: "start" | "end" }) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Account menu"
          className="flex w-full items-center gap-3 rounded-md border border-transparent px-2 py-1.5 text-left transition-all hover:border-border hover:bg-secondary/50"
        >
          <Avatar className="h-8 w-8 border border-border/60">
            <AvatarFallback className="bg-secondary text-[11px] font-medium text-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium leading-none">
              {user.name}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {user.email}
            </p>
          </div>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align} className="w-56" sideOffset={8}>
          <DropdownMenuLabel className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground">
            Account
          </DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() => router.push("/app/settings")}
            className="cursor-pointer"
          >
            <SettingsIcon className="mr-2.5 h-3.5 w-3.5" />
            Settings &amp; preferences
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => router.push("/forgot-password")}
            className="cursor-pointer"
          >
            <KeyRound className="mr-2.5 h-3.5 w-3.5" />
            Change password
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground">
            Help
          </DropdownMenuLabel>
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
    <div className="relative flex h-screen overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-5">
          <Link
            href="/app"
            className="group flex items-center gap-2.5 text-foreground"
          >
            <span
              aria-hidden
              className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/15 transition-colors group-hover:bg-primary/25"
            >
              <TrendingUp className="h-3.5 w-3.5 text-primary" />
            </span>
            <span className="text-[15px] font-semibold tracking-tight">
              ClearPath
            </span>
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <div className="mb-2 px-3 text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground/70">
            Workspace
          </div>
          <NavLinks />
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground/70">
              Theme
            </span>
            <ThemeToggle />
          </div>
          <Separator className="my-2 opacity-60" />
          <AccountMenu align="start" />
        </div>
      </aside>

      {/* Mobile header */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center justify-between gap-3 border-b border-border px-4 md:hidden">
          <div className="flex items-center gap-3">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger
                aria-label="Open navigation menu"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-secondary/60"
              >
                <Menu className="h-4 w-4" />
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-0 bg-sidebar">
                <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-5">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/15">
                    <TrendingUp className="h-3.5 w-3.5 text-primary" />
                  </span>
                  <span className="text-[15px] font-semibold tracking-tight">
                    ClearPath
                  </span>
                </div>
                <div className="px-3 py-4">
                  <div className="mb-2 px-3 text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground/70">
                    Workspace
                  </div>
                  <NavLinks />
                </div>
                <div className="border-t border-sidebar-border p-3">
                  <div className="mb-2 flex items-center justify-between px-1">
                    <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground/70">
                      Theme
                    </span>
                    <ThemeToggle />
                  </div>
                  <Separator className="my-2 opacity-60" />
                  <AccountMenu align="start" />
                </div>
              </SheetContent>
            </Sheet>
            <Link href="/app" className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/15">
                <TrendingUp className="h-3.5 w-3.5 text-primary" />
              </span>
              <span className="text-[15px] font-semibold tracking-tight">
                ClearPath
              </span>
            </Link>
          </div>
        </header>

        {/* Main content */}
        <main className="relative flex-1 overflow-y-auto p-4 md:p-8">
          <div className="relative z-10 mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
