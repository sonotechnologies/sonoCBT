"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  generateAiAction,
  importPhotosAction,
  importSheetAction,
  importWordAction,
  type ImportState,
} from "@/lib/import/actions";
import { cn } from "@/lib/utils";

type Choices = { subjects: { id: string; name: string }[]; levels: { id: string; code: string }[]; defaultSubjectId: string };

const control = "h-11 w-full rounded-md border-[1.5px] border-input bg-card px-3 text-sm focus:border-2 focus:border-primary focus:outline-none";

function Target({ c, requireClass = false }: { c: Choices; requireClass?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
        Subject
        <select name="subjectId" defaultValue={c.defaultSubjectId} required className={control}>
          <option value="">Choose</option>
          {c.subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
        Class
        <select name="classLevelId" defaultValue="" required={requireClass} className={control}>
          <option value="">{requireClass ? "Choose" : "Any class"}</option>
          {c.levels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.code}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function Card({ title, lead, children, badge }: { title: string; lead: string; children: React.ReactNode; badge?: string }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <h2 className="text-lg font-extrabold">{title}</h2>
          <p className="mt-0.5 text-sm text-ink-2">{lead}</p>
        </div>
        {badge && <span className="rounded-full bg-pencil px-2 py-0.5 text-[11px] font-bold text-ink">{badge}</span>}
      </div>
      {children}
    </section>
  );
}

function FormError({ state }: { state: ImportState }) {
  return state?.error ? (
    <p role="alert" className="text-sm font-semibold text-destructive">
      {state.error}
    </p>
  ) : null;
}

export function WordImportForm({ slug, c }: { slug: string; c: Choices }) {
  const [state, action, pending] = useActionState(importWordAction.bind(null, slug), undefined);
  return (
    <Card title="Word document" lead="Upload the .docx you already typed. We find the questions, options and answers." badge="Most used">
      <form action={action} className="flex flex-col gap-3">
        <Target c={c} />
        <input type="file" name="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required className="text-sm" />
        <p className="text-xs text-muted-foreground">
          Answers can be marked with &quot;Ans: B&quot;, bold, underline, highlight, an asterisk, or an answer key at the end.
        </p>
        <FormError state={state} />
        <Button type="submit" size="md" disabled={pending} className="self-start">
          {pending ? "Reading your document…" : "Read document"}
        </Button>
      </form>
    </Card>
  );
}

/** Shrinks phone photos in the browser (max 1600px JPEG) so uploads stay small on mobile data. */
async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
  return blob ? new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" }) : file;
}

export function PhotoImportForm({ slug, c, aiReady }: { slug: string; c: Choices; aiReady: boolean }) {
  const [state, action, pending] = useActionState(importPhotosAction.bind(null, slug), undefined);
  const [photos, setPhotos] = useState<File[]>([]);
  const [preparing, setPreparing] = useState(false);
  return (
    <Card title="Photos of a question paper" lead="Snap up to 10 pages, printed or handwritten. The AI reads them; you check every question.">
      {!aiReady && <p className="rounded-md bg-chip p-3 text-[13px] text-ink-2">Needs the AI key (GEMINI_API_KEY) on the server.</p>}
      <form
        action={(fd) => {
          fd.delete("photos");
          photos.forEach((p) => fd.append("photos", p));
          return action(fd);
        }}
        className="flex flex-col gap-3"
      >
        <Target c={c} />
        <input
          type="file"
          accept="image/*"
          multiple
          capture="environment"
          disabled={!aiReady}
          className="text-sm"
          onChange={async (e) => {
            const files = [...(e.target.files ?? [])].slice(0, 10);
            setPreparing(true);
            setPhotos(await Promise.all(files.map(shrink)));
            setPreparing(false);
          }}
        />
        {photos.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {photos.length} page{photos.length === 1 ? "" : "s"} ready ({Math.round(photos.reduce((a, p) => a + p.size, 0) / 1024)} KB)
          </p>
        )}
        <FormError state={state} />
        <Button type="submit" size="md" disabled={pending || preparing || !photos.length || !aiReady} className="self-start">
          {pending ? "Reading the photos… (up to a minute)" : preparing ? "Preparing photos…" : "Read photos"}
        </Button>
      </form>
    </Card>
  );
}

