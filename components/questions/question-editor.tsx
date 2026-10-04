"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { RichEditor } from "@/components/rich/rich-editor";
import { Button, buttonVariants } from "@/components/ui/button";
import type { RichDoc } from "@/lib/db/schema";
import { getPassageAction, saveQuestionAction, savePassageAction, uploadQuestionImageAction } from "@/lib/questions/actions";
import { MAX_OPTIONS, MIN_OPTIONS, OPTION_LABELS, TYPE_LABEL, validateQuestion, type QuestionInput, type QuestionType } from "@/lib/questions/model";
import { renderDoc } from "@/lib/questions/render";
import { EMPTY_DOC } from "@/lib/questions/rich";
import { cn } from "@/lib/utils";
import { QuestionPreview } from "./question-preview";

type Opt = { key: number; content: RichDoc; isCorrect: boolean };
type Choice = { id: string; name: string };

const TYPES: QuestionType[] = ["mcq_single", "mcq_multi", "true_false", "fill_blank", "numeric", "theory"];
const control =
  "h-11 w-full rounded-md border-[1.5px] border-input bg-card px-3 text-sm font-medium focus:border-2 focus:border-primary focus:outline-none";

let nextKey = 1;
const blankOptions = (n = 4): Opt[] => Array.from({ length: n }, () => ({ key: nextKey++, content: EMPTY_DOC, isCorrect: false }));

