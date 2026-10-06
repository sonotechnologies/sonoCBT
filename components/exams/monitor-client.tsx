"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import type { MonitorStatus } from "@/lib/exams/integrity";
import { acceptLateAnswersAction, addTimeAction, addTimeForEveryoneAction, forceSubmitAction, resetSessionAction, restartAttemptAction } from "@/lib/exams/monitor-actions";
import type { MonitorStudent, TimelineEvent } from "@/lib/exams/monitor";
import { cn } from "@/lib/utils";

type Data = {
  exam: { id: string; title: string; fullTitle: string | null; phase: string; windowStart: number; windowEnd: number; lateEntryUntil: number | null; durationMinutes: number; rooms: string[]; classes: string[] };
  students: MonitorStudent[];
  counts: Record<MonitorStatus, number>;
  scoped: boolean;
  serverNow: number;
};

const POLL_MS = 10_000;

// Shape and colour together, so status never relies on colour alone.
const KIND: Record<MonitorStatus, { label: string; fill: string; stroke: string; radius: string }> = {
  progress: { label: "In progress", fill: "#14213D", stroke: "#14213D", radius: "50%" },
  notstarted: { label: "Not started", fill: "#FFFFFF", stroke: "#9AA1B0", radius: "50%" },
  submitted: { label: "Submitted", fill: "#1F8A4C", stroke: "#1F8A4C", radius: "3px" },
  offline: { label: "Offline", fill: "#FFFFFF", stroke: "#2F6FB5", radius: "2px" },
  flagged: { label: "Flagged", fill: "#D9731A", stroke: "#D9731A", radius: "1px" },
};
const TONE: Record<string, { dot: string; fg: string; radius: string }> = {
  ok: { dot: "#1F8A4C", fg: "#14213D", radius: "50%" },
  warn: { dot: "#D9731A", fg: "#8A430B", radius: "1px" },
  info: { dot: "#2F6FB5", fg: "#14213D", radius: "50%" },
  base: { dot: "#9AA1B0", fg: "#14213D", radius: "50%" },
};

const hms = (ms: number) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(ms);
const hm = (ms: number) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
const clock = (s: number) => {
  const v = Math.max(0, Math.floor(s));
  const p = (n: number) => String(n).padStart(2, "0");
  return v >= 3600 ? `${Math.floor(v / 3600)}:${p(Math.floor((v % 3600) / 60))}:${p(v % 60)}` : `${p(Math.floor(v / 60))}:${p(v % 60)}`;
};

function Shape({ k, size = 10 }: { k: MonitorStatus; size?: number }) {
  const s = KIND[k];
  return <span aria-hidden className="flex-none" style={{ width: size, height: size, borderRadius: s.radius, background: s.fill, border: `2px solid ${s.stroke}` }} />;
}

function statusLine(s: MonitorStudent) {
  if (s.status === "progress" || s.status === "flagged") return `Q${s.currentIndex + 1} of ${s.total}`;
  if (s.status === "offline") return "Offline · saving locally";
  if (s.status === "submitted") return s.submitReason === "integrity" ? "Auto-submitted · tab switches" : s.submitReason === "staff" ? "Submitted by staff" : s.submitReason === "timeout" ? "Time ran out" : "Submitted";
  return "Not started";
}

