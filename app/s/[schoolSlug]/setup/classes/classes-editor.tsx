"use client";

import { useState } from "react";
import { parseArms } from "@/lib/school/defaults";
import { cn } from "@/lib/utils";

type Level = { code: string; on: boolean; arms: string };
type Subject = { name: string; shortName?: string | null; stage: "jss" | "ss" | "all" };

function SubjectGroup({
  label,
  stage,
  subjects,
  onRemove,
  onAdd,
}: {
  label: string;
  stage: "jss" | "ss";
  subjects: Subject[];
  onRemove: (name: string) => void;
  onAdd: (name: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const shown = subjects.filter((s) => s.stage === "all" || s.stage === stage);
  const add = () => {
    if (draft.trim()) onAdd(draft.trim());
    setDraft("");
  };
  return (
    <div className="flex flex-col gap-2">
      <h2 className="mt-3 text-[13px] font-semibold">{label}</h2>
      <ul className="flex flex-wrap gap-2">
        {shown.map((s) => (
          <li
            key={s.name}
            className="flex h-[34px] items-center gap-2 rounded-full border border-input bg-card pr-1 pl-3 text-[13px] font-semibold"
          >
            <span aria-hidden className="size-2 rounded-full bg-ink" />
            {s.name}
            <button
              type="button"
              onClick={() => onRemove(s.name)}
              className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label={`Remove ${s.name} from ${label}`}
            >
              ×
            </button>
          </li>
        ))}
        <li className="flex h-[34px] items-center rounded-full border-[1.5px] border-dashed border-[#9AA1B0] pr-1 pl-3">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder="+ Add subject"
            aria-label={`Add a subject to ${label}`}
            className="w-32 bg-transparent text-[13px] font-semibold text-ink-2 placeholder:text-ink-2 focus:outline-none"
          />
          {draft && (
            <button type="button" onClick={add} className="h-7 rounded-full bg-ink px-2.5 text-xs font-bold text-white">
              Add
            </button>
          )}
        </li>
      </ul>
    </div>
  );
}

export function ClassesEditor({ initialLevels, initialSubjects }: { initialLevels: Level[]; initialSubjects: Subject[] }) {
  const [levels, setLevels] = useState(initialLevels);
  const [subjects, setSubjects] = useState(initialSubjects);

  const payload = {
    levels: levels.filter((l) => l.on).map((l) => ({ code: l.code, arms: parseArms(l.arms) })),
    subjects,
  };

  const removeFrom = (stage: "jss" | "ss") => (name: string) =>
    setSubjects((list) =>
      list.flatMap((s) => {
        if (s.name !== name) return [s];
        if (s.stage === "all") return [{ ...s, stage: stage === "jss" ? "ss" : "jss" } as Subject];
        return [];
      }),
    );
  const addTo = (stage: "jss" | "ss") => (name: string) =>
    setSubjects((list) => {
      const match = list.find((s) => s.name.toLowerCase() === name.toLowerCase());
      if (!match) return [...list, { name, stage }];
      if (match.stage === stage || match.stage === "all") return list;
      return list.map((s) => (s === match ? { ...s, stage: "all" } : s));
    });

  return (
    <div className="flex flex-col gap-3.5">
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      <ul className="flex flex-col gap-2">
        {levels.map((l) => (
          <li key={l.code} className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              aria-pressed={l.on}
              onClick={() => setLevels((ls) => ls.map((x) => (x.code === l.code ? { ...x, on: !x.on } : x)))}
              className={cn(
                "h-11 w-[88px] rounded-md border-[1.5px] text-sm font-bold",
                l.on ? "border-ink bg-ink text-white" : "border-input bg-card text-muted-foreground",
              )}
            >
              {l.code}
            </button>
            <label className={cn("flex min-w-0 flex-1 items-center gap-2 text-[13px] text-muted-foreground", !l.on && "opacity-50")}>
              Arms
              <input
                value={l.arms}
                disabled={!l.on}
                onChange={(e) => setLevels((ls) => ls.map((x) => (x.code === l.code ? { ...x, arms: e.target.value } : x)))}
                placeholder="A B C  or  Science, Art"
                className="h-11 min-w-0 flex-1 rounded-md border-[1.5px] border-input bg-card px-3 font-mono text-sm text-foreground focus:border-2 focus:border-primary focus:outline-none"
                aria-label={`Arms for ${l.code}`}
              />
            </label>
          </li>
        ))}
      </ul>
      <p className="text-[13px] text-muted-foreground">
        Single letters make classes like JSS1A; words make classes like SS1 Science.
      </p>

      <SubjectGroup label="Subjects for JSS classes" stage="jss" subjects={subjects} onRemove={removeFrom("jss")} onAdd={addTo("jss")} />
      <SubjectGroup label="Subjects for SS classes" stage="ss" subjects={subjects} onRemove={removeFrom("ss")} onAdd={addTo("ss")} />
    </div>
  );
}
