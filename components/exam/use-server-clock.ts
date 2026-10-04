"use client";

import { useEffect, useState } from "react";

/**
 * Ticks once a second on the server's clock. The server is the source of truth
 * for exam times; the device clock only measures elapsed time since render.
 */
export function useServerNow(serverNowMs: number): number {
  const [offset] = useState(() => serverNowMs - Date.now());
  const [now, setNow] = useState(serverNowMs);
  useEffect(() => {
    const tick = () => setNow(Date.now() + offset);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [offset]);
  return now;
}

/** 712 s → "11:52"; 3 h+ → "3:05:00" */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const p = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${p(m)}:${p(s % 60)}` : `${p(m)}:${p(s % 60)}`;
}
