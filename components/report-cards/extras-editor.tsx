"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { num } from "@/lib/format";
import { ordinal } from "@/lib/grading";
import { AFFECTIVE, PSYCHOMOTOR, RATING_KEY, REMARK_MAX, suggestPrincipalRemark, type RatingItem } from "@/lib/results/extras-model";
import { fillPrincipalRemarksAction, saveExtrasAction, setDaysOpenedAction } from "@/lib/results/report-card-actions";
import { cn } from "@/lib/utils";

type Extras = {
  formTeacherRemark: string | null;
  principalRemark: string | null;
  affective: Record<string, number>;
  psychomotor: Record<string, number>;
  daysPresent: number | null;
  daysOpened: number | null;
};
export type EditorStudent = { id: string; name: string; admissionNo: string; average: number | null; position: number | null; extras: Extras };

const done = (e: Extras) => ({
  remark: !!e.formTeacherRemark,
  ratings: Object.keys(e.affective).length + Object.keys(e.psychomotor).length,
  attendance: e.daysPresent !== null && e.daysOpened !== null,
  principal: !!e.principalRemark,
});

function RatingRows({ title, items, value, onChange, disabled }: { title: string; items: RatingItem[]; value: Record<string, number>; onChange: (v: Record<string, number>) => void; disabled: boolean }) {
  return (
    <fieldset className="flex flex-col gap-1.5" disabled={disabled}>
      <legend className="mb-1 text-[13px] font-bold">{title}</legend>
      {items.map((it) => (
        <div key={it.key} className="flex items-center gap-2" role="radiogroup" aria-label={it.name}>
          <span className="min-w-0 flex-1 truncate text-sm">{it.name}</span>
          {[5, 4, 3, 2, 1].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={value[it.key] === n}
              aria-label={`${it.name} ${n}`}
              onClick={() => onChange({ ...value, [it.key]: n })}
              className={cn("size-8 rounded-md border-[1.5px] font-mono text-sm font-bold", value[it.key] === n ? "border-ink bg-ink text-white" : "border-input bg-card")}
            >
              {n}
            </button>
          ))}
        </div>
      ))}
    </fieldset>
  );
}

