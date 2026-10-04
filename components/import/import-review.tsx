"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { RichEditor } from "@/components/rich/rich-editor";
import { Button } from "@/components/ui/button";
import type { RichDoc } from "@/lib/db/schema";
import { commitImportAction, discardImportAction, saveImportItemsAction, suggestTagsAction } from "@/lib/import/actions";
import { assess, mergeItems, progress, splitItem, textToDoc, type Confidence, type ParsedItem, type ParsedPassage } from "@/lib/import/items";
import { uploadQuestionImageAction } from "@/lib/questions/actions";
import { OPTION_LABELS, TYPE_LABEL, type QuestionType } from "@/lib/questions/model";
import { renderDoc } from "@/lib/questions/render";
import { EMPTY_DOC } from "@/lib/questions/rich";
import { cn } from "@/lib/utils";

const BADGE: Record<Confidence, { label: string; cls: string; dot: string }> = {
  green: { label: "Ready", cls: "bg-[#E8F4EC] text-[#155E34]", dot: "rounded-full bg-success" },
  amber: { label: "Check", cls: "bg-[#FDF1E6] text-[#8A430B]", dot: "rotate-45 rounded-[1px] bg-warning" },
  red: { label: "Fix", cls: "bg-[#FBEAE9] text-[#8E2019]", dot: "rounded-[1px] bg-destructive" },
};
const CARD_BORDER: Record<Confidence, string> = {
  green: "border border-border",
  amber: "border-[1.5px] border-[#F3D3B5]",
  red: "border-[1.5px] border-[#F0C4C1]",
};

type Tab = "all" | "attention" | "ready";

