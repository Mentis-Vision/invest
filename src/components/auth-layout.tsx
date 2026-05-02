"use client";

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
      <div className="relative z-10 w-full max-w-[380px]">{children}</div>
      <Footer />
    </div>
  );
}
