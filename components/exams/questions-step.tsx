"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import {
  addDrawRuleAction,
  addQuestionsAction,
  countPoolAction,
  deleteSectionAction,
  moveSectionAction,
  pickerAction,
  removeDrawRuleAction,
  removeQuestionAction,
  saveSectionAction,
  saveSettingsAction,
  setItemMarksAction,
} from "@/lib/exams/builder-actions";
import type { SettingsInput } from "@/lib/exams/builder";
import { cn } from "@/lib/utils";

const TYPE: Record<string, string> = { mcq_single: "Objective", mcq_multi: "Multiple answer", true_false: "True/false", fill_blank: "Fill in", numeric: "Numeric", theory: "Theory" };
const DIFF: Record<string, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };

export type BuilderSection = {
  id: string;
  title: string;
  subjectId: string | null;
  questionCount: number;
  marks: number;
  items: { id: string; code: string; stemText: string; type: string; effectiveMarks: number; marks: number | null; difficulty: string; status: string; passageId: string | null }[];
  rules: { id: string; count: number; marksEach: number | null; difficulty: string | null; topicName: string | null; levelCode: string | null; subjectName: string }[];
};

type Choices = { subjects: { id: string; name: string }[]; levels: { id: string; code: string }[]; topics: { id: string; name: string; subjectId: string; classLevelId: string | null }[] };

