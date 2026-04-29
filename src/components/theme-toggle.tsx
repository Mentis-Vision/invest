"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun, Laptop } from "lucide-react";

/**
 * Sidebar theme toggle.
 * Three-way cycle: system → light → dark → system.
 * Hydration-safe: renders a neutral placeholder until mounted, so server
 * and client markup match even when system theme differs from default.
 */
export default function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const { theme, resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(timer);
  }, []);

  // resolvedTheme gives us the effective theme even when `theme === "system"`.
  const effective = mounted ? resolvedTheme ?? "light" : "light";
  const mode = mounted ? theme ?? "system" : "system";

  function cycle() {
    if (mode === "system") setTheme("light");
    else if (mode === "light") setTheme("dark");
    else setTheme("system");
  }

  const Icon = !mounted
    ? Sun
    : mode === "system"
    ? Laptop
    : effective === "dark"
    ? Moon
    : Sun;

  const label = !mounted
    ? "Theme"
    : mode === "system"
    ? "System theme"
    : mode === "dark"
    ? "Dark mode"
    : "Light mode";

  return (
    <button
      type="button"
      onClick={cycle}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
      aria-label={`Switch theme. Current: ${label}`}
      title={label}
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </button>
  );
}
