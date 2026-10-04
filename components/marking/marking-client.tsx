"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";
import { saveMarkAction, suggestMarkAction } from "@/lib/marking/actions";
import { cn } from "@/lib/utils";

type Script = {
  answerId: string;
  n: number;
  text: string;
  marks: number | null;
  comment: string | null;
  aiMarks: number | null;
  aiPoints: { ok: boolean; text: string }[] | null;
  name: string | null;
};

export type MarkingSessionData = {
  exam: { id: string; title: string; aiMarking: boolean };
  question: { id: string; code: string; marks: number; stemHtml: string; guideHtml: string | null; number: number; of: number; siblings: string[] };
  scripts: Script[];
  canShowNames: boolean;
};

export function MarkingClient({ slug, data, showNames }: { slug: string; data: MarkingSessionData; showNames: boolean }) {
  const [scripts, setScripts] = useState(data.scripts);
  const [i, setI] = useState(() => Math.max(0, data.scripts.findIndex((s) => s.marks === null)));
  const [score, setScore] = useState<number | null>(data.scripts[i]?.marks ?? null);
  const [comment, setComment] = useState(data.scripts[i]?.comment ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [asking, startAsk] = useTransition();
  const cur = scripts[i];
  const max = data.question.marks;
  const done = scripts.filter((s) => s.marks !== null).length;
  const allDone = done === scripts.length;
  const nextQ = data.question.siblings[data.question.number];

  const open = useCallback(
    (to: number) => {
      const j = (to + scripts.length) % scripts.length;
      setI(j);
      setScore(scripts[j].marks);
      setComment(scripts[j].comment ?? "");
      setError(null);
    },
    [scripts],
  );

  const saveAndNext = useCallback(() => {
    if (score === null || !cur) return;
    startSave(async () => {
      const r = await saveMarkAction(slug, cur.answerId, score, comment || null);
      if (r.error) {
        setError(r.error);
        return;
      }
      const updated = scripts.map((s, k) => (k === i ? { ...s, marks: score, comment: comment || null } : s));
      setScripts(updated);
      // Next unmarked script, else simply the next one.
      const nextIdx = [...updated.keys()].map((k) => (i + 1 + k) % updated.length).find((k) => updated[k].marks === null);
      const j = nextIdx ?? (i + 1) % updated.length;
      setI(j);
      setScore(updated[j].marks);
      setComment(updated[j].comment ?? "");
      setError(null);
    });
  }, [score, cur, comment, scripts, i, slug]);

  const ask = () =>
    startAsk(async () => {
      const r = await suggestMarkAction(slug, cur.answerId);
      if (r.error || r.marks === undefined) setError(r.error ?? "No suggestion.");
      else setScripts((xs) => xs.map((s, k) => (k === i ? { ...s, aiMarks: r.marks!, aiPoints: r.points ?? [] } : s)));
    });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key) && Number(e.key) <= max) {
        setScore(Number(e.key));
        e.preventDefault();
      } else if (e.key === "Enter") {
        saveAndNext();
        e.preventDefault();
      } else if (e.key === "ArrowLeft") open(i - 1);
      else if (e.key === "ArrowRight") open(i + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [max, saveAndNext, open, i]);

  if (!cur) return null;
  const words = cur.text.trim() ? cur.text.trim().split(/\s+/).length : 0;
  const values = max <= 20 ? Array.from({ length: max + 1 }, (_, k) => k) : [];

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-4 border-b border-border bg-card px-4 py-[18px] lg:px-8">
        <div className="min-w-[220px] flex-1">
          <div className="text-[13px] font-semibold text-muted-foreground">
            <Link href={`/s/${slug}/marking`} className="text-muted-foreground">
              Marking
            </Link>{" "}
            · {data.exam.title} · Question {data.question.number} of {data.question.of}
          </div>
          <h1 className="mt-0.5 text-[22px] font-extrabold">Theory marking</h1>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className="text-[13px]">
            <b className="font-mono">{done}</b> of {scripts.length} scripts marked
          </span>
          <span className="h-1.5 w-[200px] overflow-hidden rounded-[3px] bg-border" role="progressbar" aria-valuenow={done} aria-valuemax={scripts.length} aria-label="Scripts marked">
            <span className="block h-full bg-success" style={{ width: `${Math.round((done / scripts.length) * 100)}%` }} />
          </span>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-[18px] overflow-auto px-4 py-6 lg:px-8 lg:py-7">
          <div className="rounded-xl border border-border bg-secondary px-5 py-[18px]">
            <div className="text-xs font-bold tracking-[.06em] text-muted-foreground uppercase">
              Question · {max} {max === 1 ? "mark" : "marks"} · {data.question.code}
            </div>
            <div className="rich mt-1.5 text-lg leading-relaxed" dangerouslySetInnerHTML={{ __html: data.question.stemHtml }} />
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[15px] font-extrabold">
              Script {cur.n} of {scripts.length}
            </span>
            <span className="text-[13px] text-muted-foreground">{cur.name ?? "Name hidden while marking"}</span>
            {data.canShowNames && (
              <Link href={showNames ? "?" : "?names=1"} className="text-[13px] font-semibold">
                {showNames ? "Hide names" : "Show names"}
              </Link>
            )}
            <span className="flex-1" />
            <span className="font-mono text-xs text-muted-foreground">{words} words</span>
          </div>
          <div className="font-exam rounded-xl border border-border bg-card px-6 py-[22px] text-lg leading-[1.7] whitespace-pre-wrap">{cur.text}</div>
          <details className="rounded-xl border border-border bg-card" open>
            <summary className="cursor-pointer px-5 py-3.5 text-sm font-bold">Marking guide</summary>
            <div className="px-5 pb-4">
              {data.question.guideHtml ? <div className="rich text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: data.question.guideHtml }} /> : <p className="text-sm text-muted-foreground">No marking guide was written for this question.</p>}
            </div>
          </details>
        </div>

        <aside className="flex flex-col gap-5 overflow-auto border-t border-border bg-card px-4 py-6 lg:border-t-0 lg:border-l lg:px-7 lg:py-7">
          {data.exam.aiMarking && (
            <div className="rounded-xl border-[1.5px] border-[#C7D9EE] bg-[#F5F9FD]">
              <div className="flex items-center gap-2.5 border-b border-[#C7D9EE] px-[18px] py-3.5">
                <span className="flex-1 text-xs font-bold tracking-[.06em] text-[#1D4B80] uppercase">Suggested score</span>
                {cur.aiMarks !== null ? (
                  <span className="font-mono text-[22px] font-bold">
                    {cur.aiMarks}/{max}
                  </span>
                ) : (
                  <button type="button" onClick={ask} disabled={asking} className="h-9 rounded-md bg-card px-3 text-[13px] font-bold text-[#1D4B80] ring-1 ring-[#C7D9EE]">
                    {asking ? "Thinking…" : "Suggest a score"}
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-2 px-[18px] py-3.5">
                {(cur.aiPoints ?? []).map((p, k) => (
                  <div key={k} className="flex gap-2.5 text-sm leading-snug">
                    <span
                      aria-label={p.ok ? "earned" : "not earned"}
                      className={cn("mt-0.5 flex size-[18px] flex-none items-center justify-center rounded-full border-[1.5px] text-[11px] font-extrabold", p.ok ? "border-success bg-success text-white" : "border-[#9AA1B0] bg-card text-muted-foreground")}
                    >
                      {p.ok ? "✓" : "–"}
                    </span>
                    <span>{p.text}</span>
                  </div>
                ))}
                <div className="mt-1 text-xs text-muted-foreground">A suggestion only. Your score is final.</div>
              </div>
            </div>
          )}

          <div>
            <div className="mb-2.5 text-[13px] font-bold">Your score</div>
            {values.length ? (
              <div className="grid grid-cols-7 gap-2" role="group" aria-label="Score">
                {values.map((v) => {
                  const on = score === v;
                  const hint = !on && score === null && v === cur.aiMarks;
                  return (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setScore(v)}
                      className={cn("h-[52px] rounded-md font-mono text-lg font-bold", on ? "border-2 border-ink bg-pencil" : hint ? "border-[1.5px] border-dashed border-info bg-[#EAF1F9]" : "border-[1.5px] border-input bg-card")}
                    >
                      {v}
                    </button>
                  );
                })}
              </div>
            ) : null}
            <label className="mt-2 flex items-center gap-2 text-[13px] text-muted-foreground">
              Or type a score (halves allowed)
              <input
                type="number"
                min={0}
                max={max}
                step={0.5}
                value={score ?? ""}
                onChange={(e) => setScore(e.target.value === "" ? null : Number(e.target.value))}
                className="h-9 w-20 rounded-md border border-input bg-card px-2 font-mono text-foreground"
              />
            </label>
            {cur.aiMarks !== null && (
              <button type="button" onClick={() => setScore(cur.aiMarks)} className="mt-3 h-12 w-full rounded-md bg-ink text-sm font-bold text-white">
                Accept {cur.aiMarks}
              </button>
            )}
          </div>
          <label className="flex flex-col gap-1.5 text-[13px] font-bold">
            Comment to student (optional)
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} rows={3} className="rounded-md border-[1.5px] border-input bg-card p-3 text-sm font-medium" />
          </label>
          {error && (
            <p role="alert" className="text-sm font-semibold text-destructive">
              {error}
            </p>
          )}
          <div className="flex-1" />
          {allDone && (
            <p role="status" className="rounded-md bg-[#E8F4EC] px-3 py-2.5 text-sm font-semibold text-[#155E34]">
              Every script for this question is marked.{" "}
              {nextQ ? (
                <Link href={`/s/${slug}/marking/${nextQ}`} className="underline">
                  Next question
                </Link>
              ) : (
                <Link href={`/s/${slug}/marking`} className="underline">
                  Back to marking
                </Link>
              )}
            </p>
          )}
          <div className="flex gap-2.5">
            <button type="button" onClick={() => open(i - 1)} className="h-[52px] rounded-md border-[1.5px] border-input bg-card px-[18px] text-sm font-semibold">
              Previous
            </button>
            <button type="button" onClick={saveAndNext} disabled={score === null || saving} className="h-[52px] flex-1 rounded-md bg-pencil text-[15px] font-extrabold text-ink disabled:opacity-50">
              {saving ? "Saving…" : `Save ${score === null ? "" : `${score}/${max} `}& next script`}
            </button>
          </div>
          <div className="text-center text-xs text-muted-foreground">Keys: 0–{Math.min(9, max)} score · Enter save &amp; next · ← → move</div>
        </aside>
      </div>
    </main>
  );
}
