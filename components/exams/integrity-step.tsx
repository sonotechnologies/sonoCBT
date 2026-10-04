"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { IntegritySettings } from "@/lib/db/schema";
import type { SettingsInput } from "@/lib/exams/builder";
import { saveSettingsAction } from "@/lib/exams/builder-actions";
import { cn } from "@/lib/utils";

const PRESET_CARDS = [
  { id: "practice", t: "Practice", d: "No restrictions. Leaving the exam is logged but nothing is blocked.", for: "Classwork, revision, homework" },
  { id: "standard", t: "Standard", d: "Full screen, copy blocked, one device. Leaving is logged and the student is warned.", for: "CA tests, mid-terms" },
  { id: "strict", t: "Strict", d: "Everything in Standard, plus full screen required and automatic submission after 3 tab switches.", for: "Mocks, terminal exams" },
] as const;

type Rule = { key: keyof IntegritySettings | "calculator" | "pinRequired"; t: string; d: string };
const RULES: Rule[] = [
  { key: "fullscreen", t: "Full screen", d: "Ask for, or require, full screen. Leaving it is recorded." },
  { key: "logTabSwitches", t: "Log tab switches", d: "Shown to the exam officer on the live monitor." },
  { key: "warnOnLeave", t: "Warn when a student leaves", d: "A clear message each time they switch away." },
  { key: "blockCopy", t: "Block copy and paste", d: "Also stops selecting question text." },
  { key: "oneDevice", t: "One device per student", d: "Signing in elsewhere ends the first session." },
  { key: "submitAfterLeaves", t: "Submit after 3 tab switches", d: "The exam is submitted for them. The monitor shows why." },
  { key: "snapshot", t: "Webcam snapshot at start", d: "For identity only, with consent. Stored 30 days." },
  { key: "pinRequired", t: "Exam PIN from a printed slip", d: "Generated when you publish. Stops a student starting from home." },
];