export function ImportReview({
  slug,
  jobId,
  kind,
  title,
  context,
  initialItems,
  passages,
  sourceHtml,
  notes,
  approves,
  aiReady,
}: {
  slug: string;
  jobId: string;
  kind: "word" | "photo" | "sheet" | "ai";
  title: string;
  context: string;
  initialItems: ParsedItem[];
  passages: ParsedPassage[];
  sourceHtml: string | null;
  notes: string[];
  /** Saving approves directly (the person reviews this subject). */
  approves: boolean;
  aiReady: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  const [tab, setTab] = useState<Tab>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty" | "error">("saved");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: React.ReactNode } | null>(null);
  const [asDraft, setAsDraft] = useState(false);
  const [committing, startCommit] = useTransition();
  const [tagging, startTagging] = useTransition();
  const lastSaved = useRef(initialItems);
  const original = useRef<HTMLDivElement>(null);

  // Autosave edits (debounced) so a review can be left and resumed.
  useEffect(() => {
    if (items === lastSaved.current) return;
    setSaveState("dirty");
    const t = setTimeout(async () => {
      setSaveState("saving");
      const r = await saveImportItemsAction(slug, jobId, items);
      if (!r.error) lastSaved.current = items;
      setSaveState(r.error ? "error" : "saved");
      if (r.error) setMessage({ tone: "error", text: r.error });
    }, 1200);
    return () => clearTimeout(t);
  }, [items, slug, jobId]);

  const assessed = useMemo(() => new Map(items.map((i) => [i.id, assess(i)])), [items]);
  const p = progress(items);
  const live = items.filter((i) => i.status !== "skipped");
  const attention = live.filter((i) => i.status === "review" && assessed.get(i.id)!.confidence !== "green");
  const green = live.filter((i) => i.status === "review" && assessed.get(i.id)!.confidence === "green");
  // "All" keeps left-out questions (dimmed, with "Put back") so a skip can be undone.
  const shown =
    tab === "all"
      ? items
      : live.filter((i) => (tab === "attention" ? attention.includes(i) : i.status !== "review" || assessed.get(i.id)!.confidence === "green"));
  const accepted = live.filter((i) => i.status === "accepted");
  const passageTitle = (key: string | null) => passages.find((x) => x.key === key)?.title;

  const update = useCallback((id: string, fn: (i: ParsedItem) => ParsedItem) => setItems((xs) => xs.map((x) => (x.id === id ? fn(x) : x))), []);

  const select = (it: ParsedItem) => {
    setSelected(it.id);
    if (it.source === null || !original.current) return;
    const root = original.current.querySelector("[data-doc]");
    const el = root?.children[it.source] as HTMLElement | undefined;
    root?.querySelectorAll(".import-hit").forEach((e) => e.classList.remove("import-hit"));
    if (el) {
      el.classList.add("import-hit");
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  };

  const commit = () =>
    startCommit(async () => {
      setMessage(null);
      const r = await commitImportAction(slug, jobId, items, !asDraft);
      if ("error" in r && r.error) {
        setMessage({ tone: "error", text: r.error });
        return;
      }
      const failed = new Map(r.failed.map((f) => [f.id, f.error]));
      // The server's copy now links each saved question to the bank.
      if (r.items) {
        lastSaved.current = r.items;
        setItems(r.items);
      }
      setMessage({
        tone: r.failed.length ? "error" : "ok",
        text: (
          <>
            Added {r.saved} to the question bank{asDraft ? " as drafts" : approves ? " (approved)" : ", awaiting approval"}.{" "}
            {r.failed.length > 0 && `${r.failed.length} couldn't be added: ${[...failed.values()][0]} `}
            <Link href={`/s/${slug}/questions?status=${asDraft ? "draft" : approves ? "approved" : "pending"}`} className="font-bold underline">
              View in the bank
            </Link>
          </>
        ),
      });
    });

  const suggest = () =>
    startTagging(async () => {
      setMessage(null);
      const r = await suggestTagsAction(slug, jobId, items);
      if (r.error || !r.tags) return setMessage({ tone: "error", text: r.error ?? "No suggestions." });
      const byId = new Map(r.tags.map((t) => [t.id, t]));
      setItems((xs) => xs.map((x) => (byId.has(x.id) && x.status !== "saved" ? { ...x, topicName: x.topicName || byId.get(x.id)!.topic, difficulty: byId.get(x.id)!.difficulty } : x)));
      setMessage({ tone: "ok", text: `Suggested topics and difficulty for ${r.tags.length} questions. Blank topics were filled; you can change any of them.` });
    });

  const pct = p.total ? Math.round((p.ready / p.total) * 100) : 0;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex flex-none flex-wrap items-center gap-x-5 gap-y-3 border-b border-border bg-card px-4 py-4 lg:px-7">
        <div className="min-w-[200px] flex-1">
          <div className="text-xs font-medium text-muted-foreground">
            Smart import · {{ word: "Word", photo: "Photos", sheet: "Spreadsheet", ai: "AI" }[kind]} · {context}
          </div>
          <h1 className="truncate text-lg font-extrabold">{title}</h1>
        </div>
        <div className="flex min-w-[220px] flex-col gap-1.5">
          <div className="flex justify-between gap-4 text-[13px]">
            <span className="font-bold">
              <span className="font-mono">{p.ready}</span> of {p.total} accepted
            </span>
            <span className="text-muted-foreground">
              {attention.length ? `${attention.length} need you` : "All checked"} ·{" "}
              {saveState === "saved" ? "Saved" : saveState === "error" ? "Not saved" : "Saving…"}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded bg-chip" role="progressbar" aria-valuenow={p.ready} aria-valuemax={p.total} aria-label="Questions accepted">
            <div className="h-full rounded bg-success transition-[width] duration-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <button
          type="button"
          disabled={!green.length}
          onClick={() => setItems((xs) => xs.map((x) => (green.includes(x) ? { ...x, status: "accepted" } : x)))}
          className="flex h-11 items-center gap-2 rounded-md border-[1.5px] border-success bg-[#E8F4EC] px-4 text-sm font-bold text-[#155E34] disabled:opacity-50"
        >
          <span aria-hidden className="size-[9px] rounded-full bg-success" />
          Accept all green ({green.length})
        </button>
        <div className="flex items-center gap-2">
          <select
            aria-label="Add as"
            value={asDraft ? "draft" : "submit"}
            onChange={(e) => setAsDraft(e.target.value === "draft")}
            className="h-11 rounded-md border-[1.5px] border-input bg-card px-2 text-[13px] font-semibold"
          >
            <option value="submit">{approves ? "as approved" : "for approval"}</option>
            <option value="draft">as drafts</option>
          </select>
          <Button size="md" className="h-11" disabled={!accepted.length || committing} onClick={commit}>
            {committing ? "Adding…" : `Add ${accepted.length} to question bank`}
          </Button>
        </div>
      </header>

      {message && (
        <div
          role="status"
          className={cn(
            "flex-none border-b px-4 py-2.5 text-sm lg:px-7",
            message.tone === "ok" ? "border-[#C3E2CF] bg-[#F3FAF5] text-[#155E34]" : "border-[#F0C4C1] bg-[#FDF6F5] text-[#8E2019]",
          )}
        >
          {message.text}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {sourceHtml && (
          <section aria-label="Original document" ref={original} className="flex max-h-[45vh] min-w-0 flex-col border-b border-border bg-[#E9E6DD] lg:max-h-none lg:w-[44%] lg:flex-none lg:border-r lg:border-b-0">
            <div className="flex flex-none items-center gap-2.5 border-b border-border bg-secondary px-5 py-2.5 text-xs font-semibold text-ink-2">
              <span className="rounded bg-info px-2 py-0.5 font-mono text-[11px] text-white">DOCX</span>
              Original
              <span className="flex-1" />
              Click a question to find it
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4 lg:p-7">
              <div
                data-doc
                className="import-original mx-auto max-w-[620px] bg-white px-6 py-8 font-serif text-[15px] leading-[1.55] text-[#1A1A1A] shadow-[0_1px_3px_rgba(20,33,61,.12)] lg:px-[52px] lg:py-12"
                dangerouslySetInnerHTML={{ __html: sourceHtml }}
              />
            </div>
          </section>
        )}

        <section aria-label="Parsed questions" className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex flex-none flex-wrap items-center gap-1.5 border-b border-border bg-background px-4 py-2.5 lg:px-5">
            {(
              [
                ["all", "All", live.length],
                ["attention", "Needs attention", attention.length],
                ["ready", "Ready", live.length - attention.length],
              ] as const
            ).map(([id, label, n]) => (
              <button
                key={id}
                type="button"
                aria-pressed={tab === id}
                onClick={() => setTab(id)}
                className={cn("h-[34px] rounded-md border px-3 text-[13px] font-semibold", tab === id ? "border-ink bg-ink text-white" : "border-border bg-card")}
              >
                {label} <span className="font-mono">{n}</span>
              </button>
            ))}
            <span className="flex-1" />
            {aiReady && (
              <button type="button" onClick={suggest} disabled={tagging} className="h-[34px] rounded-md border border-input bg-card px-3 text-[13px] font-semibold disabled:opacity-50">
                {tagging ? "Suggesting…" : "Suggest topics"}
              </button>
            )}
            <span className="hidden text-xs text-muted-foreground sm:inline">Click an option to set the answer</span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-4 pt-4 pb-8 lg:px-5">
            {notes.length > 0 && tab === "all" && (
              <details className="rounded-lg border border-border bg-card px-4 py-2.5 text-[13px] text-ink-2">
                <summary className="cursor-pointer font-semibold">Skipped as headings or instructions ({notes.length})</summary>
                <ul className="mt-1 list-disc pl-5">
                  {notes.slice(0, 30).map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </details>
            )}
            {shown.map((it) => (
              <ReviewCard
                key={it.id}
                slug={slug}
                item={it}
                assessment={assessed.get(it.id)!}
                selected={selected === it.id}
                editing={editing.has(it.id)}
                passageTitle={passageTitle(it.passageKey)}
                hasNext={items.indexOf(it) < items.length - 1}
                onSelect={() => select(it)}
                onChange={(fn) => update(it.id, fn)}
                onEdit={(on) =>
                  setEditing((s) => {
                    const n = new Set(s);
                    if (on) n.add(it.id);
                    else n.delete(it.id);
                    return n;
                  })
                }
                onMergeNext={() =>
                  setItems((xs) => {
                    const i = xs.findIndex((x) => x.id === it.id);
                    if (i < 0 || i === xs.length - 1) return xs;
                    return [...xs.slice(0, i), mergeItems(xs[i], xs[i + 1]), ...xs.slice(i + 2)];
                  })
                }
                onSplit={(at) =>
                  setItems((xs) => {
                    const i = xs.findIndex((x) => x.id === it.id);
                    return [...xs.slice(0, i), ...splitItem(xs[i], at), ...xs.slice(i + 1)];
                  })
                }
              />
            ))}
            {!shown.length && <p className="p-6 text-center text-sm text-ink-2">Nothing here.</p>}
            <form action={discardImportAction.bind(null, slug, jobId)} className="mt-4 self-start">
              <button
                type="submit"
                className="text-[13px] font-semibold text-ink-2 underline"
                onClick={(e) => {
                  if (!confirm("Discard this import? Questions already added to the bank stay there.")) e.preventDefault();
                }}
              >
                Discard this import
              </button>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}

function ReviewCard({
  slug,
  item,
  assessment,
  selected,
  editing,
  passageTitle,
  hasNext,
  onSelect,
  onChange,
  onEdit,
  onMergeNext,
  onSplit,
}: {
  slug: string;
  item: ParsedItem;
  assessment: { confidence: Confidence; reasons: string[] };
  selected: boolean;
  editing: boolean;
  passageTitle?: string;
  hasNext: boolean;
  onSelect: () => void;
  onChange: (fn: (i: ParsedItem) => ParsedItem) => void;
  onEdit: (on: boolean) => void;
  onMergeNext: () => void;
  onSplit: (at: number) => void;
}) {
  const { confidence, reasons } = assessment;
  const saved = item.status === "saved";
  const b = BADGE[confidence];
  const isChoice = item.type === "mcq_single" || item.type === "mcq_multi";
  const stemParas = item.stem.content?.length ?? 0;
  const upload = (file: File) => {
    const fd = new FormData();
    fd.set("file", file);
    return uploadQuestionImageAction(slug, fd);
  };

  const setCorrect = (i: number) =>
    onChange((x) => ({
      ...x,
      options: x.options.map((o, j) => (x.type === "mcq_multi" ? (j === i ? { ...o, isCorrect: !o.isCorrect } : o) : { ...o, isCorrect: j === i })),
    }));

  return (
    <article
      onClick={onSelect}
      aria-label={`Question ${item.number ?? ""}`}
      className={cn("flex flex-col gap-3 rounded-xl bg-card px-[18px] py-4", selected ? "border-2 border-ink" : CARD_BORDER[confidence], item.status === "skipped" && "opacity-50")}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="font-mono text-sm font-semibold">Q{item.number ?? "?"}</span>
        {item.status === "skipped" && <span className="flex h-6 items-center rounded-md bg-chip px-2 text-xs font-bold text-ink-2">Left out</span>}
        {!saved && item.status !== "skipped" && (
          <span className={cn("flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-bold", b.cls)}>
            <span aria-hidden className={cn("size-2", b.dot)} />
            {b.label}
          </span>
        )}
        {!saved && item.status !== "skipped" && confidence !== "green" && reasons[0] && <span className={cn("text-[13px]", b.cls.split(" ")[1])}>{reasons[0]}</span>}
        <span className="flex-1" />
        {saved ? (
          <Link href={`/s/${slug}/questions?sel=${item.questionId}`} className="flex h-8 items-center rounded-md bg-[#E8F4EC] px-3 text-[13px] font-bold text-[#155E34] no-underline">
            ✓ In the bank
          </Link>
        ) : (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (editing) onChange((x) => ({ ...x, flags: [] })); // Done = the teacher has looked at it
                onEdit(!editing);
              }}
              className="h-8 rounded-md border border-input bg-card px-3 text-[13px] font-semibold"
            >
              {editing ? "Done" : "Edit"}
            </button>
            {item.status === "accepted" ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange((x) => ({ ...x, status: "review" }));
                }}
                className="flex h-8 items-center gap-1.5 rounded-md bg-[#E8F4EC] px-3 text-[13px] font-bold text-[#155E34]"
                title="Undo accept"
              >
                ✓ Accepted
              </button>
            ) : item.status === "skipped" ? (
              <button type="button" onClick={(e) => (e.stopPropagation(), onChange((x) => ({ ...x, status: "review" })))} className="h-8 rounded-md border border-input px-3 text-[13px] font-semibold">
                Put back
              </button>
            ) : (
              confidence === "green" && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange((x) => ({ ...x, status: "accepted" }));
                  }}
                  className="h-8 rounded-md bg-ink px-3 text-[13px] font-bold text-white"
                >
                  Accept
                </button>
              )
            )}
          </>
        )}
      </div>

      {confidence !== "green" && !saved && reasons.length > 1 && (
        <ul className="list-disc pl-5 text-[13px] text-ink-2">
          {reasons.slice(1).map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {passageTitle && <p className="text-xs font-semibold text-info">Linked to passage: {passageTitle}</p>}

      {editing && !saved ? (
        <div className="flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="Question type"
              value={item.type}
              onChange={(e) => {
                const type = e.target.value as QuestionType;
                onChange((x) => ({
                  ...x,
                  type,
                  options: (type === "mcq_single" || type === "mcq_multi") && x.options.length < 2 ? ["", "", "", ""].map(() => ({ content: EMPTY_DOC, isCorrect: false })) : x.options,
                }));
              }}
              className="h-9 rounded-md border-[1.5px] border-input bg-card px-2 text-[13px] font-semibold"
            >
              {Object.entries(TYPE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <input
              aria-label="Topic"
              value={item.topicName}
              onChange={(e) => onChange((x) => ({ ...x, topicName: e.target.value }))}
              placeholder="Topic"
              className="h-9 w-40 rounded-md border-[1.5px] border-input bg-card px-2 text-[13px]"
            />
            <select
              aria-label="Difficulty"
              value={item.difficulty}
              onChange={(e) => onChange((x) => ({ ...x, difficulty: e.target.value as ParsedItem["difficulty"] }))}
              className="h-9 rounded-md border-[1.5px] border-input bg-card px-2 text-[13px]"
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
            <label className="flex items-center gap-1.5 text-[13px]">
              Marks
              <input
                type="number"
                min={0.5}
                step={0.5}
                value={item.marks}
                onChange={(e) => onChange((x) => ({ ...x, marks: Number(e.target.value) }))}
                className="h-9 w-16 rounded-md border-[1.5px] border-input bg-card px-2 font-mono text-[13px]"
              />
            </label>
          </div>
          <RichEditor label="Question" value={item.stem} onChange={(d) => onChange((x) => ({ ...x, stem: d }))} uploadImage={upload} />
          {stemParas > 1 && (
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              Split into two questions before paragraph
              {Array.from({ length: stemParas - 1 }, (_, i) => (
                <button key={i} type="button" onClick={() => onSplit(i + 1)} className="h-8 rounded-md border border-input px-2.5 font-mono font-semibold">
                  {i + 2}
                </button>
              ))}
            </div>
          )}
          {isChoice && (
            <div className="flex flex-col gap-2">
              {item.options.map((o, i) => (
                <div key={i} className="flex items-start gap-2">
                  <button
                    type="button"
                    aria-label={`Mark ${OPTION_LABELS[i]} as correct`}
                    aria-pressed={o.isCorrect}
                    onClick={() => setCorrect(i)}
                    className={cn("mt-1.5 flex size-9 flex-none items-center justify-center rounded-full border-2 text-sm font-extrabold", o.isCorrect ? "border-ink bg-pencil" : "border-[#8C93A3] bg-white")}
                  >
                    {OPTION_LABELS[i]}
                  </button>
                  <RichEditor
                    compact
                    label={`Option ${OPTION_LABELS[i]}`}
                    value={o.content}
                    onChange={(d) => onChange((x) => ({ ...x, options: x.options.map((y, j) => (j === i ? { ...y, content: d } : y)) }))}
                    uploadImage={upload}
                    className="min-w-0 flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => onChange((x) => ({ ...x, options: x.options.filter((_, j) => j !== i) }))}
                    className="mt-3 text-xs font-semibold text-ink-2 underline"
                  >
                    Remove
                  </button>
                </div>
              ))}
              {item.options.length < 6 && (
                <button
                  type="button"
                  onClick={() => onChange((x) => ({ ...x, options: [...x.options, { content: EMPTY_DOC, isCorrect: false }] }))}
                  className="h-9 self-start rounded-md border-[1.5px] border-dashed border-[#9AA1B0] px-3 text-[13px] font-semibold text-ink-2"
                >
                  + Add option {OPTION_LABELS[item.options.length]}
                </button>
              )}
            </div>
          )}
          {item.type === "true_false" && (
            <div className="grid max-w-xs grid-cols-2 gap-2">
              {[true, false].map((v) => (
                <button key={String(v)} type="button" onClick={() => onChange((x) => ({ ...x, trueFalse: v }))} className={cn("h-10 rounded-md border-2 font-bold", item.trueFalse === v ? "border-ink bg-pencil" : "border-input")}>
                  {v ? "True" : "False"}
                </button>
              ))}
            </div>
          )}
          {item.type === "fill_blank" && (
            <label className="flex flex-col gap-1 text-[13px] font-semibold">
              Accepted answers (one per line)
              <textarea
                rows={2}
                value={item.accepted.join("\n")}
                onChange={(e) => onChange((x) => ({ ...x, accepted: e.target.value.split("\n") }))}
                className="rounded-md border-[1.5px] border-input p-2 text-sm font-normal"
              />
            </label>
          )}
          {item.type === "numeric" && (
            <label className="flex max-w-xs flex-col gap-1 text-[13px] font-semibold">
              Correct answer
              <input value={item.numericValue} onChange={(e) => onChange((x) => ({ ...x, numericValue: e.target.value }))} className="h-10 rounded-md border-[1.5px] border-input px-2 font-mono text-sm" />
            </label>
          )}
          {item.type === "theory" && (
            <RichEditor label="Marking guide" value={item.markingGuide ?? EMPTY_DOC} onChange={(d) => onChange((x) => ({ ...x, markingGuide: d }))} placeholder="Marking guide (optional)" uploadImage={upload} />
          )}
          <div className="flex flex-wrap gap-3 text-[13px]">
            {hasNext && (
              <button type="button" onClick={onMergeNext} className="font-semibold text-ink-2 underline">
                Join with the next question
              </button>
            )}
            <button type="button" onClick={() => onChange((x) => ({ ...x, status: "skipped" }))} className="font-semibold text-ink-2 underline">
              Leave this question out
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="rich text-base" dangerouslySetInnerHTML={{ __html: renderDoc(item.stem) || "<p><i>No question text</i></p>" }} />
          {isChoice && item.options.length > 0 && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {item.options.map((o, i) => (
                <button
                  key={i}
                  type="button"
                  disabled={saved}
                  aria-pressed={o.isCorrect}
                  onClick={(e) => {
                    e.stopPropagation();
                    setCorrect(i);
                  }}
                  className={cn(
                    "flex min-h-10 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left",
                    o.isCorrect ? "border-[1.5px] border-success bg-[#F3FAF5]" : "border border-border bg-card",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-6 flex-none items-center justify-center rounded-full border-[1.5px] text-[11px] font-extrabold",
                      o.isCorrect ? "border-success bg-success text-white" : "border-[#8C93A3] bg-white",
                    )}
                  >
                    {o.isCorrect ? "✓" : OPTION_LABELS[i]}
                  </span>
                  <span className="rich text-sm" dangerouslySetInnerHTML={{ __html: renderDoc(o.content) }} />
                </button>
              ))}
            </div>
          )}
          {isChoice && item.options.length === 0 && !saved && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange((x) => ({ ...x, options: ["", "", "", ""].map(() => ({ content: textToDoc(""), isCorrect: false })) }));
                onEdit(true);
              }}
              className="h-10 rounded-md border-[1.5px] border-dashed border-destructive bg-[#FDF6F5] text-[13px] font-bold text-[#8E2019]"
            >
              + Add options A–D
            </button>
          )}
          {item.type === "true_false" && (
            <div className="flex gap-2">
              {[true, false].map((v) => (
                <button
                  key={String(v)}
                  type="button"
                  disabled={saved}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange((x) => ({ ...x, trueFalse: v }));
                  }}
                  className={cn("h-10 w-24 rounded-md text-sm font-bold", item.trueFalse === v ? "border-[1.5px] border-success bg-[#F3FAF5] text-[#155E34]" : "border border-border bg-card")}
                >
                  {v ? "True" : "False"}
                </button>
              ))}
            </div>
          )}
          {item.type === "fill_blank" && <p className="text-[13px] text-ink-2">Accepted: {item.accepted.filter(Boolean).join(" · ") || "—"}</p>}
          {item.type === "numeric" && <p className="text-[13px] text-ink-2">Answer: <span className="font-mono">{item.numericValue || "—"}</span></p>}
          {item.type === "theory" && item.markingGuide && (
            <div className="rounded-md bg-background p-2.5 text-[13px]">
              <div className="eyebrow mb-1">Marking guide</div>
              <div className="rich" dangerouslySetInnerHTML={{ __html: renderDoc(item.markingGuide as RichDoc) }} />
            </div>
          )}
          {item.explanation && (
            <div className="flex gap-1.5 text-[13px] text-ink-2">
              <b className="flex-none">Why:</b>
              <div className="rich min-w-0" dangerouslySetInnerHTML={{ __html: renderDoc(textToDoc(item.explanation)) }} />
            </div>
          )}
        </>
      )}

      <div className="flex flex-wrap gap-2 text-xs text-ink-2">
        <span className="rounded-md bg-secondary px-2 py-[3px]">{TYPE_LABEL[item.type]}</span>
        <span className="rounded-md bg-secondary px-2 py-[3px]">Topic: {item.topicName || "—"}</span>
        <span className="rounded-md bg-secondary px-2 py-[3px] capitalize">{item.difficulty}</span>
        <span className="rounded-md bg-secondary px-2 py-[3px]">
          {item.marks} {item.marks === 1 ? "mark" : "marks"}
        </span>
      </div>
    </article>
  );
}