export function QuestionsStep({
  slug,
  examId,
  sections,
  choices,
  settings,
  locked,
  defaultLevelId,
}: {
  slug: string;
  examId: string;
  sections: BuilderSection[];
  choices: Choices;
  settings: SettingsInput;
  locked: boolean;
  defaultLevelId: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<BuilderSection | null>(null);
  const [ruleFor, setRuleFor] = useState<string | null>(null);

  const act = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.error) setError(r.error);
      router.refresh();
    });

  const total = sections.reduce((a, s) => a + s.questionCount, 0);
  const marks = sections.reduce((a, s) => a + s.marks, 0);
  const diffs = sections.flatMap((s) => [...s.items.map((i) => i.difficulty), ...s.rules.flatMap((r) => Array(r.count).fill(r.difficulty ?? "mixed"))]);
  const pct = (d: string) => (diffs.length ? Math.round((diffs.filter((x) => x === d).length / diffs.length) * 100) : 0);
  const mix = ["easy", "medium", "hard"].map((d) => [pct(d), d[0].toUpperCase()] as const).filter(([p]) => p > 0).map(([p, l]) => `${p}% ${l}`).join(" · ") || "—";

  const toggle = (k: "shuffleQuestions" | "shuffleOptions" | "showScoreAfterSubmit") => act(() => saveSettingsAction(slug, examId, { ...settings, [k]: !settings[k] }));

  return (
    <div className="flex max-w-[960px] flex-col gap-4">
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        {[
          ["Questions", String(total)],
          ["Total marks", String(marks)],
          ["Mix", mix],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-border bg-card p-[18px]">
            <div className="text-[13px] text-muted-foreground">{k}</div>
            <div className="mt-1 font-mono text-[26px] font-semibold">{v}</div>
          </div>
        ))}
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-[#FBEAE9] p-3 text-sm font-semibold text-[#8E2019]">
          {error}
        </p>
      )}

      {sections.map((s, si) => (
        <section key={s.id} aria-label={`Section ${s.title}`} className="rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center gap-3 border-b border-divider px-5 py-4">
            <SectionTitle s={s} locked={locked} subjects={choices.subjects} onSave={(title, subjectId) => act(() => saveSectionAction(slug, examId, { id: s.id, title, subjectId }))} />
            <span className="font-mono text-sm">{s.questionCount} questions</span>
            <span className="font-mono text-sm font-semibold">{s.marks} marks</span>
            {!locked && (
              <span className="ml-auto flex gap-1">
                <button type="button" disabled={si === 0 || pending} onClick={() => act(() => moveSectionAction(slug, examId, s.id, -1))} aria-label={`Move ${s.title} up`} className="size-9 rounded-md border border-border disabled:opacity-40">
                  ↑
                </button>
                <button type="button" disabled={si === sections.length - 1 || pending} onClick={() => act(() => moveSectionAction(slug, examId, s.id, 1))} aria-label={`Move ${s.title} down`} className="size-9 rounded-md border border-border disabled:opacity-40">
                  ↓
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => confirm(`Delete section "${s.title}" and its questions from this exam? The questions stay in the bank.`) && act(() => deleteSectionAction(slug, examId, s.id))}
                  className="h-9 rounded-md border border-border px-3 text-[13px] font-semibold text-destructive"
                >
                  Delete
                </button>
              </span>
            )}
          </div>

          {s.items.length > 0 && (
            <ul className="divide-y divide-divider">
              {s.items.map((i) => (
                <li key={i.id} className="grid grid-cols-[88px_minmax(0,1fr)_auto] items-center gap-3 px-5 py-2.5 text-sm sm:grid-cols-[88px_minmax(0,1fr)_110px_90px_auto]">
                  <span className="font-mono text-xs text-muted-foreground">{i.code}</span>
                  <span className="min-w-0 truncate" title={i.stemText}>
                    {i.passageId && <span className="mr-1.5 rounded bg-chip px-1.5 py-0.5 text-[11px] font-semibold">Passage</span>}
                    {i.status !== "approved" && <span className="mr-1.5 rounded bg-[#FBEAE9] px-1.5 py-0.5 text-[11px] font-semibold text-[#8E2019]">Not approved</span>}
                    {i.stemText}
                  </span>
                  <span className="hidden text-[13px] text-muted-foreground sm:block">
                    {TYPE[i.type]} · {DIFF[i.difficulty]}
                  </span>
                  <label className="hidden items-center gap-1 font-mono text-[13px] sm:flex">
                    <input
                      type="number"
                      min={0.5}
                      max={100}
                      step={0.5}
                      defaultValue={i.effectiveMarks}
                      disabled={locked}
                      aria-label={`Marks for ${i.code}`}
                      onBlur={(e) => {
                        const m = Number(e.target.value);
                        if (m !== i.effectiveMarks && m > 0) act(() => setItemMarksAction(slug, examId, i.id, m));
                      }}
                      className="h-8 w-14 rounded border border-input bg-card px-1.5 text-right"
                    />
                    mk
                  </label>
                  {!locked ? (
                    <button type="button" onClick={() => act(() => removeQuestionAction(slug, examId, i.id))} aria-label={`Remove ${i.code}`} className="h-8 rounded px-2 text-[13px] font-semibold text-ink-2 hover:bg-secondary">
                      Remove
                    </button>
                  ) : (
                    <span />
                  )}
                </li>
              ))}
            </ul>
          )}

          {s.rules.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 border-t border-divider bg-background px-5 py-3 text-sm">
              <span className="rounded bg-chip px-2 py-0.5 text-xs font-bold">Random pick</span>
              <span className="min-w-0 flex-1">
                {r.count} {r.difficulty ? DIFF[r.difficulty].toLowerCase() : ""} {r.subjectName} questions{r.topicName ? ` on ${r.topicName}` : ""}
                {r.levelCode ? ` (${r.levelCode})` : ""}, {r.marksEach ?? 1} {r.marksEach === 1 ? "mark" : "marks"} each
              </span>
              <span className="text-[13px] text-muted-foreground">Drawn when you publish</span>
              {!locked && (
                <button type="button" onClick={() => act(() => removeDrawRuleAction(slug, examId, r.id))} className="h-8 rounded px-2 text-[13px] font-semibold text-ink-2 hover:bg-secondary">
                  Remove
                </button>
              )}
            </div>
          ))}

          {!s.items.length && !s.rules.length && <p className="px-5 py-4 text-sm text-muted-foreground">No questions yet. Pick some from the bank, or let SonoCBT draw them at random.</p>}

          {!locked && (
            <div className="flex flex-wrap gap-2 border-t border-divider px-5 py-3.5">
              <Button type="button" variant="outline" size="md" onClick={() => setPicker(s)}>
                + Pick from bank
              </Button>
              <Button type="button" variant="outline" size="md" onClick={() => setRuleFor(ruleFor === s.id ? null : s.id)} aria-expanded={ruleFor === s.id}>
                + Random pick
              </Button>
            </div>
          )}
          {ruleFor === s.id && (
            <RuleForm
              slug={slug}
              examId={examId}
              choices={choices}
              defaultSubjectId={s.subjectId ?? choices.subjects[0]?.id}
              defaultLevelId={defaultLevelId}
              onDone={(err) => {
                if (err) setError(err);
                else setRuleFor(null);
                router.refresh();
              }}
              sectionId={s.id}
            />
          )}
        </section>
      ))}

      {!locked && (
        <button
          type="button"
          onClick={() => act(() => saveSectionAction(slug, examId, { title: `Section ${String.fromCharCode(65 + sections.length)}`, subjectId: null }))}
          className="h-12 rounded-xl border-[1.5px] border-dashed border-[var(--ex-cell-line,#9AA1B0)] bg-card text-sm font-bold"
        >
          + Add section
        </button>
      )}

      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {(
          [
            ["shuffleQuestions", "Shuffle question order"],
            ["shuffleOptions", "Shuffle options"],
            ["showScoreAfterSubmit", "Show score after submit"],
          ] as const
        ).map(([k, l]) => (
          <label key={k} className="flex items-center gap-2">
            <input type="checkbox" checked={settings[k]} disabled={locked || pending} onChange={() => toggle(k)} className="size-5 accent-[#14213D]" />
            {l}
          </label>
        ))}
      </div>
      <p className="text-[13px] text-muted-foreground">Questions that share a passage always stay together. Each student gets their own order; theory questions are never marked automatically.</p>

      {picker && <Picker slug={slug} examId={examId} section={picker} choices={choices} defaultLevelId={defaultLevelId} onClose={() => { setPicker(null); router.refresh(); }} />}
    </div>
  );
}

