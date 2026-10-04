"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

type Row = { key: number; name: string; weight: string };

/** Assessment components (CA1, CA2, Exam…) with a live total that must reach 100. */
export function WeightsEditor({ initial }: { initial: { name: string; weight: number }[] }) {
  const [rows, setRows] = useState<Row[]>(initial.map((c, i) => ({ key: i, name: c.name, weight: String(c.weight) })));
  const total = rows.reduce((s, r) => s + (Number(r.weight) || 0), 0);
  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-2">
          <input
            name="componentName"
            value={r.name}
            onChange={(e) => update(r.key, { name: e.target.value })}
            aria-label="Assessment name"
            placeholder="e.g. CA 1"
            className="h-11 min-w-0 flex-1 rounded-md border-[1.5px] border-input bg-card px-3 text-[15px] focus:border-2 focus:border-primary focus:outline-none"
          />
          <input
            name="componentWeight"
            value={r.weight}
            onChange={(e) => update(r.key, { weight: e.target.value.replace(/\D/g, "").slice(0, 3) })}
            inputMode="numeric"
            aria-label={`Weight for ${r.name || "this assessment"}`}
            className="h-11 w-20 rounded-md border-[1.5px] border-input bg-card px-3 text-right font-mono text-[15px] focus:border-2 focus:border-primary focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
            disabled={rows.length <= 1}
            className="h-11 rounded-md px-3 text-sm font-semibold text-ink-2 hover:bg-secondary disabled:opacity-40"
            aria-label={`Remove ${r.name || "assessment"}`}
          >
            Remove
          </button>
        </div>
      ))}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setRows((rs) => [...rs, { key: Date.now(), name: "", weight: "" }])}
          className="h-10 rounded-md border-[1.5px] border-dashed border-[#9AA1B0] px-3 text-[13px] font-semibold text-ink-2"
        >
          + Add assessment
        </button>
        <span className="flex-1" />
        <span className={cn("text-sm", total === 100 ? "text-ink-2" : "font-semibold text-warning")} aria-live="polite">
          Total <b className="font-mono">{total}</b> of 100
        </span>
      </div>
    </div>
  );
}
