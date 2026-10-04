"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { saveScheduleAction } from "@/lib/exams/builder-actions";

type Room = { classArmId: string; name: string; students: number; venue: string; invigilatorId: string };

export function ScheduleStep({
  slug,
  examId,
  initial,
  rooms: initialRooms,
  teachers,
  durationMinutes,
  pinRequired,
  locked,
}: {
  slug: string;
  examId: string;
  initial: { date: string; opens: string; lateUntil: string; venue: string };
  rooms: Room[];
  teachers: { id: string; name: string }[];
  durationMinutes: number;
  pinRequired: boolean;
  locked: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [rooms, setRooms] = useState(initialRooms);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Everyone who starts before late entry closes gets the full time.
  const closes = (() => {
    const [h, m] = (v.lateUntil || v.opens).split(":").map(Number);
    if (Number.isNaN(h)) return "—";
    const t = h * 60 + m + durationMinutes;
    return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
  })();

  const save = () =>
    start(async () => {
      const r = await saveScheduleAction(slug, examId, {
        ...v,
        venue: v.venue || null,
        rooms: rooms.map((x) => ({ classArmId: x.classArmId, venue: x.venue || null, invigilatorId: x.invigilatorId || null })),
      });
      setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: "Saved" });
      router.refresh();
    });

  return (
    <div className="flex max-w-[760px] flex-col gap-4">
      <fieldset disabled={locked} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Date">
          <Input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} mono required />
        </Field>
        <Field label="Opens">
          <Input type="time" value={v.opens} onChange={(e) => setV({ ...v, opens: e.target.value })} mono required />
        </Field>
        <Field label="Late entry until" hint={`Closes ${closes}`}>
          <Input type="time" value={v.lateUntil} onChange={(e) => setV({ ...v, lateUntil: e.target.value })} mono />
        </Field>
        <Field label="Venue (default)" className="sm:col-span-3">
          <Input value={v.venue} onChange={(e) => setV({ ...v, venue: e.target.value })} placeholder="e.g. ICT Lab 1" maxLength={80} />
        </Field>
      </fieldset>

      <div className="rounded-xl border border-border bg-card">
        <div className="grid grid-cols-[1fr_1fr_1fr] gap-3 border-b border-divider px-5 py-2.5 text-xs font-bold tracking-[.06em] text-muted-foreground uppercase">
          <span>Class</span>
          <span>Room</span>
          <span>Invigilator</span>
        </div>
        {rooms.map((r, i) => (
          <div key={r.classArmId} className="grid grid-cols-[1fr_1fr_1fr] items-center gap-3 border-b border-divider px-5 py-2.5 text-sm last:border-b-0">
            <b>
              {r.name} · {r.students}
            </b>
            <input
              value={r.venue}
              disabled={locked}
              onChange={(e) => setRooms(rooms.map((x, j) => (j === i ? { ...x, venue: e.target.value } : x)))}
              placeholder={v.venue || "Room"}
              aria-label={`Room for ${r.name}`}
              maxLength={80}
              className="h-10 rounded-md border border-input bg-card px-2.5"
            />
            <select
              value={r.invigilatorId}
              disabled={locked}
              onChange={(e) => setRooms(rooms.map((x, j) => (j === i ? { ...x, invigilatorId: e.target.value } : x)))}
              aria-label={`Invigilator for ${r.name}`}
              className="h-10 rounded-md border border-input bg-card px-2"
            >
              <option value="">Not set</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <p className="rounded-[10px] border border-[#C7D9EE] bg-[#EAF1F9] px-[18px] py-3.5 text-sm text-[#1D4B80]">
        {pinRequired ? `PINs are generated when you publish. ` : ""}Students can&apos;t start before {v.opens || "the opening time"}
        {pinRequired ? " even with a PIN" : ""}, or after {v.lateUntil || closes}. Each student&apos;s time runs from when they start.
      </p>

      {!locked && (
        <div className="flex items-center gap-3">
          <Button type="button" onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save schedule"}
          </Button>
          {msg && (
            <span role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm font-semibold text-success" : "text-sm font-semibold text-destructive"}>
              {msg.text}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
