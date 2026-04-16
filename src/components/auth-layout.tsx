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

function EditorialRule() {
  return (
    <div className="pointer-events-none absolute left-1/2 top-12 flex -translate-x-1/2 items-center gap-3 text-[10px] font-mono uppercase tracking-[0.3em] text-foreground/30">
      <div className="h-px w-8 bg-foreground/20" />
      <span>Issue 01 · Private Beta</span>
      <div className="h-px w-8 bg-foreground/20" />
    </div>
  );
}

function Footer() {
  return (
    <div className="pointer-events-none absolute bottom-6 left-0 right-0 flex items-center justify-center gap-6 text-[10px] font-mono uppercase tracking-[0.25em] text-foreground/25">
      <span>est. 2026</span>
      <span className="text-foreground/15">·</span>
      <span>verified by 3 AI</span>
      <span className="text-foreground/15">·</span>
      <span>zero hallucination</span>
    </div>
  );
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6">
      <PaperTexture />
      <EditorialRule />
      <div className="relative z-10 w-full max-w-[380px]">{children}</div>
      <Footer />
    </div>
  );
}
