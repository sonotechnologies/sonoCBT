"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { deleteDepartmentAction, saveDepartmentAction } from "@/lib/school/department-actions";
import type { DepartmentRow } from "@/lib/school/departments";
import { cn } from "@/lib/utils";

type Choice = { id: string; name: string };

/** One department: name, subjects (chips) and head. New departments use `dept = null`. */
export function DepartmentEditor({
  slug,
  dept,
  subjects,
  staff,
  takenBy,
}: {
  slug: string;
  dept: DepartmentRow | null;
  subjects: Choice[];
  staff: Choice[];
  /** subjectId → name of the department that has it now (other departments). */
  takenBy: Record<string, string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(!!dept);
  const [name, setName] = useState(dept?.name ?? "");
  const [subjectIds, setSubjectIds] = useState<string[]>(dept?.subjectIds ?? []);
  const [hod, setHod] = useState(dept?.hodUserId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="h-11 self-start rounded-md border-[1.5px] border-input bg-card px-4 text-sm font-semibold">
        + Add a department
      </button>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setSaved(false);
        start(async () => {
          const r = await saveDepartmentAction(slug, { id: dept?.id, name, subjectIds, hodUserId: hod || null });
          if (r.error) setError(r.error);
          else {
            setSaved(true);
            if (!dept) {
              setName("");
              setSubjectIds([]);
              setHod("");
              setOpen(false);
            }
            router.refresh();
          }
        });
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
          Department
          <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Sciences" className="h-11 rounded-md border-[1.5px] border-input bg-card px-3 text-sm" />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
          Head of department
          <select value={hod} onChange={(e) => setHod(e.target.value)} className="h-11 rounded-md border-[1.5px] border-input bg-card px-2 text-sm">
            <option value="">No HOD yet</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset>
        <legend className="mb-2 text-[13px] font-semibold">
          Subjects <span className="font-normal text-muted-foreground">(the HOD approves questions and reviews marks for these)</span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {subjects.map((s) => {
            const on = subjectIds.includes(s.id);
            const elsewhere = !on && takenBy[s.id];
            return (
              <label key={s.id} className="cursor-pointer" title={elsewhere ? `Now in ${takenBy[s.id]}; ticking moves it here` : undefined}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => setSubjectIds((ids) => (e.target.checked ? [...ids, s.id] : ids.filter((x) => x !== s.id)))}
                  className="peer sr-only"
                />
                <span
                  className={cn(
                    "flex h-[34px] items-center rounded-full border px-3 text-[13px] font-semibold peer-checked:border-ink peer-checked:bg-ink peer-checked:text-white peer-focus-visible:outline-3 peer-focus-visible:outline-ring",
                    elsewhere ? "border-dashed border-input bg-background text-muted-foreground" : "border-input bg-card",
                  )}
                >
                  {s.name}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="md" disabled={pending}>
          {pending ? "Saving…" : dept ? "Save" : "Add department"}
        </Button>
        {saved && <span className="text-sm font-semibold text-success">Saved</span>}
        <span className="flex-1" />
        {dept ? (
          <button
            type="button"
            className="text-[13px] font-semibold text-ink-2 underline"
            onClick={() => {
              if (confirm(`Remove ${dept.name}? Its subjects stay; its HOD loses the HOD role.`)) {
                start(async () => {
                  await deleteDepartmentAction(slug, dept.id);
                  router.refresh();
                });
              }
            }}
          >
            Remove department
          </button>
        ) : (
          <button type="button" className="text-[13px] font-semibold text-ink-2 underline" onClick={() => setOpen(false)}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
