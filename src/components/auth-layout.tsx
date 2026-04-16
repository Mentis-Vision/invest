"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";

function GridLines() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-[0.03]">
      {Array.from({ length: 12 }).map((_, i) => (
        <div
          key={`v-${i}`}
          className="absolute top-0 h-full w-px bg-white"
          style={{ left: `${(i + 1) * (100 / 13)}%` }}
        />
      ))}
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={`h-${i}`}
          className="absolute left-0 h-px w-full bg-white"
          style={{ top: `${(i + 1) * (100 / 9)}%` }}
        />
      ))}
    </div>
  );
}

function TickerTape() {
  const tickers = [
    { sym: "SPX", val: "5,234.18", chg: "+0.47%" },
    { sym: "NDX", val: "18,439.12", chg: "+0.82%" },
    { sym: "DJI", val: "39,118.55", chg: "-0.12%" },
    { sym: "VIX", val: "13.42", chg: "-2.31%" },
    { sym: "TNX", val: "4.328%", chg: "+0.015" },
    { sym: "GC=F", val: "2,398.40", chg: "+1.14%" },
    { sym: "CL=F", val: "78.62", chg: "-0.38%" },
    { sym: "BTC", val: "71,204", chg: "+2.87%" },
  ];
  const doubled = [...tickers, ...tickers];

  return (
    <div className="absolute bottom-0 left-0 right-0 overflow-hidden border-t border-white/[0.06] bg-black/40 backdrop-blur-sm">
      <motion.div
        className="flex whitespace-nowrap py-2.5"
        animate={{ x: ["0%", "-50%"] }}
        transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
      >
        {doubled.map((t, i) => (
          <span key={i} className="mx-6 inline-flex items-center gap-2 font-mono text-[11px] tracking-wider">
            <span className="text-white/30">{t.sym}</span>
            <span className="text-white/50">{t.val}</span>
            <span className={t.chg.startsWith("-") ? "text-red-400/70" : "text-emerald-400/70"}>
              {t.chg}
            </span>
          </span>
        ))}
      </motion.div>
    </div>
  );
}

function PulseChart() {
  const [points, setPoints] = useState<string>("");

  useEffect(() => {
    const w = 400;
    const h = 200;
    let pts: string[] = [];
    let y = h / 2;
    for (let x = 0; x <= w; x += 2) {
      y += (Math.random() - 0.48) * 6;
      y = Math.max(30, Math.min(h - 30, y));
      pts.push(`${x},${y}`);
    }
    setPoints(pts.join(" "));
  }, []);

  if (!points) return null;

  return (
    <svg viewBox="0 0 400 200" className="absolute right-0 top-1/2 h-[60vh] w-auto -translate-y-1/2 translate-x-[15%] opacity-[0.04]">
      <polyline
        points={points}
        fill="none"
        stroke="white"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0a0a0f]">
      <GridLines />
      <PulseChart />

      {/* Ambient glow */}
      <div className="pointer-events-none absolute left-1/2 top-0 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/[0.03] blur-[120px]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-[400px] w-[400px] translate-x-1/4 translate-y-1/4 rounded-full bg-emerald-500/[0.02] blur-[100px]" />

      {/* Content */}
      <div className="relative z-10 w-full max-w-[420px] px-6">{children}</div>

      <TickerTape />
    </div>
  );
}
