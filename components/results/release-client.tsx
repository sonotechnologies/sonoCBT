"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { moveBatchesAction } from "@/lib/results/pipeline-actions";
import { cn } from "@/lib/utils";

type Row = { classArmId: string; name: string; students: number; subjectsReady: number; subjectsTotal: number; status: "draft" | "under_review" | "approved" | "released"; lastBy: string | null; lastAt: string | null };

const M = {
  draft: { label: "Draft", chip: "bg-chip text-ink-2", dot: "border-[#8C93A3] bg-transparent", desc: "Teachers entering scores" },
  under_review: { label: "In review", chip: "bg-[#EAF1F9] text-[#1D4B80]", dot: "border-info bg-transparent", desc: "Waiting for your check" },
  approved: { label: "Approved", chip: "bg-[#E8F4EC] text-[#155E34]", dot: "border-success bg-transparent", desc: "Ready to send" },
  released: { label: "Released", chip: "bg-[#E8F4EC] text-[#155E34]", dot: "border-success bg-success", desc: "Parents can see" },
} as const;

const when = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso)).replace(",", " ·") : "—");

export function ReleaseClient({ slug, termId, rows, canReview, canRelease, logArm }: { slug: string; termId: string; rows: Row[]; canReview: boolean; canRelease: boolean; logArm: string | null }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const chosen = rows.filter((r) => r.status === "approved" && sel.has(r.classArmId));
  const counts = { draft: 0, under_review: 0, approved: 0, released: 0 };
  for (const r of rows) counts[r.status]++;

  const act = (armIds: string[], action: "approve" | "send_back" | "release" | "unrelease", reason?: string, done?: string) =>
    start(async () => {
      const r = await moveBatchesAction(slug, termId, armIds, action, reason);
      if (r.error) setError(r.error);
      else {
        setError(null);
        if (done) setToast(done);
        setSel(new Set());
        setTimeout(() => setToast(null), 5000);
      }
    });

  return (
    <>
      <div className="grid grid-cols-2 overflow-hidden rounded-xl sm:grid-cols-[repeat(auto-fit,minmax(180px,1fr))] border border-border bg-card">
        {(Object.keys(M) as (keyof typeof M)[]).map((k, i) => (
          <div key={k} className={cn("border-r border-b border-divider px-4 py-3.5 sm:border-b-0 sm:px-5 sm:py-[18px]", k === "approved" && "bg-[#FFFDF3] shadow-[inset_0_-3px_0_#F2B705]")}>
            <div className="flex items-center gap-2.5">
              <span className={cn("flex size-[26px] items-center justify-center rounded-full border-2 border-ink font-mono text-xs font-bold", counts[k] ? "bg-ink text-white" : "bg-card")}>{i + 1}</span>
              <span className="text-[15px] font-extrabold">{M[k].label}</span>
            </div>
            <div className="mt-1.5 text-[13px] text-ink-2">
              {counts[k]} {counts[k] === 1 ? "class" : "classes"} · {M[k].desc}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-[#FBEAE9] px-4 py-3 text-sm font-semibold text-[#8E2019]">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <div className="hidden h-11 min-w-[720px] sm:grid grid-cols-[32px_100px_minmax(140px,1fr)_150px_120px_200px] items-center gap-3 rounded-t-xl bg-secondary px-5 text-xs font-bold text-ink-2">
          <span />
          <span>Class</span>
          <span>Subjects ready</span>
          <span>Last change</span>
          <span>Status</span>
          <span className="text-right">Action</span>
        </div>
        {rows.map((r) => {
          const m = M[r.status];
          const selectable = r.status === "approved" && canRelease;
          const on = sel.has(r.classArmId);
          return (
            <div key={r.classArmId} className="grid grid-cols-[36px_1fr_auto] items-center gap-x-3 gap-y-2 border-t border-divider px-4 py-3 text-sm first-of-type:border-t-0 sm:min-h-[60px] sm:min-w-[720px] sm:grid-cols-[32px_100px_minmax(140px,1fr)_150px_120px_200px] sm:px-5 sm:py-0 sm:first-of-type:border-t">
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                aria-label={`Select ${r.name}`}
                disabled={!selectable}
                onClick={() => setSel((s) => {
                  const n = new Set(s);
                  if (n.has(r.classArmId)) n.delete(r.classArmId);
                  else n.add(r.classArmId);
                  return n;
                })}
                className={cn("flex size-7 items-center justify-center rounded-md border-2 p-0 sm:size-[22px] text-[13px] font-extrabold text-white", on ? "border-ink bg-ink" : selectable ? "border-ink bg-card" : "border-input bg-card opacity-40")}
              >
                {on ? "✓" : ""}
              </button>
              <Link href={`/s/${slug}/results/classes/${r.classArmId}?term=${termId}&view=bs`} className="font-extrabold">
                {r.name}
              </Link>
              <span className="col-start-2 col-end-4 row-start-2 flex items-center gap-2.5 sm:col-auto sm:row-auto">
                <span className="h-2 max-w-[220px] flex-1 overflow-hidden rounded bg-chip">
                  <span className="block h-full bg-ink" style={{ width: `${r.subjectsTotal ? (r.subjectsReady / r.subjectsTotal) * 100 : 0}%` }} />
                </span>
                <span className="font-mono text-[13px]">
                  {r.subjectsReady} of {r.subjectsTotal}
                </span>
              </span>
              <span className={cn("col-start-2 col-end-4 text-xs leading-snug text-ink-2 sm:col-auto", !r.lastBy && !r.lastAt && "max-sm:hidden")}>
                {r.lastBy ?? "—"}
                <br className="hidden sm:block" />
                <span className="sm:hidden"> · </span>
                <span className="font-mono">{when(r.lastAt)}</span>
              </span>
              <span className="col-start-3 row-start-1 sm:col-auto sm:row-auto">
                <span className={cn("inline-flex h-[26px] items-center gap-1.5 rounded-full px-2.5 text-xs font-bold", m.chip)}>
                  <span className={cn("size-[7px] rounded-full border-[1.5px]", m.dot)} />
                  {m.label}
                </span>
              </span>
              <span className="col-start-2 col-end-4 flex flex-wrap gap-1.5 sm:col-auto sm:justify-end">
                {r.status === "under_review" && canReview && (
                  <>
                    <button type="button" disabled={pending} onClick={() => act([r.classArmId], "approve", undefined, `${r.name} approved.`)} className="h-[38px] rounded-md bg-ink px-3.5 text-[13px] font-bold text-white">
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        const why = window.prompt(`Why send ${r.name} back to the teachers?`)?.trim();
                        if (why) act([r.classArmId], "send_back", why, `${r.name} sent back.`);
                      }}
                      className="h-[38px] rounded-md border-[1.5px] border-input bg-card px-3 text-[13px] font-semibold"
                    >
                      Send back
                    </button>
                  </>
                )}
                {r.status === "released" && canRelease && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      const why = window.prompt(`Un-release ${r.name}? Parents and students will stop seeing it. Reason:`)?.trim();
                      if (why) act([r.classArmId], "unrelease", why, `${r.name} un-released.`);
                    }}
                    className="h-[38px] rounded-md border-[1.5px] border-input bg-card px-3 text-[13px] font-semibold"
                  >
                    Un-release
                  </button>
                )}
                <Link href={`?log=${r.classArmId}`} className="h-[38px] rounded-md border-[1.5px] border-input bg-card px-3 text-[13px] leading-[35px] font-semibold text-foreground no-underline">
                  Log
                </Link>
              </span>
            </div>
          );
        })}
      </div>

      {canRelease && (
        <div className="flex flex-wrap items-center gap-4 rounded-xl bg-ink px-5 py-4 text-white">
          <span className="flex-1 text-[15px]">
            <b className="font-mono">{chosen.length}</b> approved {chosen.length === 1 ? "class" : "classes"} selected
          </span>
          <button type="button" disabled={!chosen.length || pending} onClick={() => setConfirm(true)} className="h-[46px] rounded-md bg-pencil px-5 text-[15px] font-extrabold text-ink disabled:opacity-50">
            Release to parents
          </button>
        </div>
      )}
      {logArm === null && <p className="text-[13px] text-muted-foreground">Choose Log on a class to see who changed what.</p>}

      {confirm && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-[rgba(20,33,61,.5)] p-3 sm:items-center sm:p-6">
          <div role="dialog" aria-modal="true" aria-labelledby="rel-title" className="w-full max-w-[540px] rounded-2xl bg-card p-5 shadow-[0_24px_60px_rgba(20,33,61,.25)] sm:p-8">
            <h2 id="rel-title" className="text-[22px] font-extrabold">
              Release {chosen.map((r) => r.name).join(" and ")}?
            </h2>
            <p className="mt-2.5 mb-[18px] text-[15px] leading-relaxed text-ink-2">
              <b>{chosen.reduce((a, r) => a + r.students, 0)}</b> students&apos; results become visible to them, and to parents at /results with their result PIN.
            </p>
            <div className="rounded-[10px] border border-[#F3D3B5] bg-[#FDF1E6] px-4 py-3.5 text-sm leading-normal text-[#7A3B0A]">After release, changing a score needs a reason and is shown in the change log.</div>
            <div className="mt-6 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setConfirm(false)} className="h-12 rounded-md border-[1.5px] border-input bg-card px-[18px] text-[15px] font-semibold">
                Not yet
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirm(false);
                  act(chosen.map((r) => r.classArmId), "release", undefined, `${chosen.map((r) => r.name).join(" and ")} released. Parents can check now.`);
                }}
                className="h-12 rounded-md bg-ink px-5 text-[15px] font-bold text-white"
              >
                Release now
              </button>
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div role="status" className="fixed inset-x-4 bottom-4 z-50 flex sm:inset-x-auto sm:right-8 sm:bottom-8 items-center gap-2.5 rounded-[10px] bg-ink px-[18px] py-3.5 text-sm text-white shadow-[0_8px_24px_rgba(20,33,61,.25)]">
          <span className="flex size-[22px] items-center justify-center rounded-full bg-success">✓</span>
          {toast}
        </div>
      )}
    </>
  );
}
