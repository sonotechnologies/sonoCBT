"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { WIZARD_STEPS, type WizardStep } from "@/lib/school/wizard";
import { cn } from "@/lib/utils";

export function WizardSteps({ base, done }: { base: string; done: Record<WizardStep, boolean> }) {
  const segment = useSelectedLayoutSegment() as WizardStep | null;
  const current = Math.max(0, WIZARD_STEPS.findIndex((s) => s.slug === segment));
  const pct = Math.round(((current + 1) / WIZARD_STEPS.length) * 100);

  return (
    <>
      <div className="eyebrow tracking-[.08em]">
        Step {current + 1} of {WIZARD_STEPS.length}
      </div>
      <div
        className="mt-2.5 mb-6 h-1.5 overflow-hidden rounded-[3px] bg-border"
        role="progressbar"
        aria-valuenow={current + 1}
        aria-valuemin={1}
        aria-valuemax={WIZARD_STEPS.length}
        aria-label="Setup progress"
      >
        <div className="h-full bg-ink transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
      <ol className="hidden flex-col gap-1 lg:flex">
        {WIZARD_STEPS.map((s, i) => {
          const isCurrent = i === current;
          const isDone = done[s.slug] && !isCurrent;
          return (
            <li key={s.slug}>
              <Link
                href={`${base}/${s.slug}`}
                aria-current={isCurrent ? "step" : undefined}
                className={cn(
                  "flex min-h-[52px] items-center gap-3 rounded-md px-3 py-2 text-left no-underline",
                  isCurrent ? "bg-card" : "hover:bg-card/60",
                )}
              >
                <span
                  className={cn(
                    "flex size-7 flex-none items-center justify-center rounded-full border-2 font-mono text-[13px] font-semibold",
                    isDone
                      ? "border-ink bg-ink text-white"
                      : isCurrent
                        ? "border-ink bg-pencil text-ink"
                        : "border-[#9AA1B0] bg-white text-ink",
                  )}
                >
                  {isDone ? "✓" : i + 1}
                </span>
                <span className="flex flex-col">
                  <span className={cn("text-sm", isCurrent ? "font-bold" : "font-medium")}>{s.title}</span>
                  <span className="text-xs text-muted-foreground">{s.sub}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </>
  );
}
