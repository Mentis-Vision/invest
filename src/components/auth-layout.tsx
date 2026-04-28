"use client";

import Link from "next/link";
import Image from "next/image";

function PaperTexture() {
  // Subtle paper-grain via layered radial gradients
  return (
    <div
      className="pointer-events-none absolute inset-0 opacity-[0.35]"
      style={{
        backgroundImage: `
          radial-gradient(circle at 20% 10%, rgba(181, 79, 42, 0.04) 0%, transparent 40%),
          radial-gradient(circle at 80% 90%, rgba(45, 95, 63, 0.04) 0%, transparent 45%),
          radial-gradient(circle at 95% 15%, rgba(154, 123, 63, 0.03) 0%, transparent 35%)
        `,
      }}
    />
  );
}

/**
 * Brand mark at the top of every auth screen — clickable, returns to
 * the marketing site. Replaces the previous "Issue 01 · Private Beta"
 * editorial rule, which both broadcast a status we no longer want to
 * lead with and left users with no way back to the marketing site if
 * they wandered into the auth flow.
 */
function BrandMark() {
  return (
    <Link
      href="/"
      className="group absolute left-1/2 top-10 flex -translate-x-1/2 items-center gap-2 text-foreground/85 transition-opacity hover:opacity-100"
      aria-label="ClearPath Invest — back to home"
    >
      <Image
        src="/logo.png"
        alt=""
        width={1024}
        height={1014}
        priority
        className="h-9 w-9 object-contain"
      />
      <span className="font-heading text-[16px] font-medium tracking-tight">
        ClearPath
      </span>
      <span className="ml-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground transition-colors group-hover:text-foreground/60">
        Invest
      </span>
    </Link>
  );
}

function Footer() {
  // Editorial trust strip. Replaces the prior "verified by 3 AI · zero
  // hallucination" copy. Two issues with that pair: "verified by 3 AI"
  // reads as a marketing count rather than a mechanism, and "zero
  // hallucination" is an impossible claim — sophisticated readers
  // dismiss it on sight, which is the opposite of the trust we want.
  // Replace with copy that names what we actually do: three
  // independent model lenses (already established in the manifesto)
  // and source-cited claims.
  return (
    <div className="pointer-events-none absolute bottom-6 left-0 right-0 flex items-center justify-center gap-6 text-[10px] font-mono uppercase tracking-[0.25em] text-foreground/25">
      <span>est. 2026</span>
      <span className="text-foreground/15">·</span>
      <span>three lenses, one verdict</span>
      <span className="text-foreground/15">·</span>
      <span>cited to primary sources</span>
    </div>
  );
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6">
      <PaperTexture />
      <BrandMark />
      <div className="relative z-10 w-full max-w-[380px]">{children}</div>
      <Footer />
    </div>
  );
}
