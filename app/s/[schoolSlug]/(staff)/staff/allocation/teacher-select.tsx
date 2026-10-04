"use client";

import { useState, useTransition } from "react";
import { setOfferingTeacherAction } from "@/lib/staff/actions";
import { cn } from "@/lib/utils";

/** Saves as soon as a teacher is picked. */
export function TeacherSelect({
  slug,
  offeringId,
  label,
  value,
  teachers,
}: {
  slug: string;
  offeringId: string;
  label: string;
  value: string | null;
  teachers: { id: string; name: string }[];
}) {
  const [current, setCurrent] = useState(value ?? "");
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [pending, start] = useTransition();
  return (
    <span className="flex items-center gap-2">
      <select
        value={current}
        aria-label={`Teacher for ${label}`}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          const prev = current;
          setCurrent(next);
          start(async () => {
            const res = await setOfferingTeacherAction(slug, offeringId, next || null);
            if (res.error) {
              setCurrent(prev);
              setStatus("error");
            } else setStatus("saved");
          });
        }}
        className={cn(
          "h-9 min-w-0 flex-1 rounded-md border-[1.5px] border-input bg-card px-2 text-[13px]",
          !current && "text-muted-foreground",
        )}
      >
        <option value="">No teacher yet</option>
        {teachers.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <span className="w-10 text-[11px] font-semibold" aria-live="polite">
        {pending ? "…" : status === "saved" ? <span className="text-success">Saved</span> : status === "error" ? <span className="text-destructive">Failed</span> : null}
      </span>
    </span>
  );
}