export function MonitorClient({ slug, initial }: { slug: string; initial: Data }) {
  const [data, setData] = useState(initial);
  const [offset] = useState(() => initial.serverNow - Date.now());
  const [now, setNow] = useState(initial.serverNow);
  const [filter, setFilter] = useState<MonitorStatus | null>(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(initial.students.find((s) => s.status === "flagged")?.studentId ?? initial.students[0]?.studentId ?? null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState<null | "force" | "restart">(null);
  const [reason, setReason] = useState("");
  const [stale, setStale] = useState(false);
  const [pending, start] = useTransition();
  const base = `/s/${slug}/exams/${initial.exam.id}/monitor`;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${base}/data`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      setData(await res.json());
      setStale(false);
    } catch {
      setStale(true);
    }
  }, [base]);

  useEffect(() => {
    const poll = setInterval(() => void refresh(), POLL_MS);
    const tick = setInterval(() => setNow(Date.now() + offset), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [refresh, offset]);

  const cur = data.students.find((s) => s.studentId === sel) ?? null;
  // Phones and tablets show the selected student as a full-screen sheet, opened by a tap.
  const [sheet, setSheet] = useState(false);
  const curKey = cur ? `${cur.studentId}:${cur.flags}:${cur.status}:${cur.extraMinutes}:${cur.lateCount}` : "";
  useEffect(() => {
    if (!sel) return;
    let live = true;
    void fetch(`${base}/student/${sel}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((t: TimelineEvent[]) => live && setTimeline(t));
    return () => {
      live = false;
    };
  }, [base, sel, curKey]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return data.students.filter((s) => (!filter || s.status === filter) && (!term || s.name.toLowerCase().includes(term) || s.admissionNo.toLowerCase().includes(term)));
  }, [data.students, filter, q]);

  const act = (fn: () => Promise<{ error?: string; note?: string }>) =>
    start(async () => {
      const r = await fn();
      setNote(r.error ? { ok: false, text: r.error } : { ok: true, text: r.note ?? "Done" });
      setConfirm(null);
      setReason("");
      await refresh();
    });

  const e = data.exam;
  const live = e.phase === "live";
  const leftS = (e.windowEnd - now) / 1000;
  const where = [e.rooms.join(" & ") || null, `opens ${hm(e.windowStart)}`, `closes ${hm(e.windowEnd)}`, `${data.students.length} students`].filter(Boolean).join(" · ");

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex flex-none flex-wrap items-center gap-x-4 gap-y-3 border-b border-border bg-card px-4 py-4 lg:px-7 lg:py-[18px]">
        {live ? (
          <span className="flex h-[26px] items-center gap-1.5 rounded-full bg-pencil px-2.5 text-xs font-extrabold text-ink">
            <span className="size-[7px] rounded-full bg-ink" />
            LIVE
          </span>
        ) : (
          <span className="flex h-[26px] items-center rounded-full bg-chip px-2.5 text-xs font-bold uppercase">{e.phase === "closed" ? "Closed" : "Not open yet"}</span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-extrabold">{e.title}</h1>
          <div className="text-[13px] text-muted-foreground">{where}</div>
        </div>
        {stale && <span className="text-xs font-semibold text-warning">Can&apos;t reach the server. Retrying…</span>}
        <div className="flex flex-col items-end">
          <span className="text-[11px] font-bold tracking-[.06em] text-muted-foreground uppercase">{live ? "Until it closes" : e.phase === "closed" ? "Closed" : "Opens in"}</span>
          <span className="font-mono text-2xl font-semibold tabular-nums" suppressHydrationWarning>
            {live ? clock(leftS) : e.phase === "closed" ? "—" : clock((e.windowStart - now) / 1000)}
          </span>
        </div>
        {!data.scoped && live && (
          <button
            type="button"
            disabled={pending}
            onClick={() => window.confirm("Add 5 minutes for everyone still writing? The exam will also close 5 minutes later.") && act(() => addTimeForEveryoneAction(slug, e.id, 5))}
            className="h-11 rounded-md border-[1.5px] border-input bg-card px-4 text-sm font-semibold"
          >
            Add time for everyone
          </button>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
        <main className="flex min-w-0 flex-1 flex-col gap-[18px] overflow-auto px-4 pt-5 pb-8 lg:px-7">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(130px,1fr))] sm:gap-2.5">
            {(["progress", "notstarted", "submitted", "offline", "flagged"] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={filter === k}
                onClick={() => setFilter(filter === k ? null : k)}
                className={cn("min-w-0 rounded-[10px] bg-card px-2.5 py-2.5 text-left sm:px-3.5 sm:py-3", filter === k ? "border-2 border-ink" : "border border-border")}
              >
                <div className="flex items-center gap-1.5 truncate text-xs text-ink-2 sm:gap-2 sm:text-[13px]">
                  <Shape k={k} />
                  {KIND[k].label}
                </div>
                <div className="mt-0.5 font-mono text-[22px] font-semibold sm:mt-1 sm:text-[26px]">{data.counts[k]}</div>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={q}
              onChange={(ev) => setQ(ev.target.value)}
              placeholder="Search name or admission no."
              aria-label="Search students"
              className="h-11 w-full rounded-md border-[1.5px] border-input bg-card px-3 text-sm sm:h-10 sm:w-[280px]"
            />
            <span className="text-[13px] text-muted-foreground">
              Showing <strong className="text-foreground">{filter ? KIND[filter].label.toLowerCase() : "everyone"}</strong> · {shown.length} students
            </span>
            {filter && (
              <button type="button" onClick={() => setFilter(null)} className="h-8 px-2.5 text-[13px] font-semibold underline">
                Show all
              </button>
            )}
          </div>
          <ul className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] sm:gap-2.5" aria-label="Students">
            {shown.map((s) => {
              const k = KIND[s.status];
              const isSel = s.studentId === sel;
              return (
                <li key={s.studentId}>
                  <button
                    type="button"
                    onClick={() => {
                      setSel(s.studentId);
                      setSheet(true);
                      setNote(null);
                      setConfirm(null);
                    }}
                    aria-label={`${s.name}, ${statusLine(s)}${s.flags ? `, ${s.flags} flags` : ""}`}
                    aria-pressed={isSel}
                    className={cn(
                      "flex w-full flex-col gap-2 rounded-[10px] p-3 text-left",
                      isSel ? "border-2 border-ink bg-[#FFF8E1]" : s.flags ? "border-[1.5px] border-warning bg-card" : "border border-border bg-card",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <Shape k={s.status} size={12} />
                      <span className="min-w-0 flex-1 truncate text-sm font-bold">{s.name}</span>
                      {s.flags > 0 && <span className="rounded bg-warning px-1.5 py-px text-[11px] font-extrabold text-white">⚑ {s.flags}</span>}
                    </span>
                    <span className="flex justify-between text-xs text-ink-2">
                      <span>{statusLine(s)}</span>
                      <span className="font-mono">{s.seat}</span>
                    </span>
                    <span className="h-[5px] overflow-hidden rounded-[3px] bg-chip">
                      <span className="block h-full" style={{ width: `${Math.round((s.answered / Math.max(1, s.total)) * 100)}%`, background: k.stroke }} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {!shown.length && <p className="py-10 text-center text-sm text-muted-foreground">No students match.</p>}
        </main>

        {cur && (
          <aside aria-label={`${cur.name}`} className={cn("w-full flex-none flex-col bg-card xl:static xl:z-auto xl:flex xl:w-[360px] xl:overflow-auto xl:border-l xl:border-border", sheet ? "fixed inset-0 z-40 flex overflow-auto" : "hidden")}>
            <button type="button" onClick={() => setSheet(false)} className="flex h-12 flex-none items-center gap-1.5 border-b border-divider px-4 text-left text-sm font-semibold text-ink-2 xl:hidden">
              ← Back to all students
            </button>
            <div className="flex items-center gap-3.5 border-b border-divider px-[22px] py-5">
              {cur.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={cur.photoUrl} alt="" className="size-[52px] flex-none rounded-full border border-border object-cover" />
              ) : (
                <span className="hatch size-[52px] flex-none rounded-full border border-border" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-[17px] font-extrabold">{cur.name}</div>
                <div className="font-mono text-xs text-muted-foreground">
                  {cur.className} · {cur.admissionNo}
                  {cur.seat ? ` · Seat ${cur.seat}` : ""}
                </div>
              </div>
            </div>
            <dl className="grid grid-cols-3 gap-2.5 border-b border-divider px-[22px] py-4">
              <div>
                <dt className="text-[11px] text-muted-foreground">Status</dt>
                <dd className="mt-0.5 text-sm font-bold">{KIND[cur.status].label}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted-foreground">Answered</dt>
                <dd className="mt-0.5 font-mono text-[15px] font-semibold">
                  {cur.answered}/{cur.total}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted-foreground">Extra time</dt>
                <dd className="mt-0.5 font-mono text-[15px] font-semibold">+{cur.extraMinutes} min</dd>
              </div>
            </dl>
            <div className="flex-1 px-[22px] py-4">
              <div className="mb-3 text-xs font-bold tracking-[.06em] text-muted-foreground uppercase">Timeline</div>
              {timeline.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">{cur.status === "notstarted" ? "Hasn't started." : "Loading…"}</p>
              ) : (
                <ol className="flex flex-col">
                  {timeline.map((ev) => (
                    <li key={ev.id} className="grid grid-cols-[64px_14px_minmax(0,1fr)] gap-2.5 pb-3.5">
                      <span className="pt-px font-mono text-xs text-muted-foreground">{hms(ev.at)}</span>
                      <span aria-hidden className="mt-1 size-2.5" style={{ background: TONE[ev.tone].dot, borderRadius: TONE[ev.tone].radius }} />
                      <span className="text-[13px] leading-[1.45]">
                        <strong className="font-bold" style={{ color: TONE[ev.tone].fg }}>
                          {ev.title}
                        </strong>{" "}
                        <span className="text-ink-2">{ev.detail}</span>
                        {ev.snapshot && (
                          <a href={`${base}/snapshot/${ev.id}`} target="_blank" rel="noreferrer" className="ml-1 text-xs font-semibold">
                            View photo
                          </a>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <div className="flex flex-col gap-2.5 border-t border-divider px-[22px] pt-4 pb-[22px]">
              {note && (
                <div role={note.ok ? "status" : "alert"} className={cn("rounded-md px-3 py-2.5 text-[13px] font-semibold", note.ok ? "bg-[#E8F4EC] text-[#155E34]" : "bg-[#FBEAE9] text-[#8E2019]")}>
                  {note.text}
                </div>
              )}
              {cur.lateCount > 0 && (
                <button type="button" disabled={pending} onClick={() => act(() => acceptLateAnswersAction(slug, e.id, cur.studentId, cur.name))} className="h-11 rounded-md border-[1.5px] border-info bg-card text-sm font-bold text-[#1D4B80]">
                  Count {cur.lateCount} late {cur.lateCount === 1 ? "answer" : "answers"}
                </button>
              )}
              {cur.status !== "notstarted" && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={pending || (cur.status === "submitted" && cur.submitReason !== "timeout")}
                    onClick={() => act(() => addTimeAction(slug, e.id, cur.studentId, cur.name, 5))}
                    className="h-11 rounded-md bg-ink text-sm font-bold text-white disabled:opacity-40"
                  >
                    {cur.status === "submitted" ? "Reopen + 5 min" : "Add 5 minutes"}
                  </button>
                  <button
                    type="button"
                    disabled={pending || cur.status === "submitted"}
                    onClick={() => act(() => resetSessionAction(slug, e.id, cur.studentId, cur.name))}
                    className="h-11 rounded-md border-[1.5px] border-input bg-card text-sm font-semibold disabled:opacity-40"
                  >
                    Reset session
                  </button>
                </div>
              )}
              {confirm && (
                <div className="flex flex-col gap-2.5 rounded-md border-[1.5px] border-destructive bg-[#FDF6F5] p-3">
                  <div className="text-[13px] text-[#8E2019]">
                    {confirm === "force" ? (
                      <>
                        <strong>Submit {cur.name.split(" ")[0]}&apos;s exam now?</strong> Their {cur.answered} saved answers will be marked. This can&apos;t be undone.
                      </>
                    ) : (
                      <>
                        <strong>Start {cur.name.split(" ")[0]}&apos;s exam again?</strong> Everything they answered is thrown away and they start from question 1 with the full time.
                      </>
                    )}
                  </div>
                  <input
                    value={reason}
                    onChange={(ev) => setReason(ev.target.value)}
                    placeholder={confirm === "force" ? "Reason (optional)" : "Reason (required, kept in the log)"}
                    aria-label="Reason"
                    maxLength={200}
                    className="h-10 rounded-md border border-input bg-card px-2.5 text-sm"
                  />
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setConfirm(null)} className="h-10 flex-1 rounded-md border-[1.5px] border-input bg-card font-semibold">
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={pending || (confirm === "restart" && reason.trim().length < 3)}
                      onClick={() =>
                        act(() => (confirm === "force" ? forceSubmitAction(slug, e.id, cur.studentId, cur.name, reason) : restartAttemptAction(slug, e.id, cur.studentId, cur.name, reason)))
                      }
                      className="h-10 flex-1 rounded-md bg-destructive font-bold text-white disabled:opacity-50"
                    >
                      {confirm === "force" ? "Force submit" : "Start again"}
                    </button>
                  </div>
                </div>
              )}
              {!confirm && cur.status !== "notstarted" && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={cur.status === "submitted"}
                    onClick={() => setConfirm("force")}
                    className="h-11 rounded-md border-[1.5px] border-destructive bg-card text-sm font-bold text-[#A1271F] disabled:opacity-40"
                  >
                    Force submit…
                  </button>
                  <button type="button" onClick={() => setConfirm("restart")} className="h-11 rounded-md border-[1.5px] border-input bg-card text-sm font-semibold">
                    Start again…
                  </button>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