export function IntegrityStep({
  slug,
  examId,
  settings,
  presets,
  locked,
  snapshotsAvailable,
  snapshotsNote = null,
}: {
  slug: string;
  examId: string;
  settings: SettingsInput;
  presets: Record<string, IntegritySettings>;
  locked: boolean;
  snapshotsAvailable: boolean;
  /** Why identity photos are off for this school (its plan), if they are. */
  snapshotsNote?: string | null;
}) {
  const router = useRouter();
  const [s, setS] = useState(settings);
  const [nets, setNets] = useState((settings.integritySettings.allowedIps ?? []).join("\n"));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = JSON.stringify(s) !== JSON.stringify(settings);

  const on = (k: Rule["key"]) =>
    k === "pinRequired" ? s.pinRequired : k === "calculator" ? s.calculator !== "off" : k === "fullscreen" ? s.integritySettings.fullscreen !== "off" : k === "submitAfterLeaves" ? s.integritySettings.submitAfterLeaves !== null : !!s.integritySettings[k];
  const flip = (k: Rule["key"]) =>
    setS((x) => {
      if (k === "pinRequired") return { ...x, pinRequired: !x.pinRequired };
      const i = { ...x.integritySettings };
      if (k === "fullscreen") i.fullscreen = i.fullscreen === "off" ? "prompt" : "off";
      else if (k === "submitAfterLeaves") i.submitAfterLeaves = i.submitAfterLeaves === null ? 3 : null;
      else if (k !== "calculator") (i[k] as boolean) = !i[k];
      return { ...x, integritySettings: i };
    });

  return (
    <div className="max-w-[1080px]">
      <h2 className="text-xl font-extrabold">How strict should this exam be?</h2>
      <p className="mt-1.5 mb-5 text-[15px] text-ink-2">Pick a preset. You can fine-tune any rule below it.</p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {PRESET_CARDS.map((p) => {
          const active = s.integrity === p.id;
          return (
            <button
              key={p.id}
              type="button"
              disabled={locked}
              aria-pressed={active}
              onClick={() => setS((x) => ({ ...x, integrity: p.id, integritySettings: { ...presets[p.id] } }))}
              className={cn("flex flex-col gap-2.5 rounded-xl p-[22px] text-left", active ? "border-2 border-ink bg-[#FFF8E1]" : "border-[1.5px] border-[#D5D8DF] bg-card")}
            >
              <span className="flex items-center gap-2.5">
                <span className={cn("size-[22px] rounded-full border-2 border-ink", active ? "bg-pencil" : "bg-card")} />
                <span className="text-[17px] font-extrabold">{p.t}</span>
              </span>
              <span className="text-sm leading-normal text-ink-2">{p.d}</span>
              <span className="text-xs font-semibold text-muted-foreground">{p.for}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-6 rounded-xl border border-border bg-card">
        {RULES.map((r) => {
          const value = on(r.key);
          return (
            <div key={r.key} className="flex items-center gap-4 border-b border-divider px-5 py-3.5 last:border-b-0">
              <div className="flex-1">
                <div className="text-sm font-bold">{r.t}</div>
                <div className="text-[13px] text-muted-foreground">
                  {r.d}
                  {r.key === "snapshot" && !snapshotsAvailable && (snapshotsNote ? ` ${snapshotsNote}` : " Needs private photo storage set up on the server (R2_PRIVATE_BUCKET).")}
                </div>
              </div>
              {r.key === "fullscreen" && value && (
                <select
                  value={s.integritySettings.fullscreen}
                  disabled={locked}
                  onChange={(e) => setS((x) => ({ ...x, integritySettings: { ...x.integritySettings, fullscreen: e.target.value as IntegritySettings["fullscreen"] } }))}
                  aria-label="Full screen"
                  className="h-9 rounded-md border border-input bg-card px-2 text-[13px]"
                >
                  <option value="prompt">Ask</option>
                  <option value="required">Required</option>
                </select>
              )}
              <button
                type="button"
                role="switch"
                aria-checked={value}
                aria-label={r.t}
                disabled={locked || (r.key === "snapshot" && !snapshotsAvailable && !value)}
                onClick={() => flip(r.key)}
                className={cn("flex h-7 w-12 flex-none rounded-full p-[3px] transition-colors", value ? "justify-end bg-success" : "justify-start bg-input")}
              >
                <span className="size-[22px] rounded-full bg-white" />
              </button>
              <span className="w-7 text-[13px] font-bold">{value ? "On" : "Off"}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-4 rounded-xl border border-border bg-card px-5 py-4">
        <label htmlFor="nets" className="text-sm font-bold">
          School network only (optional)
        </label>
        <p className="text-[13px] text-muted-foreground">Students can only start or carry on from these addresses, e.g. your lab&apos;s internet connection. One per line. Leave empty to allow anywhere.</p>
        <textarea
          id="nets"
          rows={2}
          disabled={locked}
          value={nets}
          onChange={(e) => {
            setNets(e.target.value);
            const list = e.target.value.split(/[\n,]/).map((l) => l.trim()).filter(Boolean);
            setS((x) => ({ ...x, integritySettings: { ...x.integritySettings, allowedIps: list } }));
          }}
          placeholder="102.89.4.0/24"
          className="mt-2 w-full rounded-md border-[1.5px] border-input bg-card p-2.5 font-mono text-sm"
        />
      </div>
      <p className="mt-3 text-[13px] text-muted-foreground">
        Be honest with students: this deters and detects. It can&apos;t fully lock a personal phone or laptop.
      </p>

      {!locked && (
        <div className="mt-5 flex items-center gap-3">
          <Button
            type="button"
            disabled={!dirty || pending}
            onClick={() =>
              start(async () => {
                const r = await saveSettingsAction(slug, examId, s);
                setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: "Saved" });
                router.refresh();
              })
            }
          >
            {pending ? "Saving…" : "Save rules"}
          </Button>
          {msg && (
            <span role={msg.ok ? "status" : "alert"} className={cn("text-sm font-semibold", msg.ok ? "text-success" : "text-destructive")}>
              {msg.text}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