export function SheetImportForm({ slug, c }: { slug: string; c: Choices }) {
  const [state, action, pending] = useActionState(importSheetAction.bind(null, slug), undefined);
  return (
    <Card title="Excel or CSV" lead="One question per row: Question, A–E, Answer, Marks, Topic, Difficulty.">
      <form action={action} className="flex flex-col gap-3">
        <Target c={c} />
        <input type="file" name="file" accept=".xlsx,.csv" required className="text-sm" />
        <p className="text-xs text-muted-foreground">
          Template:{" "}
          <a href={`/s/${slug}/import/template?format=xlsx`} className="font-semibold text-foreground underline">
            Excel
          </a>{" "}
          ·{" "}
          <a href={`/s/${slug}/import/template?format=csv`} className="font-semibold text-foreground underline">
            CSV
          </a>
          . Maths can be typed as $x^2$.
        </p>
        <FormError state={state} />
        <Button type="submit" size="md" disabled={pending} className="self-start">
          {pending ? "Reading…" : "Read spreadsheet"}
        </Button>
      </form>
    </Card>
  );
}

const TYPES = [
  ["objective", "Objective"],
  ["true/false", "True / false"],
  ["fill in the gap", "Fill in the gap"],
  ["theory", "Theory"],
] as const;

export function AiGenerateForm({ slug, c, aiReady }: { slug: string; c: Choices; aiReady: boolean }) {
  const [state, action, pending] = useActionState(generateAiAction.bind(null, slug), undefined);
  return (
    <Card title="Write with AI" lead="Give a topic (and your lesson note if you like). You get draft questions with answers and explanations to check.">
      {!aiReady && <p className="rounded-md bg-chip p-3 text-[13px] text-ink-2">Needs the AI key (GEMINI_API_KEY) on the server.</p>}
      <form action={action} className="flex flex-col gap-3">
        <Target c={c} requireClass />
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
          Topic
          <input name="topic" required placeholder="e.g. Simple interest" className={control} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
            How many
            <select name="count" defaultValue="10" className={control}>
              {[5, 10, 15, 20, 30].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
            Difficulty
            <select name="difficulty" defaultValue="mixed" className={control}>
              <option value="mixed">Mixed</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </label>
        </div>
        <fieldset className="flex flex-wrap gap-2">
          <legend className="mb-1.5 text-[13px] font-semibold">Types</legend>
          {TYPES.map(([v, label]) => (
            <label key={v} className="cursor-pointer">
              <input type="checkbox" name="types" value={v} defaultChecked={v === "objective"} className="peer sr-only" />
              <span className={cn("flex h-[34px] items-center rounded-full border border-input bg-card px-3 text-[13px] font-semibold", "peer-checked:border-ink peer-checked:bg-ink peer-checked:text-white peer-focus-visible:outline-3 peer-focus-visible:outline-ring")}>
                {label}
              </span>
            </label>
          ))}
        </fieldset>
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
          Lesson note <span className="font-normal text-muted-foreground">(optional; paste the text)</span>
          <textarea name="lessonNote" rows={3} className="rounded-md border-[1.5px] border-input bg-card p-2.5 text-sm font-normal" />
        </label>
        <p className="text-xs text-muted-foreground">Only the topic and lesson note are sent to the AI, never student details.</p>
        <FormError state={state} />
        <Button type="submit" size="md" disabled={pending || !aiReady} className="self-start">
          {pending ? "Writing questions… (up to a minute)" : "Write questions"}
        </Button>
      </form>
    </Card>
  );
}
