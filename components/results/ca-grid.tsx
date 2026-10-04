"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GradeBand } from "@/lib/grading";
import { saveScoresAction } from "@/lib/results/pipeline-actions";
import { cellIssue, parsePaste } from "@/lib/results/rules";
import { cn } from "@/lib/utils";

type Student = { id: string; name: string; admissionNo: string; values: Record<string, number>; sources: Record<string, string> };

export type GridProps = {
  slug: string;
  termId: string;
  classArmId: string;
  subjectId: string;
  components: { id: string; name: string; weight: number }[];
  students: Student[];
  bands: GradeBand[];
  canEdit: boolean;
  needsReason: boolean;
};

const ord = (n: number) => {
  const v = n % 100;
  return n + (v >= 11 && v <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th");
};
const clock = () => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());

export function CaGrid(p: GridProps) {
  const comps = p.components;
  // Raw text per cell, so a half-typed "7." or a wrong value can sit there until fixed.
  const [text, setText] = useState<Record<string, string>>(() => {
    const t: Record<string, string> = {};
    for (const s of p.students) for (const c of comps) t[`${s.id}:${c.id}`] = s.values[c.id] === undefined ? "" : String(s.values[c.id]);
    return t;
  });
  const saved = useRef<Record<string, string>>({ ...text });
  const [status, setStatus] = useState<{ kind: "saved" | "saving" | "error"; text: string }>({ kind: "saved", text: "All saved" });
  const [reason, setReason] = useState<string | null>(null);
  const [paste, setPaste] = useState<{ r: number; c: number } | null>(null);
  const [pasteText, setPasteText] = useState("");
  const focus = useRef<{ r: number; c: number }>({ r: 0, c: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const key = (r: number, c: number) => `${p.students[r].id}:${comps[c].id}`;

  const flush = useCallback(async () => {
    const changes = Object.entries(text)
      // Only changed cells that are empty or valid; wrong ones wait (highlighted) until fixed.
      .filter(([k, v]) => {
        if (saved.current[k] === v) return false;
        const max = comps.find((c) => k.endsWith(`:${c.id}`))!.weight;
        const issue = cellIssue(v, max);
        return issue === null || issue === "missing";
      })
      .map(([k, v]) => {
        const [studentId, componentId] = k.split(":");
        return { studentId, componentId, value: v.trim() === "" ? null : Number(v) };
      });
    if (!changes.length) return;
    let why = reason;
    if (p.needsReason && !why) {
      why = window.prompt("This class has been sent for review. Why are you changing these scores? (It goes in the change log.)")?.trim() || null;
      if (!why) {
        setStatus({ kind: "error", text: "Not saved: a reason is needed" });
        return;
      }
      setReason(why);
    }
    setStatus({ kind: "saving", text: "Saving…" });
    const r = await saveScoresAction(p.slug, p.termId, p.classArmId, p.subjectId, changes, why ?? undefined);
    if (r.error) {
      setStatus({ kind: "error", text: r.error });
      return;
    }
    for (const c of changes) saved.current[`${c.studentId}:${c.componentId}`] = c.value === null ? "" : String(c.value);
    setStatus({ kind: "saved", text: `Saved ${clock()}` });
  }, [text, comps, p.slug, p.termId, p.classArmId, p.subjectId, p.needsReason, reason]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 800);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [text, flush]);

  // Totals, grades and positions update as you type (the server recomputes on the broadsheet).
  const totals = useMemo(
    () =>
      p.students.map((s) => {
        const vals = comps.map((c) => text[`${s.id}:${c.id}`]?.trim() ?? "");
        if (vals.every((v) => v === "")) return null;
        return Math.round(vals.reduce((a, v) => a + (Number(v) || 0), 0) * 100) / 100;
      }),
    [text, p.students, comps],
  );
  const present = totals.filter((t): t is number => t !== null);
  const position = (t: number) => 1 + present.filter((x) => x > t).length;
  const grade = (t: number) => p.bands.find((b) => t >= b.min && t <= b.max)?.grade ?? "—";
  const issues = Object.entries(text).filter(([k, v]) => cellIssue(v, comps.find((c) => k.endsWith(`:${c.id}`))!.weight) !== null).length;

  const move = (r: number, c: number) => {
    const rr = Math.max(0, Math.min(p.students.length - 1, r));
    const cc = Math.max(0, Math.min(comps.length - 1, c));
    document.getElementById(`cell-${rr}-${cc}`)?.focus();
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    const el = e.currentTarget;
    const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
    const atEnd = el.selectionStart === el.value.length;
    if (e.key === "ArrowDown" || e.key === "Enter") {
      e.preventDefault();
      move(r + 1, c);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(r - 1, c);
    } else if (e.key === "ArrowLeft" && atStart) {
      e.preventDefault();
      move(r, c - 1);
    } else if (e.key === "ArrowRight" && atEnd) {
      e.preventDefault();
      move(r, c + 1);
    }
  };

  const applyPaste = (raw: string, at = focus.current) => {
    const rows = parsePaste(raw);
    const { r: r0, c: c0 } = at;
    setText((t) => {
      const next = { ...t };
      rows.forEach((row, i) =>
        row.forEach((v, j) => {
          const r = r0 + i;
          const c = c0 + j;
          if (r < p.students.length && c < comps.length) next[key(r, c)] = v;
        }),
      );
      return next;
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-4 border-b border-border px-4 py-3 text-[13px] text-ink-2 lg:px-8">
        <span>{comps.map((c) => `${c.name} /${c.weight}`).join(" · ")}</span>
        <span className="flex-1" />
        <span role="status" className={cn("font-semibold", status.kind === "error" ? "text-destructive" : status.kind === "saving" ? "text-ink-2" : "text-success")}>
          {status.kind === "saved" ? "✓ " : ""}
          {status.text}
        </span>
        {p.canEdit && (
          <button type="button" onClick={() => setPaste({ ...focus.current })} className="h-9 rounded-md border-[1.5px] border-input bg-card px-3 text-[13px] font-bold text-foreground">
            Paste from Excel
          </button>
        )}
        <span className="hidden lg:inline">Type a score and press Enter or Tab. Arrow keys move.</span>
      </div>
      {!p.canEdit && <p className="border-b border-border bg-[#EAF1F9] px-4 py-2.5 text-sm text-[#1D4B80] lg:px-8">These scores are read-only for you. The class may have been sent for review, or the subject is taught by someone else.</p>}

      <div className="relative min-h-0 flex-1 overflow-auto">
        <table className="min-w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              {["#", "Student", ...comps.map((c) => `${c.name} /${c.weight}`), "Total", "Grade", "Pos."].map((h, i) => (
                <th
                  key={h}
                  scope="col"
                  className={cn(
                    "sticky top-0 h-11 border-r border-b border-r-border border-b-[#D5D2C8] bg-secondary px-3 text-xs font-bold whitespace-nowrap text-ink-2",
                    i === 0 && "left-0 z-30 w-14 text-left",
                    i === 1 && "left-14 z-30 min-w-[200px] text-left",
                    i > 1 && "z-20 min-w-[90px] text-right",
                    h === "Grade" && "text-center",
                  )}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {p.students.map((s, r) => {
              const tot = totals[r];
              return (
                <tr key={s.id}>
                  <td className="sticky left-0 h-11 border-r border-b border-r-border border-b-divider bg-card px-3 font-mono text-xs text-muted-foreground">{String(r + 1).padStart(2, "0")}</td>
                  <th scope="row" className="sticky left-14 border-r border-b border-r-[#D5D2C8] border-b-divider bg-card px-3 text-left font-semibold whitespace-nowrap">
                    {s.name}
                  </th>
                  {comps.map((c, ci) => {
                    const k = `${s.id}:${c.id}`;
                    const v = text[k] ?? "";
                    const issue = cellIssue(v, c.weight);
                    return (
                      <td key={c.id} className={cn("border-r border-b border-r-divider border-b-divider p-0", issue && issue !== "missing" ? "bg-[#FBEAE9]" : issue === "missing" ? "bg-[#FDF1E6]" : "bg-card")}>
                        <input
                          id={`cell-${r}-${ci}`}
                          value={v}
                          readOnly={!p.canEdit}
                          inputMode="decimal"
                          aria-label={`${s.name} ${c.name}`}
                          aria-invalid={!!issue && issue !== "missing"}
                          title={issue === "too_high" ? `More than ${c.weight}` : issue === "not_a_number" ? "Not a number" : s.sources[c.id] === "attempt" ? "From the CBT exam" : undefined}
                          onFocus={(e) => {
                            focus.current = { r, c: ci };
                            e.currentTarget.select();
                          }}
                          onChange={(e) => setText((t) => ({ ...t, [k]: e.target.value }))}
                          onKeyDown={(e) => onKey(e, r, ci)}
                          onPaste={(e) => {
                            const raw = e.clipboardData.getData("text");
                            if (/[\t\n]/.test(raw.trim())) {
                              e.preventDefault();
                              applyPaste(raw);
                            }
                          }}
                          className={cn("h-[43px] w-full border-none bg-transparent px-3 text-right font-mono text-sm outline-none focus:outline-2 focus:-outline-offset-2 focus:outline-ring", issue === "too_high" || issue === "not_a_number" ? "text-[#A1271F]" : "")}
                        />
                      </td>
                    );
                  })}
                  <td className="border-r border-b border-r-divider border-b-divider bg-background px-3 text-right font-mono font-bold">{tot ?? "—"}</td>
                  <td className="border-r border-b border-r-divider border-b-divider bg-background px-3 text-center font-mono font-bold">{tot === null ? "—" : grade(tot)}</td>
                  <td className="border-b border-b-divider bg-background px-3 text-right font-mono">{tot === null ? "—" : ord(position(tot))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-6 border-t border-border bg-card px-4 py-3 text-[13px] lg:px-8">
        <span>
          Class average <b className="font-mono">{present.length ? (present.reduce((a, b) => a + b, 0) / present.length).toFixed(1) : "—"}</b>
        </span>
        <span>
          Highest <b className="font-mono">{present.length ? Math.max(...present) : "—"}</b>
        </span>
        <span>
          Lowest <b className="font-mono">{present.length ? Math.min(...present) : "—"}</b>
        </span>
        <span className="flex items-center gap-1.5 font-semibold text-[#8A430B]">
          <span className="size-2.5 rounded-[2px] border-[1.5px] border-warning bg-[#FDF1E6]" />
          {issues ? `${issues} ${issues === 1 ? "cell needs" : "cells need"} a look` : "No problems"}
        </span>
      </div>

      {paste && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(20,33,61,.5)] p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="paste-title" className="w-full max-w-lg rounded-2xl bg-card p-6">
            <h2 id="paste-title" className="text-lg font-extrabold">
              Paste from Excel
            </h2>
            <p className="mt-1 text-sm text-ink-2">
              Copy the score cells in Excel (no names, no headers), click the cell where they should start (now: {p.students[paste.r]?.name}, {comps[paste.c]?.name}), then paste here. You can also paste straight into a cell.
            </p>
            <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={8} autoFocus className="mt-3 w-full rounded-md border-[1.5px] border-input p-2 font-mono text-sm" placeholder={"8\t7\t9\n6\t9\t10"} />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setPaste(null)} className="h-11 rounded-md border-[1.5px] border-input px-4 font-semibold">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  applyPaste(pasteText, paste);
                  setPaste(null);
                  setPasteText("");
                }}
                className="h-11 rounded-md bg-ink px-4 font-bold text-white"
              >
                Fill the grid
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
