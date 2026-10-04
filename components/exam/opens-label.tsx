"use client";

import { opensLabel } from "@/lib/exams/present";
import { useServerNow } from "./use-server-clock";

export function OpensLabel({ start, end, serverNow }: { start: number; end: number; serverNow: number }) {
  const now = useServerNow(serverNow);
  return <>{opensLabel({ windowStart: new Date(start), windowEnd: new Date(end) }, new Date(now))}</>;
}