export function ExtrasEditor({
  slug,
  termId,
  classArmId,
  students: initial,
  canEdit,
  canPrincipal,
  pdfBase,
}: {
  slug: string;
  termId: string;
  classArmId: string;
  students: EditorStudent[];
  canEdit: boolean;
  canPrincipal: boolean;
  pdfBase: string;
}) {
  const [students, setStudents] = useState(initial);
  const [i, setI] = useState(0);
  const cur = students[i];
  const [draft, setDraft] = useState<Extras | null>(cur?.extras ?? null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const panel = useRef<HTMLElement>(null);
  const [opened, setOpened] = useState(String(initial.find((s) => s.extras.daysOpened !== null)?.extras.daysOpened ?? ""));

  const open = (n: number) => {
    if (n < 0 || n >= students.length) return;
    setI(n);
    setDraft(students[n].extras);
    setMsg(null);
    panel.current?.scrollTo({ top: 0 });
  };
  const dirty = useMemo(() => !!draft && !!cur && JSON.stringify(draft) !== JSON.stringify(cur.extras), [draft, cur]);
  const progress = students.reduce((a, s) => a + (done(s.extras).remark ? 1 : 0), 0);

  const save = (next: boolean) =>
    start(async () => {
      if (!draft || !cur) return;
      const payload: Partial<Extras> = {
        formTeacherRemark: draft.formTeacherRemark,
        affective: draft.affective,
        psychomotor: draft.psychomotor,
        daysPresent: draft.daysPresent,
        daysOpened: draft.daysOpened,
        ...(canPrincipal ? { principalRemark: draft.principalRemark } : {}),
      };
      const r = await saveExtrasAction(slug, termId, classArmId, cur.id, payload);
      if (r.error) return setMsg({ ok: false, text: r.error });
      setStudents((xs) => xs.map((s, j) => (j === i ? { ...s, extras: draft } : s)));
      setMsg({ ok: true, text: "Saved" });
      if (next && i + 1 < students.length) {
        setI(i + 1);
        setDraft(students[i + 1].extras);
        panel.current?.scrollTo({ top: 0 });
      }
    });

  if (!cur || !draft) return <p className="p-8 text-sm text-ink-2">No students in this class this term.</p>;
  const field = (k: keyof Extras, v: unknown) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const intOrNull = (v: string) => (v.trim() === "" ? null : Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : null);

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="flex min-h-0 flex-col border-b border-border lg:w-[52%] lg:border-r lg:border-b-0">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-border bg-background px-4 py-3 text-[13px] lg:px-6">
          <span className="font-semibold">
            {progress} of {students.length} remarks written
          </span>
          <span className="flex-1" />
          {canEdit && (
            <label className="flex items-center gap-1.5">
              School opened
              <input value={opened} onChange={(e) => setOpened(e.target.value)} inputMode="numeric" aria-label="Days school opened this term" className="h-9 w-16 rounded-md border-[1.5px] border-input bg-card px-2 text-right font-mono" />
              days
              <button
                type="button"
                disabled={pending || !opened.trim()}
                onClick={() =>
                  start(async () => {
                    const n = Number(opened);
                    const r = await setDaysOpenedAction(slug, termId, classArmId, n);
                    if (r.error) return setMsg({ ok: false, text: r.error });
                    setStudents((xs) => xs.map((s) => ({ ...s, extras: { ...s.extras, daysOpened: n } })));
                    setDraft((d) => (d ? { ...d, daysOpened: n } : d));
                    setMsg({ ok: true, text: `Set for all ${students.length} students` });
                  })
                }
                className="h-9 rounded-md border-[1.5px] border-input bg-card px-2.5 font-bold disabled:opacity-50"
              >
                Apply to class
              </button>
            </label>
          )}
          {canPrincipal && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await fillPrincipalRemarksAction(slug, termId, classArmId);
                  if (r.error) return setMsg({ ok: false, text: r.error });
                  setStudents((xs) => xs.map((s) => (s.extras.principalRemark || s.average === null ? s : { ...s, extras: { ...s.extras, principalRemark: suggestPrincipalRemark(s.average) } })));
                  setMsg({ ok: true, text: `Filled ${r.data?.filled ?? 0} principal's remarks` });
                })
              }
              className="h-9 rounded-md border-[1.5px] border-input bg-card px-2.5 font-bold disabled:opacity-50"
            >
              Fill principal&apos;s remarks
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-secondary text-left text-xs text-ink-2">
              <tr>
                <th className="px-4 py-2.5 lg:pl-6">Student</th>
                <th className="px-2 py-2.5 text-right">Avg</th>
                <th className="px-2 py-2.5 text-right">Pos.</th>
                <th className="px-2 py-2.5">Remark</th>
                <th className="px-2 py-2.5">Ratings</th>
                <th className="px-2 py-2.5">Present</th>
                <th className="px-2 py-2.5">Principal</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s, n) => {
                const d = done(s.extras);
                return (
                  <tr key={s.id} aria-selected={n === i} onClick={() => open(n)} className={cn("cursor-pointer border-t border-divider", n === i ? "bg-[#FFF4CC]" : "bg-card hover:bg-background")}>
                    <th scope="row" className="px-4 py-2.5 text-left font-semibold lg:pl-6">
                      <button type="button" onClick={() => open(n)} className="text-left">
                        {s.name}
                      </button>
                    </th>
                    <td className="px-2 text-right font-mono">{num(s.average)}</td>
                    <td className="px-2 text-right font-mono">{s.position ? ordinal(s.position) : "—"}</td>
                    <td className="px-2">{d.remark ? "✓ Done" : <span className="text-[#8A430B]">To do</span>}</td>
                    <td className="px-2 font-mono">{d.ratings}/12</td>
                    <td className="px-2 font-mono">{d.attendance ? `${s.extras.daysPresent}/${s.extras.daysOpened}` : "—"}</td>
                    <td className="px-2">{d.principal ? "✓ Done" : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <aside ref={panel} aria-label="Report card details" className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto bg-card p-4 lg:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-extrabold">{cur.name}</h2>
            <div className="text-[13px] text-muted-foreground">
              {cur.admissionNo} · average {num(cur.average)} · {cur.position ? `${ordinal(cur.position)} in class` : "no scores yet"}
            </div>
          </div>
          <a href={`${pdfBase}&student=${cur.id}&inline=1`} target="_blank" rel="noopener" className="h-10 rounded-md border-[1.5px] border-input px-3 text-[13px] leading-[37px] font-bold text-foreground no-underline">
            Preview PDF
          </a>
        </div>
        {!canEdit && <p className="rounded-md bg-[#EAF1F9] px-3 py-2.5 text-sm text-[#1D4B80]">Read-only: this class has been approved, so only the school admin can change its report cards.</p>}

        <label className="flex flex-col gap-1.5 text-[13px] font-bold">
          Form teacher&apos;s remark
          <textarea value={draft.formTeacherRemark ?? ""} onChange={(e) => field("formTeacherRemark", e.target.value)} disabled={!canEdit} maxLength={REMARK_MAX} rows={3} className="rounded-md border-[1.5px] border-input bg-card p-3 text-sm font-medium" />
        </label>

        <div className="grid gap-5 2xl:grid-cols-2">
          <RatingRows title="Affective domain" items={AFFECTIVE} value={draft.affective} onChange={(v) => field("affective", v)} disabled={!canEdit} />
          <RatingRows title="Psychomotor skills" items={PSYCHOMOTOR} value={draft.psychomotor} onChange={(v) => field("psychomotor", v)} disabled={!canEdit} />
        </div>
        <p className="-mt-2 text-xs text-muted-foreground">{RATING_KEY}</p>

        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1.5 text-[13px] font-bold">
            Days present
            <input value={draft.daysPresent ?? ""} onChange={(e) => field("daysPresent", intOrNull(e.target.value))} disabled={!canEdit} inputMode="numeric" className="h-11 w-24 rounded-md border-[1.5px] border-input bg-card px-3 text-right font-mono" />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-bold">
            Days school opened
            <input value={draft.daysOpened ?? ""} onChange={(e) => field("daysOpened", intOrNull(e.target.value))} disabled={!canEdit} inputMode="numeric" className="h-11 w-24 rounded-md border-[1.5px] border-input bg-card px-3 text-right font-mono" />
          </label>
        </div>

        <label className="flex flex-col gap-1.5 text-[13px] font-bold">
          <span className="flex items-center gap-2">
            Principal&apos;s remark
            {canPrincipal && cur.average !== null && (
              <button type="button" onClick={() => field("principalRemark", suggestPrincipalRemark(cur.average!))} className="text-xs font-semibold text-info underline">
                Suggest from average
              </button>
            )}
          </span>
          <textarea value={draft.principalRemark ?? ""} onChange={(e) => field("principalRemark", e.target.value)} disabled={!canPrincipal} maxLength={REMARK_MAX} rows={2} className="rounded-md border-[1.5px] border-input bg-card p-3 text-sm font-medium disabled:bg-background" />
          {!canPrincipal && <span className="text-xs font-medium text-muted-foreground">Written by the school admin.</span>}
        </label>

        {msg && (
          <p role={msg.ok ? "status" : "alert"} className={cn("text-sm font-semibold", msg.ok ? "text-success" : "text-destructive")}>
            {msg.text}
          </p>
        )}
        <div className="mt-auto flex gap-2.5">
          <button type="button" onClick={() => open(i - 1)} disabled={i === 0} className="h-12 rounded-md border-[1.5px] border-input bg-card px-4 text-sm font-semibold disabled:opacity-40">
            Previous
          </button>
          {canEdit || canPrincipal ? (
            <button type="button" onClick={() => save(true)} disabled={pending || !dirty} className="h-12 flex-1 rounded-md bg-pencil text-[15px] font-extrabold text-ink disabled:opacity-50">
              {pending ? "Saving…" : i + 1 < students.length ? "Save & next student" : "Save"}
            </button>
          ) : (
            <button type="button" onClick={() => open(i + 1)} disabled={i + 1 >= students.length} className="h-12 flex-1 rounded-md border-[1.5px] border-input bg-card text-sm font-semibold disabled:opacity-40">
              Next student
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