function SectionTitle({ s, locked, subjects, onSave }: { s: BuilderSection; locked: boolean; subjects: Choices["subjects"]; onSave: (title: string, subjectId: string | null) => void }) {
  const [title, setTitle] = useState(s.title);
  if (locked) return <h3 className="min-w-[160px] flex-1 text-[15px] font-bold">{s.title}</h3>;
  return (
    <span className="flex min-w-[240px] flex-1 flex-wrap gap-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title.trim() && title !== s.title && onSave(title, s.subjectId)}
        aria-label="Section title"
        maxLength={80}
        className="h-9 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-[15px] font-bold hover:border-input focus:border-input"
      />
      <select value={s.subjectId ?? ""} onChange={(e) => onSave(title, e.target.value || null)} aria-label="Section subject" className="h-9 rounded-md border border-input bg-card px-2 text-[13px]">
        <option value="">Mixed subjects</option>
        {subjects.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </select>
    </span>
  );
}

function RuleForm({
  slug,
  examId,
  sectionId,
  choices,
  defaultSubjectId,
  defaultLevelId,
  onDone,
}: {
  slug: string;
  examId: string;
  sectionId: string;
  choices: Choices;
  defaultSubjectId: string | undefined;
  defaultLevelId: string | null;
  onDone: (error?: string) => void;
}) {
  const [r, setR] = useState({ subjectId: defaultSubjectId ?? "", classLevelId: defaultLevelId, topicId: null as string | null, difficulty: null as "easy" | "medium" | "hard" | null, count: 10, marksEach: 1 });
  const [available, setAvailable] = useState<number | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    let live = true;
    if (!r.subjectId) return;
    void countPoolAction(slug, examId, r).then((n) => live && setAvailable(n));
    return () => {
      live = false;
    };
  }, [slug, examId, r]);
  const topics = choices.topics.filter((t) => t.subjectId === r.subjectId && (!r.classLevelId || !t.classLevelId || t.classLevelId === r.classLevelId));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => onDone((await addDrawRuleAction(slug, examId, sectionId, r)).error));
      }}
      className="grid grid-cols-2 gap-3 border-t border-divider bg-background px-5 py-4 sm:grid-cols-6"
    >
      <label className="col-span-2 flex flex-col gap-1 text-xs font-semibold">
        Subject
        <Select value={r.subjectId} onChange={(e) => setR({ ...r, subjectId: e.target.value, topicId: null })} className="h-10 text-sm">
          {choices.subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-semibold">
        Class
        <Select value={r.classLevelId ?? ""} onChange={(e) => setR({ ...r, classLevelId: e.target.value || null, topicId: null })} className="h-10 text-sm">
          <option value="">Any</option>
          {choices.levels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.code}
            </option>
          ))}
        </Select>
      </label>
      <label className="col-span-2 flex flex-col gap-1 text-xs font-semibold sm:col-span-1">
        Topic
        <Select value={r.topicId ?? ""} onChange={(e) => setR({ ...r, topicId: e.target.value || null })} className="h-10 text-sm">
          <option value="">Any topic</option>
          {topics.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-semibold">
        Difficulty
        <Select value={r.difficulty ?? ""} onChange={(e) => setR({ ...r, difficulty: (e.target.value || null) as typeof r.difficulty })} className="h-10 text-sm">
          <option value="">Any</option>
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </Select>
      </label>
      <div className="flex gap-2">
        <label className="flex flex-col gap-1 text-xs font-semibold">
          How many
          <Input type="number" min={1} max={200} value={r.count} onChange={(e) => setR({ ...r, count: Number(e.target.value) })} className="h-10 w-16 px-2 text-sm" mono />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">
          Marks each
          <Input type="number" min={0.5} max={100} step={0.5} value={r.marksEach} onChange={(e) => setR({ ...r, marksEach: Number(e.target.value) })} className="h-10 w-16 px-2 text-sm" mono />
        </label>
      </div>
      <div className="col-span-2 flex items-center gap-3 sm:col-span-6">
        <Button type="submit" size="md" disabled={pending || !available || r.count > (available ?? 0)}>
          Add random pick
        </Button>
        <span className={cn("text-[13px]", available !== null && r.count > available ? "font-semibold text-destructive" : "text-muted-foreground")} aria-live="polite">
          {available === null ? "Counting…" : `${available} approved ${available === 1 ? "question matches" : "questions match"}. Passage questions are only added by hand.`}
        </span>
      </div>
    </form>
  );
}

