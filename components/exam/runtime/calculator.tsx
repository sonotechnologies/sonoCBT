"use client";

import { useState } from "react";
import { evaluate, formatResult } from "@/lib/exams/calc";

const BASIC = [
  ["C", "(", ")", "÷"],
  ["7", "8", "9", "×"],
  ["4", "5", "6", "−"],
  ["1", "2", "3", "+"],
  ["0", ".", "⌫", "="],
];
const SCI = [
  ["sin", "cos", "tan", "√"],
  ["log", "ln", "^", "π"],
];

/** On-screen calculator. Keys work with the mouse only, so exam shortcuts stay predictable. */
export function Calculator({ mode, onClose }: { mode: "basic" | "scientific"; onClose: () => void }) {
  const [expr, setExpr] = useState("");
  const [result, setResult] = useState<string | null>(null);

  const press = (k: string) => {
    if (k === "C") {
      setExpr("");
      setResult(null);
    } else if (k === "⌫") setExpr((e) => e.slice(0, -1));
    else if (k === "=") {
      const v = evaluate(expr);
      setResult(v === null ? "Error" : formatResult(v));
      if (v !== null) setExpr(formatResult(v));
    } else {
      const text = ["sin", "cos", "tan", "log", "ln", "√"].includes(k) ? `${k}(` : k;
      setExpr((e) => (result !== null && /^[0-9.(]/.test(text) && e === result ? text : e + text));
      setResult(null);
    }
  };

  const rows = mode === "scientific" ? [...SCI, ...BASIC] : BASIC;
  return (
    <div role="dialog" aria-label="Calculator" className="w-[264px] rounded-xl border border-border bg-card p-3 shadow-[0_12px_32px_rgba(20,33,61,.2)]">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[13px] font-bold">Calculator{mode === "scientific" ? " · degrees" : ""}</span>
        <button type="button" onClick={onClose} className="h-8 rounded-md px-2 text-[13px] font-semibold hover:bg-secondary">
          Close
        </button>
      </div>
      <output className="mb-2 flex min-h-[56px] flex-col items-end justify-center rounded-md bg-background px-3 font-mono" aria-live="polite">
        <span className="max-w-full truncate text-[13px] text-muted-foreground">{expr || " "}</span>
        <span className="text-[22px] font-semibold tabular-nums">{result ?? (expr ? " " : "0")}</span>
      </output>
      <div className="grid grid-cols-4 gap-1.5">
        {rows.flat().map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => press(k)}
            className={
              "h-11 rounded-md border text-[15px] font-semibold " +
              (k === "=" ? "border-ink bg-ink text-white" : /^[0-9.]$/.test(k) ? "border-border bg-card" : "border-border bg-secondary")
            }
            aria-label={k === "⌫" ? "Delete" : k === "C" ? "Clear" : k === "−" ? "minus" : undefined}
          >
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}
