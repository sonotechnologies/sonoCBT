"use client";

import { useState, useTransition } from "react";
import type { BatchAction } from "@/lib/results/pipeline";
import { moveBatchesAction } from "@/lib/results/pipeline-actions";
import { cn } from "@/lib/utils";

/** One workflow step for one or more classes (send for review, approve, send back, release, un-release). */
export function BatchButton({
  slug,
  termId,
  armIds,
  action,
  label,
  confirmText,
  askReason,
  variant = "primary",
  className,
}: {
  slug: string;
  termId: string;
  armIds: string[];
  action: BatchAction;
  label: string;
  confirmText?: string;
  askReason?: boolean;
  variant?: "primary" | "outline" | "pencil";
  className?: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending || !armIds.length}
        onClick={() => {
          if (confirmText && !window.confirm(confirmText)) return;
          const reason = askReason ? window.prompt("Reason (goes in the change log):")?.trim() : undefined;
          if (askReason && !reason) return;
          start(async () => {
            const r = await moveBatchesAction(slug, termId, armIds, action, reason);
            setError(r.error ?? null);
          });
        }}
        className={cn(
          "h-10 rounded-md px-4 text-[13px] font-bold whitespace-nowrap disabled:opacity-50",
          variant === "primary" ? "bg-ink text-white" : variant === "pencil" ? "bg-pencil text-ink" : "border-[1.5px] border-input bg-card text-foreground",
          className,
        )}
      >
        {pending ? "…" : label}
      </button>
      {error && (
        <span role="alert" className="max-w-xs text-right text-xs font-semibold text-destructive">
          {error}
        </span>
      )}
    </span>
  );
}