type PickRow = Awaited<ReturnType<typeof pickerAction>>[number];

function Picker({ slug, examId, section, choices, defaultLevelId, onClose }: { slug: string; examId: string; section: BuilderSection; choices: Choices; defaultLevelId: string | null; onClose: () => void }) {
  const [f, setF] = useState({ subjectId: section.subjectId ?? choices.subjects[0]?.id ?? "", classLevelId: defaultLevelId, topicId: null as string | null, q: "" });
  const [rows, setRows] = useState<PickRow[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => void pickerAction(slug, examId, f).then((r) => live && setRows(r)), 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [slug, examId, f]);

  // Picking one passage question picks its whole passage.
  const toggle = (row: PickRow) =>
    setPicked((p) => {
      const n = new Set(p);
      const group = row.passageId ? (rows ?? []).filter((r) => r.passageId === row.passageId).map((r) => r.id) : [row.id];
      const on = !n.has(row.id);
      for (const id of group) {
        if (on) n.add(id);
        else n.delete(id);
      }
      return n;
    });

  const topics = choices.topics.filter((t) => t.subjectId === f.subjectId);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(20,33,61,.5)] p-4" role="dialog" aria-modal="true" aria-labelledby="picker-title">
      <div className="flex max-h-[90dvh] w-full max-w-3xl flex-col rounded-2xl bg-card">
        <div className="flex items-center gap-3 border-b border-border px-6 py-4">
          <h2 id="picker-title" className="flex-1 text-lg font-extrabold">
            Pick questions for {section.title}
          </h2>
          <button type="button" onClick={onClose} className="h-10 rounded-md px-3 text-sm font-semibold hover:bg-secondary">
            Close
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2.5 border-b border-border px-6 py-3 sm:grid-cols-4">
          <Select value={f.subjectId} onChange={(e) => setF({ ...f, subjectId: e.target.value, topicId: null })} aria-label="Subject" className="h-10 text-sm">
            {choices.subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Select value={f.classLevelId ?? ""} onChange={(e) => setF({ ...f, classLevelId: e.target.value || null })} aria-label="Class" className="h-10 text-sm">
            <option value="">Any class</option>
            {choices.levels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code}
              </option>
            ))}
          </Select>
          <Select value={f.topicId ?? ""} onChange={(e) => setF({ ...f, topicId: e.target.value || null })} aria-label="Topic" className="h-10 text-sm">
            <option value="">Any topic</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <Input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Search words" aria-label="Search" className="h-10 text-sm" />
        </div>
        <div className="min-h-[240px] flex-1 overflow-auto">
          {rows === null ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No approved questions match. Only approved questions can go into an exam.</p>
          ) : (
            <ul className="divide-y divide-divider">
              {rows.map((r) => (
                <li key={r.id}>
                  <label className="flex cursor-pointer items-start gap-3 px-6 py-2.5 text-sm hover:bg-background">
                    <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r)} className="mt-0.5 size-5 flex-none accent-[#14213D]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{r.stemText}</span>
                      <span className="text-xs text-muted-foreground">
                        {TYPE[r.type]} · {DIFF[r.difficulty]} · {r.marks} {r.marks === 1 ? "mark" : "marks"}
                        {r.topicName ? ` · ${r.topicName}` : ""}
                        {r.passageTitle ? ` · Passage: ${r.passageTitle}` : ""}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center gap-3 border-t border-border px-6 py-4">
          {error && (
            <span role="alert" className="text-sm font-semibold text-destructive">
              {error}
            </span>
          )}
          <span className="flex-1 text-sm text-muted-foreground">{picked.size} selected</span>
          <Button
            type="button"
            disabled={!picked.size || pending}
            onClick={() =>
              start(async () => {
                const ordered = (rows ?? []).filter((r) => picked.has(r.id)).map((r) => r.id);
                const res = await addQuestionsAction(slug, examId, section.id, ordered);
                if (res.error) setError(res.error);
                else onClose();
              })
            }
          >
            {pending ? "Adding…" : `Add ${picked.size || ""} to ${section.title}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
