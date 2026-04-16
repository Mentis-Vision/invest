import Link from "next/link";

export default function MarketingFooter() {
  return (
    <footer className="mt-32 border-t border-border/60 bg-secondary/30">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <svg viewBox="0 0 24 24" className="h-4 w-4 text-[var(--buy)]" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M2 20 L8 10 L14 15 L22 4" />
              </svg>
              <span className="font-heading text-[18px] font-medium">ClearPath</span>
              <span className="ml-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Invest
              </span>
            </div>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground">
              Evidence-based investing. Every claim traces to a source.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-10 text-sm">
            <div>
              <h4 className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Product
              </h4>
              <ul className="space-y-2">
                <li><Link href="/how-it-works" className="text-foreground/80 hover:text-foreground">How It Works</Link></li>
                <li><Link href="/pricing" className="text-foreground/80 hover:text-foreground">Pricing</Link></li>
                <li><Link href="/sign-in" className="text-foreground/80 hover:text-foreground">Sign in</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Company
              </h4>
              <ul className="space-y-2">
                <li><Link href="/manifesto" className="text-foreground/80 hover:text-foreground">Manifesto</Link></li>
                <li><a href="mailto:hello@clearpath-invest.com" className="text-foreground/80 hover:text-foreground">Contact</a></li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-4 border-t border-border/60 pt-6 text-xs text-muted-foreground md:flex-row md:items-center md:justify-between">
          <p>
            © 2026 ClearPath Invest. Informational purposes only. Not investment
            advice.
          </p>
          <p className="font-mono uppercase tracking-[0.2em]">
            Data sources: <span className="text-foreground/70">SEC · FRED · Yahoo Finance · + 9 more</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
