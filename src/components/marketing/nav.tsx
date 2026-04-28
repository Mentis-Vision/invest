"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/research", label: "Weekly brief" },
  { href: "/how-it-works", label: "How It Works" },
  { href: "/alternatives", label: "Compare" },
  { href: "/pricing", label: "Pricing" },
];

export default function MarketingNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="group flex items-center gap-2">
          <Image
            src="/logo.png"
            alt=""
            width={1024}
            height={1014}
            priority
            className="h-11 w-11 object-contain"
          />
          <span className="font-heading text-[18px] font-medium tracking-tight">
            ClearPath
          </span>
          <span className="ml-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Invest
          </span>
        </Link>

        <nav className="hidden items-center gap-7 md:flex">
          {navItems.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`text-sm transition-colors ${
                  active
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          <Link
            href="/sign-in"
            className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline-block"
          >
            Sign in
          </Link>
          {/* Direct sign-up — replaces the prior "Request access"
              CTA that pointed at the landing waitlist anchor. The
              30-day full-feature trial is no-card-required, so the
              CTA can promise a clear outcome ("start free") rather
              than a waitlist position. */}
          <Link
            href="/sign-up?src=nav"
            className="rounded-md bg-foreground px-4 py-2 text-[13px] font-semibold text-background transition-all hover:bg-foreground/85"
          >
            Start free
          </Link>
        </div>
      </div>
    </header>
  );
}
