"use client";

import { useEffect, useState } from "react";

export function useClientNowMs(): number | null {
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setNowMs(Date.now());
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  return nowMs;
}