export function QuestionEditor({
  slug,
  id,
  code,
  status,
  reviewComment,
  reviewSubjectIds,
  initial,
  subjects,
  levels,
  topics,
  passages: initialPassages,
}: {
  slug: string;
  id?: string;
  code?: string;
  status?: string;
  reviewComment?: string | null;
  /** Subjects this person approves; saving their question approves it. */
  reviewSubjectIds: string[];
  initial: QuestionInput;
  subjects: Choice[];
  levels: { id: string; code: string }[];
  topics: { name: string; subjectId: string; classLevelId: string | null }[];
  passages: { id: string; title: string; subjectId: string }[];
}) {
  const router = useRouter();
  const [q, setQ] = useState<QuestionInput>(initial);
  const [opts, setOpts] = useState<Opt[]>(() =>
    initial.options.length ? initial.options.map((o) => ({ ...o, key: nextKey++ })) : blankOptions(),
  );
  const [accepted, setAccepted] = useState(initial.accepted.join("\n"));
  const [formKey, setFormKey] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [duplicates, setDuplicates] = useState<{ id: string; code: string; text: string }[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [passages, setPassages] = useState(initialPassages);
  const [passageDocs, setPassageDocs] = useState<Record<string, { title: string; content: RichDoc }>>({});
  const [passageOpen, setPassageOpen] = useState(false);
  const lastAction = useRef<{ submit: boolean; another: boolean }>({ submit: true, another: false });

  const set = <K extends keyof QuestionInput>(k: K, v: QuestionInput[K]) => setQ((s) => ({ ...s, [k]: v }));
  const upload = (file: File) => {
    const fd = new FormData();
    fd.set("file", file);
    return uploadQuestionImageAction(slug, fd);
  };

  const input: QuestionInput = useMemo(
    () => ({
      ...q,
      options: q.type === "mcq_single" || q.type === "mcq_multi" ? opts.map(({ content, isCorrect }) => ({ content, isCorrect })) : [],
      accepted: accepted.split(/\n|,/).map((a) => a.trim()).filter(Boolean),
    }),
    [q, opts, accepted],
  );

  // Load the selected passage for the preview.
  useEffect(() => {
    const pid = q.passageId;
    if (!pid || passageDocs[pid]) return;
    void getPassageAction(slug, pid).then((p) => p && setPassageDocs((d) => ({ ...d, [pid]: { title: p.title, content: p.content } })));
  }, [q.passageId, passageDocs, slug]);

  const preview = useMemo(() => {
    const v = validateQuestion(input);
    return {
      stemHtml: renderDoc(q.stem),
      options: opts.map((o, i) => ({ label: OPTION_LABELS[i] ?? "?", html: renderDoc(o.content), isCorrect: o.isCorrect })),
      answer: v.ok ? v.value.answer : null,
    };
  }, [input, q.stem, opts]);

  const topicSuggestions = topics.filter((t) => t.subjectId === q.subjectId && (!q.classLevelId || !t.classLevelId || t.classLevelId === q.classLevelId));
  const subjectPassages = passages.filter((p) => p.subjectId === q.subjectId);
  const isChoice = q.type === "mcq_single" || q.type === "mcq_multi";
  const isReviewer = reviewSubjectIds.includes(q.subjectId);

  const save = (submit: boolean, another: boolean, allowDuplicate = false) => {
    lastAction.current = { submit, another };
    setErrors([]);
    setNotice(null);
    start(async () => {
      const res = await saveQuestionAction(slug, { id, input, submit, allowDuplicate });
      if (!res.ok) {
        if ("duplicates" in res) setDuplicates(res.duplicates);
        else setErrors(res.errors);
        return;
      }
      setDuplicates(null);
      if (another) {
        // Keep subject, class, topic, type and marks; clear the question itself.
        setQ((s) => ({ ...s, stem: EMPTY_DOC, trueFalse: null, numericValue: "", tolerance: "", markingGuide: null }));
        setOpts(blankOptions(Math.max(MIN_OPTIONS, opts.length)));
        setAccepted("");
        setFormKey((k) => k + 1);
        setNotice(`Saved ${res.code}${res.status === "pending" ? " and sent for approval" : res.status === "approved" ? " (approved)" : " as a draft"}. Ready for the next one.`);
        if (id) router.push(`/s/${slug}/questions/new`);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        router.push(`/s/${slug}/questions?sel=${res.id}`);
      }
    });
  };

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex min-w-0 flex-col gap-5 px-4 py-6 lg:px-8 lg:py-7">
        {status === "returned" && reviewComment && (
          <div role="status" className="rounded-lg border border-[#F2D3B5] bg-[#FBEFE3] p-3.5 text-sm text-[#8A430B]">
            <b>Returned for changes:</b> {reviewComment}
          </div>
        )}
        {notice && (
          <div role="status" className="rounded-lg border border-[#C3E2CF] bg-[#E8F4EC] p-3.5 text-sm font-semibold text-[#155E34]">
            {notice}
          </div>
        )}

        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Question type">
          {TYPES.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={q.type === t}
              onClick={() => {
                set("type", t);
                if ((t === "mcq_single" || t === "mcq_multi") && opts.length < MIN_OPTIONS) setOpts(blankOptions());
                // Only one correct option can stay when switching back to objective.
                if (t === "mcq_single" && opts.filter((o) => o.isCorrect).length > 1) setOpts((os) => os.map((o) => ({ ...o, isCorrect: false })));
              }}
              className={cn(
                "h-10 rounded-md border-[1.5px] px-3.5 text-[13px] font-bold",
                q.type === t ? "border-ink bg-ink text-white" : "border-input bg-card text-foreground",
              )}
            >
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>

        {/* Passage */}
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-[13px] font-semibold sm:max-w-sm">
            Comprehension passage <span className="font-normal text-muted-foreground">(optional)</span>
            <select value={q.passageId ?? ""} onChange={(e) => set("passageId", e.target.value || null)} className={control}>
              <option value="">No passage</option>
              {subjectPassages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
          <Button type="button" variant="outline" size="md" onClick={() => setPassageOpen(true)} disabled={!q.subjectId}>
            + New passage
          </Button>
        </div>

        <RichEditor
          key={`stem-${formKey}`}
          label="Question"
          value={q.stem}
          onChange={(d) => set("stem", d)}
          placeholder={q.type === "fill_blank" ? "Type the question, using ___ for the gap" : "Type the question. Use ∑ Maths, or type $x^2$ for maths."}
          uploadImage={upload}
        />

        {/* Answer */}
        {isChoice && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 flex w-full justify-between text-[13px] font-semibold">
              <span>Options</span>
              <span className="font-medium text-muted-foreground">
                {q.type === "mcq_single" ? "Tap the bubble to set the correct answer" : "Tick every correct option"}
              </span>
            </legend>
            {opts.map((o, i) => {
              const label = OPTION_LABELS[i];
              return (
                <div key={o.key} className="flex items-start gap-3">
                  <button
                    type="button"
                    role={q.type === "mcq_single" ? "radio" : "checkbox"}
                    aria-checked={o.isCorrect}
                    aria-label={`Mark ${label} as correct`}
                    onClick={() =>
                      setOpts((os) =>
                        os.map((x) =>
                          q.type === "mcq_single" ? { ...x, isCorrect: x.key === o.key } : x.key === o.key ? { ...x, isCorrect: !x.isCorrect } : x,
                        ),
                      )
                    }
                    className={cn(
                      "mt-1.5 flex size-10 flex-none items-center justify-center border-2 text-sm font-extrabold text-ink",
                      q.type === "mcq_multi" ? "rounded-lg" : "rounded-full",
                      o.isCorrect ? "border-ink bg-pencil" : "border-[#8C93A3] bg-white",
                    )}
                  >
                    {label}
                  </button>
                  <RichEditor
                    key={`opt-${o.key}-${formKey}`}
                    compact
                    label={`Option ${label}`}
                    value={o.content}
                    onChange={(d) => setOpts((os) => os.map((x) => (x.key === o.key ? { ...x, content: d } : x)))}
                    uploadImage={upload}
                    className="min-w-0 flex-1"
                  />
                  <div className="mt-1.5 flex w-[76px] flex-none flex-col items-start gap-1">
                    {o.isCorrect && <span className="text-xs font-bold text-[#155E34]">Correct</span>}
                    {opts.length > MIN_OPTIONS && (
                      <button
                        type="button"
                        onClick={() => setOpts((os) => os.filter((x) => x.key !== o.key))}
                        className="text-xs font-semibold text-ink-2 underline"
                        aria-label={`Remove option ${label}`}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            <div className="flex flex-wrap items-center gap-3">
              {opts.length < MAX_OPTIONS && (
                <button
                  type="button"
                  onClick={() => setOpts((os) => [...os, ...blankOptions(1)])}
                  className="h-10 rounded-md border-[1.5px] border-dashed border-[#9AA1B0] px-3 text-[13px] font-semibold text-ink-2"
                >
                  + Add option {OPTION_LABELS[opts.length]}
                </button>
              )}
              {q.type === "mcq_multi" && (
                <label className="flex items-center gap-2 text-[13px] font-semibold">
                  Marking
                  <select value={q.scoring} onChange={(e) => set("scoring", e.target.value as QuestionInput["scoring"])} className="h-10 rounded-md border-[1.5px] border-input bg-card px-2 text-sm">
                    <option value="all_or_nothing">All right choices, or no marks</option>
                    <option value="partial">Part marks for each right choice</option>
                  </select>
                </label>
              )}
            </div>
          </fieldset>
        )}

        {q.type === "true_false" && (
          <fieldset>
            <legend className="mb-2 text-[13px] font-semibold">The statement is</legend>
            <div className="grid max-w-sm grid-cols-2 gap-2" role="radiogroup">
              {[true, false].map((v) => (
                <button
                  key={String(v)}
                  type="button"
                  role="radio"
                  aria-checked={q.trueFalse === v}
                  onClick={() => set("trueFalse", v)}
                  className={cn(
                    "h-12 rounded-md border-2 text-base font-bold",
                    q.trueFalse === v ? "border-ink bg-pencil" : "border-input bg-card",
                  )}
                >
                  {v ? "True" : "False"}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        {q.type === "fill_blank" && (
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
              Accepted answers <span className="font-normal text-muted-foreground">One per line. Spelling variants count as different answers.</span>
              <textarea
                value={accepted}
                onChange={(e) => setAccepted(e.target.value)}
                rows={3}
                className="rounded-md border-[1.5px] border-input bg-card p-3 text-sm focus:border-2 focus:border-primary focus:outline-none"
                placeholder={"evaporation\nevaporating"}
              />
            </label>
            <label className="flex items-center gap-2 text-[13px] font-semibold">
              <input type="checkbox" checked={q.caseSensitive} onChange={(e) => set("caseSensitive", e.target.checked)} className="size-4 accent-[#14213D]" />
              Capital letters must match (e.g. chemical symbols like Co vs CO)
            </label>
          </div>
        )}

        {q.type === "numeric" && (
          <div className="grid max-w-md grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
              Correct answer
              <input value={q.numericValue} onChange={(e) => set("numericValue", e.target.value)} inputMode="decimal" className={cn(control, "font-mono")} placeholder="e.g. 0.5 or 1/2" />
            </label>
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
              Allow ± <span className="font-normal text-muted-foreground">(optional)</span>
              <input value={q.tolerance} onChange={(e) => set("tolerance", e.target.value)} inputMode="decimal" className={cn(control, "font-mono")} placeholder="0" />
            </label>
            <p className="col-span-2 text-xs text-muted-foreground">Students can type 0.5, 1/2 or ½; all count as the same answer.</p>
          </div>
        )}

        {q.type === "theory" && (
          <RichEditor
            key={`guide-${formKey}`}
            label="Marking guide"
            value={q.markingGuide ?? EMPTY_DOC}
            onChange={(d) => set("markingGuide", d)}
            placeholder="Marking guide: the points you expect, with marks for each."
            uploadImage={upload}
          />
        )}

        {/* Meta */}
        <div className="grid grid-cols-2 gap-3.5 md:grid-cols-5">
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold md:col-span-1">
            Subject
            <select
              value={q.subjectId}
              onChange={(e) => setQ((s) => ({ ...s, subjectId: e.target.value, passageId: null }))}
              className={control}
            >
              <option value="">Choose</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
            Class
            <select value={q.classLevelId ?? ""} onChange={(e) => set("classLevelId", e.target.value || null)} className={control}>
              <option value="">Any class</option>
              {levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
            Topic
            <input value={q.topicName} onChange={(e) => set("topicName", e.target.value)} list="topic-suggestions" className={control} placeholder="e.g. Fractions" />
            <datalist id="topic-suggestions">
              {topicSuggestions.map((t) => (
                <option key={`${t.name}-${t.classLevelId}`} value={t.name} />
              ))}
            </datalist>
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
            Difficulty
            <select value={q.difficulty} onChange={(e) => set("difficulty", e.target.value as QuestionInput["difficulty"])} className={control}>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
            Marks
            <input
              type="number"
              min={0.5}
              step={0.5}
              value={Number.isFinite(q.marks) ? q.marks : ""}
              onChange={(e) => set("marks", Number(e.target.value))}
              className={cn(control, "font-mono")}
            />
          </label>
        </div>

        {duplicates && (
          <div role="alert" className="flex flex-col gap-2 rounded-lg border border-[#F2D3B5] bg-[#FBEFE3] p-4 text-sm text-[#8A430B]">
            <b>This looks like a question already in the bank:</b>
            <ul className="flex flex-col gap-1">
              {duplicates.map((d) => (
                <li key={d.id}>
                  <Link href={`/s/${slug}/questions?sel=${d.id}`} target="_blank" className="font-mono font-semibold underline">
                    {d.code}
                  </Link>{" "}
                  {d.text.length > 140 ? `${d.text.slice(0, 140)}…` : d.text}
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Button type="button" size="md" variant="outline" onClick={() => setDuplicates(null)}>
                Change my question
              </Button>
              <Button type="button" size="md" onClick={() => save(lastAction.current.submit, lastAction.current.another, true)}>
                It&apos;s different, save anyway
              </Button>
            </div>
          </div>
        )}

        {errors.length > 0 && (
          <ul role="alert" className="list-disc rounded-lg border border-destructive/40 bg-card py-3 pr-4 pl-8 text-sm font-semibold text-destructive">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap justify-end gap-2.5 border-t border-border pt-4">
          <Link href={id ? `/s/${slug}/questions?sel=${id}` : `/s/${slug}/questions`} className={cn(buttonVariants({ variant: "outline", size: "md" }))}>
            Cancel
          </Link>
          {(!id || status === "draft" || status === "returned") && (
            <Button type="button" variant="outline" size="md" disabled={pending} onClick={() => save(false, false)}>
              Save as draft
            </Button>
          )}
          <Button type="button" variant="outline" size="md" disabled={pending} onClick={() => save(true, true)}>
            Save and add another
          </Button>
          <Button type="button" size="md" disabled={pending} onClick={() => save(true, false)}>
            {pending ? "Saving…" : isReviewer ? "Save and approve" : status === "approved" ? "Save and resubmit" : "Submit for approval"}
          </Button>
        </div>
        {code && <p className="text-right font-mono text-xs text-muted-foreground">{code}</p>}
      </div>

      <aside className="border-t border-border bg-background px-4 py-6 xl:border-t-0 xl:border-l xl:px-6 xl:py-7">
        <div className="eyebrow mb-3">Live preview · as students see it</div>
        <div className="rounded-xl border border-border bg-card p-5 xl:sticky xl:top-4">
          <QuestionPreview
            passageHtml={q.passageId && passageDocs[q.passageId] ? renderDoc(passageDocs[q.passageId].content) : null}
            passageTitle={q.passageId ? passageDocs[q.passageId]?.title : null}
            stemHtml={preview.stemHtml}
            type={q.type}
            options={preview.options}
            answer={preview.answer}
          />
        </div>
      </aside>

      <PassageDialog
        open={passageOpen}
        onClose={() => setPassageOpen(false)}
        onSave={async (title, content) => {
          const res = await savePassageAction(slug, { subjectId: q.subjectId, classLevelId: q.classLevelId, title, content });
          if (res.error || !res.id) return res.error ?? "Couldn't save the passage.";
          setPassages((ps) => [{ id: res.id!, title: res.title!, subjectId: q.subjectId }, ...ps]);
          setPassageDocs((d) => ({ ...d, [res.id!]: { title: res.title!, content } }));
          set("passageId", res.id);
          return null;
        }}
        upload={upload}
      />
    </div>
  );
}

function PassageDialog({
  open,
  onClose,
  onSave,
  upload,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (title: string, content: RichDoc) => Promise<string | null>;
  upload: (f: File) => Promise<{ url?: string; error?: string }>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState<RichDoc>(EMPTY_DOC);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [key, setKey] = useState(0);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setTitle("");
      setContent(EMPTY_DOC);
      setError(null);
      setKey((k) => k + 1);
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={ref} onClose={onClose} className="m-auto w-[min(760px,calc(100vw-32px))] rounded-xl border border-border bg-card p-0 text-foreground backdrop:bg-ink/40">
      <div className="flex flex-col gap-3 p-5">
        <h2 className="text-lg font-extrabold">New comprehension passage</h2>
        <p className="text-sm text-ink-2">Questions linked to a passage always appear together in exams.</p>
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={control} placeholder="e.g. Market day in Oyo" />
        </label>
        <RichEditor key={key} label="Passage" value={content} onChange={setContent} placeholder="Paste or type the passage" uploadImage={upload} />
        {error && (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            size="md"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              const err = await onSave(title, content);
              setSaving(false);
              if (err) setError(err);
              else onClose();
            }}
          >
            {saving ? "Saving…" : "Save passage"}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
