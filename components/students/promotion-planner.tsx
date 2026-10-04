"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { promoteAction } from "@/lib/students/move-actions";
import { cn } from "@/lib/utils";

type Target = { kind: "arm"; armId: string } | { kind: "stay" } | { kind: "graduate" } | { kind: "left" };
type Plan = {
  classes: { id: string; name: string; level: string; target: Target; check: boolean; students: { id: string; name: string; admissionNo: string }[] }[];
  arms: { id: string; name: string; level: string }[];
};

const enc = (t: Target) => (t.kind === "arm" ? `arm:${t.armId}` : t.kind);
const dec = (v: string): Target => (v.startsWith("arm:") ? { kind: "arm", armId: v.slice(4) } : ({ kind: v } as Target));

function TargetSelect({ value, onChange, arms, label, withClass }: { value: string; onChange: (v: string) => void; arms: Plan["arms"]; label: string; withClass?: boolean }) {
  const levels = [...new Set(arms.map((a) => a.level))];
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className="h-10 w-full rounded-md border-[1.5px] border-input bg-card px-2 text-sm font-medium">
      {withClass && <option value="">With the class</option>}
      {levels.map((l) => (
        <optgroup key={l} label={l}>
          {arms
            .filter((a) => a.level === l)
            .map((a) => (
              <option key={a.id} value={`arm:${a.id}`}>
                {a.name}
              </option>
            ))}
        </optgroup>
      ))}
      <option value="stay">Stay in this class</option>
      <option value="graduate">Graduate</option>
      <option value="left">Left the school</option>
    </select>
  );
}

export function PromotionPlanner({ slug, plan, sessionName, alreadyPromoted }: { slug: string; plan: Plan; sessionName: string; alreadyPromoted: string | null }) {
  const [classes, setClasses] = useState<Record<string, string>>(() => Object.fromEntries(plan.classes.map((c) => [c.id, enc(c.target)])));
  const [students, setStudents] = useState<Record<string, string>>({});
  const [openClass, setOpenClass] = useState<string | null>(null);
  const [again, setAgain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ moved: number; stayed: number; graduated: number; left: number } | null>(null);
  const [pending, start] = useTransition();
  const armName = new Map(plan.arms.map((a) => [a.id, a.name]));

  const totals = useMemo(() => {
    const t = { moved: 0, stayed: 0, graduated: 0, left: 0 };
    for (const c of plan.classes) {
      for (const s of c.students) {
        const v = dec(students[s.id] || classes[c.id]);
        if (v.kind === "arm" && v.armId !== c.id) t.moved++;
        else if (v.kind === "arm" || v.kind === "stay") t.stayed++;
        else t[v.kind === "graduate" ? "graduated" : "left"]++;
      }
    }
    return t;
  }, [classes, students, plan.classes]);

  if (done) {
    return (
      <section role="status" className="rounded-xl border border-[#BFE0CB] bg-[#E8F4EC] p-6 text-[#155E34]">
        <h2 className="text-xl font-extrabold">Students promoted for {sessionName}</h2>
        <p className="mt-2 text-[15px]">
          {done.moved} moved up · {done.stayed} stayed · {done.graduated} graduated · {done.left} left the school. Last session&apos;s results stay with the classes they sat in.
        </p>
        <Link href={`/s/${slug}/students`} className="mt-4 inline-block font-bold text-[#155E34]">
          See the students →
        </Link>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-left text-xs text-ink-2">
            <tr>
              <th className="px-4 py-2.5">This session&apos;s class</th>
              <th className="px-2 py-2.5 text-right">Students</th>
              <th className="w-[260px] px-4 py-2.5">Goes to</th>
              <th className="px-4 py-2.5">
                <span className="sr-only">Exceptions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {plan.classes.map((c) => {
              const exceptions = c.students.filter((s) => students[s.id]).length;
              return (
                <tr key={c.id} className="border-t border-divider align-top">
                  <td className="px-4 py-3 font-bold">
                    {c.name}
                    {c.check && <div className="mt-0.5 text-xs font-semibold text-[#8A430B]">Check: there&apos;s no matching class a level up</div>}
                  </td>
                  <td className="px-2 py-3 text-right font-mono">{c.students.length}</td>
                  <td className="px-4 py-2">
                    <TargetSelect value={classes[c.id]} onChange={(v) => setClasses((x) => ({ ...x, [c.id]: v }))} arms={plan.arms} label={`${c.name} goes to`} />
                    {openClass === c.id && (
                      <ul className="mt-3 flex flex-col gap-2" aria-label={`${c.name} students`}>
                        {c.students.map((s) => (
                          <li key={s.id} className="flex flex-col gap-1">
                            <span className="text-[13px] font-semibold">
                              {s.name} <span className="font-mono text-xs text-muted-foreground">{s.admissionNo}</span>
                            </span>
                            <TargetSelect value={students[s.id] ?? ""} onChange={(v) => setStudents((x) => ({ ...x, [s.id]: v }))} arms={plan.arms} label={`${s.name} goes to`} withClass />
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" onClick={() => setOpenClass(openClass === c.id ? null : c.id)} className="text-[13px] font-bold whitespace-nowrap underline">
                      {openClass === c.id ? "Done" : exceptions ? `${exceptions} ${exceptions === 1 ? "exception" : "exceptions"}` : "Exceptions…"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="flex flex-wrap items-center gap-4 rounded-xl bg-ink px-5 py-4 text-white">
        <p className="flex-1 text-[15px]">
          <b className="font-mono">{totals.moved}</b> move up · <b className="font-mono">{totals.stayed}</b> stay · <b className="font-mono">{totals.graduated}</b> graduate · <b className="font-mono">{totals.left}</b> leave
        </p>
        {alreadyPromoted && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={again} onChange={(e) => setAgain(e.target.checked)} className="size-4" />
            Promote again
          </label>
        )}
        <button
          type="button"
          disabled={pending || (!!alreadyPromoted && !again)}
          onClick={() => {
            const leaving = totals.graduated + totals.left;
            if (!window.confirm(`Move students for ${sessionName}? ${totals.moved} move up${leaving ? ` and ${leaving} come off the register (they can't sign in after this)` : ""}.`)) return;
            start(async () => {
              const r = await promoteAction(slug, {
                classes: Object.fromEntries(Object.entries(classes).map(([k, v]) => [k, dec(v)])),
                students: Object.fromEntries(Object.entries(students).filter(([, v]) => v).map(([k, v]) => [k, dec(v)])),
                again,
              });
              if (r.error || !r.data) setError(r.error ?? "Something went wrong.");
              else setDone(r.data);
            });
          }}
          className={cn("h-12 rounded-md bg-pencil px-5 text-[15px] font-extrabold text-ink disabled:opacity-50")}
        >
          {pending ? "Moving…" : "Promote students"}
        </button>
      </section>
      {error && (
        <p role="alert" className="rounded-md border border-[#F2C6C2] bg-[#FBEAE9] px-4 py-3 text-sm font-semibold text-[#7A1F18]">
          {error}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {Object.values(classes).some((v) => v.startsWith("arm:") && !armName.has(v.slice(4))) ? "Some destinations no longer exist. " : ""}
        Scores and report cards from last session stay with the classes students sat in. Graduated and departed students keep their records but can&apos;t sign in.
      </p>
    </div>
  );
}
