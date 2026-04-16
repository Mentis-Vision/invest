import Link from "next/link";
import MarketingNav from "@/components/marketing/nav";
import MarketingFooter from "@/components/marketing/footer";

export default function NotFound() {
  return (
    <>
      <MarketingNav />
      <main className="mx-auto max-w-2xl px-6 py-24 text-center lg:py-32">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
          404
        </p>
        <h1 className="mt-4 font-[family-name:var(--font-display)] text-5xl font-medium leading-[1.05] tracking-tight lg:text-6xl">
          Nothing here, yet{" "}
          <em className="font-[family-name:var(--font-display)] italic text-[var(--buy)]">
            you looked
          </em>
          .
        </h1>
        <p className="mx-auto mt-6 max-w-md text-sm leading-relaxed text-muted-foreground">
          The page you&rsquo;re after either moved, never existed, or is still
          being drafted. You won&rsquo;t find price targets that changed your
          life here, but you might find the research tool that helps you build
          a case.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3 text-sm">
          <Link
            href="/"
            className="rounded-md bg-[var(--buy)] px-4 py-2 font-medium text-[var(--primary-foreground)] transition hover:opacity-90"
          >
            Back to home
          </Link>
          <Link
            href="/how-it-works"
            className="rounded-md border border-border px-4 py-2 text-foreground transition hover:border-foreground/40"
          >
            How it works
          </Link>
        </div>
      </main>
      <MarketingFooter />
    </>
  );
}
