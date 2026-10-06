"use client";

import { useState, useTransition } from "react";
import { endStudentAction, moveStudentAction, readmitStudentAction } from "@/lib/students/move-actions";

type Arm = { id: string; name: string };

/** "Change class…" on a student row: move arm, graduate, left the school, or readmit. */
export function StudentMoves({ slug, student, arms }: { slug: string; student: { id: string; name: string; classArmId: string | null; status: "active" | "graduated" | "left" }; arms: Arm[] }) {
  const [open, setOpen] = useState(false);
  const [armId, setArmId] = useState(arms.find((a) => a.id !== student.classArmId)?.id ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.error) setError(r.error);
      else setOpen(false);
    });
  const active = student.status === "active";

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="h-9 rounded-md border-[1.5px] border-input bg-card px-3 text-[13px] font-semibold whitespace-nowrap">
        {active ? "Change class…" : "Readmit…"}
      </button>
      {open && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(20,33,61,.5)] p-4" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby={`mv-${student.id}`} className="flex max-h-[90dvh] w-full max-w-[460px] flex-col gap-4 overflow-y-auto rounded-2xl bg-card p-5 text-left sm:p-6 shadow-[0_24px_60px_rgba(20,33,61,.25)]">
            <h2 id={`mv-${student.id}`} className="text-lg font-extrabold">
              {student.name}
            </h2>
            <label className="flex flex-col gap-1.5 text-[13px] font-bold">
              {active ? "Move to another class from this term" : "Readmit into"}
              <span className="flex gap-2">
                <select value={armId} onChange={(e) => setArmId(e.target.value)} className="h-11 flex-1 rounded-md border-[1.5px] border-input bg-card px-2 text-sm font-medium">
                  {arms
                    .filter((a) => a.id !== student.classArmId)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  disabled={pending || !armId}
                  onClick={() => run(() => (active ? moveStudentAction(slug, student.id, armId) : readmitStudentAction(slug, student.id, armId)))}
                  className="h-11 rounded-md bg-ink px-4 text-sm font-bold text-white disabled:opacity-50"
                >
                  {active ? "Move" : "Readmit"}
                </button>
              </span>
            </label>
            {active && (
              <div className="flex flex-col gap-2 border-t border-divider pt-4">
                <label className="flex flex-col gap-1.5 text-[13px] font-bold">
                  Or take them off the register (reason, optional)
                  <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="e.g. Moved to another school" className="h-11 rounded-md border-[1.5px] border-input bg-card px-3 text-sm font-medium" />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={pending} onClick={() => run(() => endStudentAction(slug, student.id, "left", reason))} className="h-10 rounded-md border-[1.5px] border-input px-3 text-sm font-semibold disabled:opacity-50">
                    Left the school
                  </button>
                  <button type="button" disabled={pending} onClick={() => run(() => endStudentAction(slug, student.id, "graduated", reason))} className="h-10 rounded-md border-[1.5px] border-input px-3 text-sm font-semibold disabled:opacity-50">
                    Graduated
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">Their results and report cards stay. They can no longer sign in, and they stop counting towards billing.</p>
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm font-semibold text-destructive">
                {error}
              </p>
            )}
            <button type="button" onClick={() => setOpen(false)} className="self-end text-sm font-semibold text-ink-2 underline">
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
