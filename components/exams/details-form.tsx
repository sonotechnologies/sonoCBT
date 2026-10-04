"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { createExamAction, saveDetailsAction } from "@/lib/exams/builder-actions";
import { cn } from "@/lib/utils";

export type DetailsChoices = {
  terms: { id: string; label: string; isCurrent: boolean }[];
  subjects: { id: string; name: string }[];
  arms: { id: string; name: string; level: string }[];
  components: { id: string; termId: string; name: string; weight: number }[];
};

export type DetailsValues = {
  title: string;
  series: string;
  fullTitle: string;
  type: "ca_test" | "exam" | "mock" | "entrance" | "practice";
  termId: string;
  subjectIds: string[];
  classArmIds: string[];
  durationMinutes: number;
  calculator: "off" | "basic" | "scientific";
  instructions: string;
  componentId: string | null;
  aiMarking: boolean;
};

const TYPES: [DetailsValues["type"], string][] = [
  ["ca_test", "CA test"],
  ["exam", "Exam"],
  ["mock", "Mock"],
  ["entrance", "Entrance exam"],
  ["practice", "Practice (not graded)"],
];

function Chips({ items, selected, onToggle, label }: { items: { id: string; name: string }[]; selected: string[]; onToggle: (id: string) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {items.map((i) => {
        const on = selected.includes(i.id);
        return (
          <button
            key={i.id}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(i.id)}
            className={cn("h-10 rounded-full border-[1.5px] px-3.5 text-sm font-semibold", on ? "border-ink bg-ink text-white" : "border-input bg-card")}
          >
            {on ? "✓ " : ""}
            {i.name}
          </button>
        );
      })}
    </div>
  );
}

export function DetailsForm({ slug, examId, initial, choices, locked }: { slug: string; examId?: string; initial: DetailsValues; choices: DetailsChoices; locked?: boolean }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const set = <K extends keyof DetailsValues>(k: K, val: DetailsValues[K]) => {
    if (k === "termId") setV((x) => ({ ...x, componentId: null }));
    setV((x) => ({ ...x, [k]: val }));
    setSaved(false);
  };
  const toggle = (k: "subjectIds" | "classArmIds", id: string) => set(k, v[k].includes(id) ? v[k].filter((x) => x !== id) : [...v[k], id]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const input = { ...v, series: v.series || null, fullTitle: v.fullTitle || null, instructions: v.instructions || null };
      if (examId) {
        const r = await saveDetailsAction(slug, examId, input);
        if (r.error) setError(r.error);
        else {
          setSaved(true);
          router.push(`/s/${slug}/exams/${examId}?step=questions`);
        }
      } else {
        const r = await createExamAction(slug, input);
        if (r.error || !r.id) setError(r.error ?? "Couldn't create the exam.");
        else router.push(`/s/${slug}/exams/${r.id}?step=questions`);
      }
    });
  };

  const levels = [...new Set(choices.arms.map((a) => a.level))];
  return (
    <form onSubmit={submit} className="grid max-w-[760px] grid-cols-1 gap-[18px] sm:grid-cols-2">
      <fieldset disabled={locked} className="contents">
        <Field label="Exam title" className="sm:col-span-2" hint="Short, as students see it on their home screen. e.g. JSS1 Mathematics CA test">
          <Input value={v.title} onChange={(e) => set("title", e.target.value)} required maxLength={120} />
        </Field>
        <Field label="Full title (optional)" className="sm:col-span-2" hint="Shown on the exam screen. e.g. Paper 1 — English, Mathematics & Basic Science">
          <Input value={v.fullTitle} onChange={(e) => set("fullTitle", e.target.value)} maxLength={200} />
        </Field>
        <Field label="Type">
          <Select value={v.type} onChange={(e) => set("type", e.target.value as DetailsValues["type"])}>
            {TYPES.map(([id, l]) => (
              <option key={id} value={id}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Series (optional)" hint="Groups papers, e.g. JSS3 Mock Examination">
          <Input value={v.series} onChange={(e) => set("series", e.target.value)} maxLength={120} />
        </Field>
        <Field label="Term">
          <Select value={v.termId} onChange={(e) => set("termId", e.target.value)} required>
            {choices.terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
                {t.isCurrent ? " (current)" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Duration (minutes)">
          <Input type="number" min={5} max={360} value={v.durationMinutes} onChange={(e) => set("durationMinutes", Number(e.target.value))} mono required />
        </Field>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-[13px] font-semibold">Subjects</span>
          <Chips label="Subjects" items={choices.subjects} selected={v.subjectIds} onToggle={(id) => toggle("subjectIds", id)} />
        </div>
        <div className="flex flex-col gap-3 sm:col-span-2">
          <span className="text-[13px] font-semibold">Classes</span>
          {levels.map((lvl) => (
            <div key={lvl} className="flex flex-wrap items-center gap-3">
              <span className="w-12 font-mono text-xs text-muted-foreground">{lvl}</span>
              <Chips label={`${lvl} classes`} items={choices.arms.filter((a) => a.level === lvl)} selected={v.classArmIds} onToggle={(id) => toggle("classArmIds", id)} />
            </div>
          ))}
        </div>
        <Field label="Calculator">
          <Select value={v.calculator} onChange={(e) => set("calculator", e.target.value as DetailsValues["calculator"])}>
            <option value="off">Not allowed</option>
            <option value="basic">Basic, on screen</option>
            <option value="scientific">Scientific, on screen</option>
          </Select>
        </Field>
        <Field label="Counts towards" hint="The part of this term's result the scores go into. Change the parts in Results → Setup.">
          <Select value={v.componentId ?? ""} onChange={(e) => set("componentId", e.target.value || null)}>
            <option value="">Doesn&apos;t count (practice)</option>
            {choices.components
              .filter((c) => c.termId === v.termId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} /{c.weight}
                </option>
              ))}
          </Select>
        </Field>
        <label className="flex items-start gap-3 self-end pb-3 text-sm sm:col-span-2">
          <input type="checkbox" checked={v.aiMarking} onChange={(e) => set("aiMarking", e.target.checked)} className="mt-0.5 size-5 accent-[#14213D]" />
          <span>
            <b>AI suggestions when marking theory</b>
            <span className="block text-[13px] text-muted-foreground">Teachers see a suggested score with its reasons and always decide. Only the question, marking guide and answer text are sent, never names.</span>
          </span>
        </label>
        <Field label="Instructions for students (optional)" className="sm:col-span-2">
          <textarea
            value={v.instructions}
            onChange={(e) => set("instructions", e.target.value)}
            maxLength={4000}
            rows={3}
            className="rounded-md border-[1.5px] border-input bg-card p-3.5 text-base font-medium"
          />
        </Field>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm font-semibold text-destructive sm:col-span-2">
          {error}
        </p>
      )}
      {!locked && (
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : examId ? "Save and continue" : "Create exam"}
          </Button>
          {saved && <span className="text-sm text-success">Saved</span>}
        </div>
      )}
    </form>
  );
}
