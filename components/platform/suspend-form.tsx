"use client";

import { useActionState } from "react";
import { suspendAction } from "@/lib/platform/actions";

/** Suspend (with a reason) or reactivate a school. */
export function SuspendForm({ schoolId, suspended, demo }: { schoolId: string; suspended: boolean; demo: boolean }) {
  const [state, action, pending] = useActionState(suspendAction.bind(null, schoolId, !suspended), undefined);
  return (
    <form action={action} className="flex flex-col gap-2.5">
      {!suspended && (
        <label className="flex flex-col gap-1.5 text-[13px] font-bold">
          Reason (goes in the log)
          <input name="reason" required minLength={3} maxLength={200} disabled={demo} className="h-11 rounded-md border-[1.5px] border-input bg-card px-3 text-sm font-medium" />
        </label>
      )}
      {state?.error && (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending || (demo && !suspended)} className={suspended ? "h-11 rounded-md bg-ink px-4 text-sm font-bold text-white disabled:opacity-50" : "h-11 rounded-md border-[1.5px] border-destructive px-4 text-sm font-bold text-destructive disabled:opacity-50"}>
        {pending ? "…" : suspended ? "Reactivate school" : "Suspend school"}
      </button>
      {demo && !suspended && <p className="text-xs text-muted-foreground">The demo school can&apos;t be suspended.</p>}
    </form>
  );
}
