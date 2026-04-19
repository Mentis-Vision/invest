import Link from "next/link";
import Image from "next/image";

export default function MarketingFooter() {
  return (
    <footer className="mt-32 border-t border-border/60 bg-secondary/30">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Image
                src="/logo.png"
                alt=""
                width={1024}
                height={1014}
                className="h-8 w-8 object-contain"
              />
              <span className="font-heading text-[18px] font-medium">ClearPath</span>
              <span className="ml-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Invest
              </span>
            </div>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground">
              Evidence-based investing. Every claim traces to a source.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-10 text-sm">
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
            <div>
              <h4 className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Legal
              </h4>
              <ul className="space-y-2">
                <li><Link href="/terms" className="text-foreground/80 hover:text-foreground">Terms</Link></li>
                <li><Link href="/privacy" className="text-foreground/80 hover:text-foreground">Privacy</Link></li>
                <li><Link href="/disclosures" className="text-foreground/80 hover:text-foreground">Disclosures</Link></li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-10 border-t border-border/60 pt-6 text-xs leading-relaxed text-muted-foreground">
          <p className="max-w-4xl">
            <strong className="text-foreground/80">Important:</strong> ClearPath
            Invest provides <em className="font-[family-name:var(--font-display)]">research tools and
            informational content only</em>. Nothing on this site is investment,
            tax, legal, or accounting advice. ClearPath is not a registered
            investment advisor, broker-dealer, or fiduciary. Any analyses or
            track-record data are historical and informational — past
            performance does not guarantee future results. AI models produce
            output that may be incomplete, inaccurate, or incorrect. Always
            consult a licensed professional before acting on information from
            this site.
          </p>
          <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <p>
              © 2026 ClearPath Invest.{" "}
              <Link href="/terms" className="underline">
                Terms
              </Link>
              {" · "}
              <Link href="/privacy" className="underline">
                Privacy
              </Link>
              {" · "}
              <Link href="/disclosures" className="underline">
                Disclosures
              </Link>
            </p>
            <p className="font-mono uppercase tracking-[0.2em]">
              Data sources: <span className="text-foreground/70">SEC · FRED · Yahoo Finance · + 9 more</span>
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
