"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { GradeBand } from "@/lib/grading";
import { saveComponentsAction, saveScaleAction } from "@/lib/results/pipeline-actions";
import { bandProblems, componentProblems } from "@/lib/results/rules";
import { cn } from "@/lib/utils";

type Comp = { id?: string; name: string; weight: number };

const STANDARD: Comp[] = [
  { name: "CA1", weight: 10 },
  { name: "CA2", weight: 10 },
  { name: "Assignment", weight: 10 },
  { name: "Project", weight: 10 },
  { name: "Exam", weight: 60 },
];

function Msg({ m }: { m: { ok: boolean; text: string } | null }) {
  if (!m) return null;
  return (
    <span role={m.ok ? "status" : "alert"} className={cn("text-sm font-semibold", m.ok ? "text-success" : "text-destructive")}>
      {m.text}
    </span>
  );
}

export function ComponentsEditor({ slug, termId, termLabel, initial, used }: { slug: string; termId: string; termLabel: string; initial: Comp[]; used: Record<string, number> }) {
  const [list, setList] = useState<Comp[]>(initial.length ? initial : []);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const sum = list.reduce((a, c) => a + (Number(c.weight) || 0), 0);
  const problem = componentProblems(list);
  const set = (i: number, k: keyof Comp, v: string) => setList((xs) => xs.map((c, j) => (j === i ? { ...c, [k]: k === "weight" ? Number(v) : v } : c)));

  return (
    <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="comp-title">
      <h2 id="comp-title" className="text-lg font-extrabold">
        How {termLabel} adds up
      </h2>
      <p className="mt-1 text-sm text-ink-2">Each part is marked out of its own number; together they make 100. Exams feed one part (set on the exam), teachers type the rest in the CA grid.</p>
      <div className="mt-4 flex flex-col gap-2">
        {list.map((c, i) => (
          <div key={c.id ?? `new-${i}`} className="flex flex-wrap items-center gap-2.5">
            <input value={c.name} onChange={(e) => set(i, "name", e.target.value)} aria-label="Component name" maxLength={30} className="h-11 w-48 rounded-md border-[1.5px] border-input bg-card px-3 font-semibold" />
            <span className="text-sm text-muted-foreground">out of</span>
            <input type="number" min={1} max={100} value={c.weight} onChange={(e) => set(i, "weight", e.target.value)} aria-label={`${c.name} out of`} className="h-11 w-20 rounded-md border-[1.5px] border-input bg-card px-3 text-right font-mono" />
            {c.id && used[c.id] ? <span className="text-xs text-muted-foreground">{used[c.id]} scores entered</span> : null}
            <button type="button" onClick={() => setList((xs) => xs.filter((_, j) => j !== i))} disabled={!!(c.id && used[c.id])} title={c.id && used[c.id] ? "Has scores, so it can't be removed" : undefined} className="h-9 rounded-md px-2 text-[13px] font-semibold text-destructive disabled:opacity-40">
              Remove
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setList((xs) => [...xs, { name: "", weight: 10 }])} className="h-10 rounded-md border-[1.5px] border-dashed border-[#9AA1B0] px-3 text-[13px] font-bold">
          + Add a part
        </button>
        {!list.length && (
          <button type="button" onClick={() => setList(STANDARD)} className="h-10 rounded-md border-[1.5px] border-input px-3 text-[13px] font-bold">
            Use CA1 10 · CA2 10 · Assignment 10 · Project 10 · Exam 60
          </button>
        )}
        <span className={cn("font-mono text-sm font-bold", sum === 100 ? "text-success" : "text-[#8A430B]")}>Total {sum} / 100</span>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button
          type="button"
          disabled={pending || !!problem}
          title={problem ?? undefined}
          onClick={() =>
            start(async () => {
              const r = await saveComponentsAction(slug, termId, list);
              setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: "Saved" });
            })
          }
        >
          {pending ? "Saving…" : "Save"}
        </Button>
        <Msg m={msg ?? (problem && list.length ? { ok: false, text: problem } : null)} />
      </div>
    </section>
  );
}

export function ScaleEditor({ slug, initial }: { slug: string; initial: GradeBand[] }) {
  const [bands, setBands] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const problem = bandProblems(bands);
  const set = (i: number, k: keyof GradeBand, v: string) => setBands((xs) => xs.map((b, j) => (j === i ? { ...b, [k]: k === "min" || k === "max" ? Number(v) : v } : b)));

  return (
    <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="scale-title">
      <h2 id="scale-title" className="text-lg font-extrabold">
        Grading scale
      </h2>
      <p className="mt-1 text-sm text-ink-2">Used for every subject&apos;s grade and remark on the broadsheet and report cards. WAEC A1–F9 to start with.</p>
      <table className="mt-4 text-sm">
        <thead>
          <tr className="text-left text-xs font-bold text-muted-foreground">
            <th className="pr-3 pb-1.5">Grade</th>
            <th className="pr-3 pb-1.5">From</th>
            <th className="pr-3 pb-1.5">To</th>
            <th className="pb-1.5">Remark</th>
          </tr>
        </thead>
        <tbody>
          {bands.map((b, i) => (
            <tr key={i}>
              <td className="py-1 pr-3">
                <input value={b.grade} onChange={(e) => set(i, "grade", e.target.value)} maxLength={4} aria-label="Grade" className="h-10 w-16 rounded-md border-[1.5px] border-input px-2 font-mono font-bold" />
              </td>
              <td className="py-1 pr-3">
                <input type="number" step="0.01" value={b.min} onChange={(e) => set(i, "min", e.target.value)} aria-label={`${b.grade} from`} className="h-10 w-20 rounded-md border-[1.5px] border-input px-2 text-right font-mono" />
              </td>
              <td className="py-1 pr-3">
                <input type="number" step="0.01" value={b.max} onChange={(e) => set(i, "max", e.target.value)} aria-label={`${b.grade} to`} className="h-10 w-20 rounded-md border-[1.5px] border-input px-2 text-right font-mono" />
              </td>
              <td className="py-1">
                <input value={b.remark} onChange={(e) => set(i, "remark", e.target.value)} maxLength={40} aria-label={`${b.grade} remark`} className="h-10 w-40 rounded-md border-[1.5px] border-input px-2" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4 flex items-center gap-3">
        <Button
          type="button"
          disabled={pending || !!problem}
          onClick={() =>
            start(async () => {
              const r = await saveScaleAction(slug, bands);
              setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: "Saved" });
            })
          }
        >
          {pending ? "Saving…" : "Save scale"}
        </Button>
        <Msg m={msg ?? (problem ? { ok: false, text: problem } : null)} />
      </div>
    </section>
  );
}
