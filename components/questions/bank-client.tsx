"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { bulkUpdateAction, deleteDraftAction, workflowAction } from "@/lib/questions/actions";
import { plainText, STATUS_LABEL, STATUS_STYLE } from "@/lib/questions/labels";
import { TYPE_LABEL } from "@/lib/questions/model";
import type { BankRow, WorkflowAction } from "@/lib/questions/service";
import { cn } from "@/lib/utils";

const DIFF_DOTS = { easy: 1, medium: 2, hard: 3 } as const;

function Difficulty({ level }: { level: BankRow["difficulty"] }) {
  return (
    <span className="flex gap-[3px]" role="img" aria-label={`Difficulty: ${level}`}>
      {[1, 2, 3].map((k) => (
        <span key={k} className={cn("size-2.5 rounded-full border-[1.5px] border-ink", k <= DIFF_DOTS[level] ? "bg-ink" : "bg-transparent")} />
      ))}
    </span>
  );
}

/** Filter selects submit as soon as they change. */
export function BankFilters({
  subjects,
  levels,
  topics,
  values,
}: {
  subjects: { id: string; name: string }[];
  levels: { id: string; code: string }[];
  topics: { id: string; name: string }[];
  values: Record<string, string>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const update = (k: string, v: string) => {
    const next = new URLSearchParams(sp);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k === "subject") next.delete("topic");
    next.delete("sel");
    next.delete("page");
    router.push(`${pathname}?${next}`);
  };
  const sel = (on: boolean) =>
    cn(
      "h-10 rounded-md border-[1.5px] px-2.5 text-[13px] font-semibold",
      on ? "border-ink bg-ink text-white" : "border-input bg-card text-foreground",
    );
  return (
    <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-4 py-3.5 lg:px-8">
      <form
        role="search"
        className="flex h-10 min-w-[200px] flex-1 items-center gap-2 rounded-md border-[1.5px] border-input bg-card px-3 text-sm sm:max-w-[360px]"
        onSubmit={(e) => {
          e.preventDefault();
          update("q", String(new FormData(e.currentTarget).get("q") ?? ""));
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className="text-muted-foreground">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input name="q" defaultValue={values.q} placeholder="Search questions" aria-label="Search questions" className="min-w-0 flex-1 bg-transparent focus:outline-none" />
      </form>
      <select aria-label="Class" value={values.class ?? ""} onChange={(e) => update("class", e.target.value)} className={sel(!!values.class)}>
        <option value="">All classes</option>
        {levels.map((l) => (
          <option key={l.id} value={l.id}>
            {l.code}
          </option>
        ))}
      </select>
      <select aria-label="Subject" value={values.subject ?? ""} onChange={(e) => update("subject", e.target.value)} className={sel(!!values.subject)}>
        <option value="">All subjects</option>
        {subjects.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <select aria-label="Topic" value={values.topic ?? ""} onChange={(e) => update("topic", e.target.value)} className={sel(!!values.topic)} disabled={!values.subject}>
        <option value="">All topics</option>
        {topics.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <select aria-label="Type" value={values.type ?? ""} onChange={(e) => update("type", e.target.value)} className={sel(!!values.type)}>
        <option value="">Any type</option>
        {Object.entries(TYPE_LABEL).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
      <select aria-label="Difficulty" value={values.difficulty ?? ""} onChange={(e) => update("difficulty", e.target.value)} className={sel(!!values.difficulty)}>
        <option value="">Any difficulty</option>
        <option value="easy">Easy</option>
        <option value="medium">Medium</option>
        <option value="hard">Hard</option>
      </select>
      <select aria-label="Status" value={values.status ?? ""} onChange={(e) => update("status", e.target.value)} className={sel(!!values.status)}>
        <option value="">All (not archived)</option>
        <option value="mine">My questions</option>
        <option value="pending">Awaiting approval</option>
        <option value="returned">Returned</option>
        <option value="approved">Approved</option>
        <option value="draft">My drafts</option>
        <option value="archived">Archived</option>
      </select>
    </div>
  );
}

/** Table of questions with row selection and bulk actions. */
export function BankTable({
  slug,
  rows,
  selectedId,
  isReviewer,
  levels,
  query,
}: {
  slug: string;
  rows: BankRow[];
  selectedId: string | null;
  isReviewer: boolean;
  levels: { id: string; code: string }[];
  query: string;
}) {
  const router = useRouter();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [topicDraft, setTopicDraft] = useState("");

  const ids = [...checked];
  const run = (fn: () => Promise<string>) =>
    start(async () => {
      setMessage(await fn());
      setChecked(new Set());
      router.refresh();
    });
  const workflow = (action: WorkflowAction, verb: string) =>
    run(async () => {
      const r = await workflowAction(slug, ids, action);
      if (r.error) return r.error;
      return `${r.changed} ${verb}${r.skipped ? ` · ${r.skipped} skipped (not allowed or already done)` : ""}.`;
    });
  const href = (id: string) => {
    const sp = new URLSearchParams(query);
    sp.set("sel", id);
    return `?${sp}`;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {ids.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-[#FFF8E1] px-4 py-2.5 text-sm lg:px-8" role="region" aria-label="Bulk actions">
          <b>{ids.length} selected</b>
          {isReviewer && (
            <Button size="md" disabled={pending} onClick={() => workflow("approve", "approved")} className="h-9">
              Approve
            </Button>
          )}
          <Button size="md" variant="outline" disabled={pending} onClick={() => workflow("submit", "sent for approval")} className="h-9">
            Submit
          </Button>
          <Button
            size="md"
            variant="outline"
            disabled={pending}
            className="h-9"
            onClick={() => {
              if (confirm(`Archive ${ids.length} question(s)? They'll be hidden from the bank and exams, but not deleted.`)) workflow("archive", "archived");
            }}
          >
            Archive
          </Button>
          <span className="flex items-center gap-1">
            <input
              value={topicDraft}
              onChange={(e) => setTopicDraft(e.target.value)}
              placeholder="Topic"
              aria-label="Set topic for selected"
              className="h-9 w-32 rounded-md border-[1.5px] border-input bg-card px-2 text-[13px]"
            />
            <Button
              size="md"
              variant="outline"
              disabled={pending || !topicDraft.trim()}
              className="h-9"
              onClick={() =>
                run(async () => {
                  const r = await bulkUpdateAction(slug, ids, { topicName: topicDraft });
                  setTopicDraft("");
                  return `Topic set on ${r.changed}.`;
                })
              }
            >
              Tag
            </Button>
          </span>
          <select
            aria-label="Move selected to class"
            defaultValue=""
            disabled={pending}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              e.target.value = "";
              run(async () => {
                const r = await bulkUpdateAction(slug, ids, { classLevelId: v === "any" ? null : v });
                return `Moved ${r.changed}.`;
              });
            }}
            className="h-9 rounded-md border-[1.5px] border-input bg-card px-2 text-[13px] font-semibold"
          >
            <option value="">Move to class…</option>
            <option value="any">Any class</option>
            {levels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code}
              </option>
            ))}
          </select>
          <button type="button" className="ml-auto text-[13px] font-semibold underline" onClick={() => setChecked(new Set())}>
            Clear
          </button>
        </div>
      )}
      {message && (
        <p role="status" className="border-b border-border bg-card px-4 py-2 text-sm font-semibold text-ink-2 lg:px-8">
          {message}
        </p>
      )}
      <div className="relative min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-secondary text-left text-xs font-bold text-ink-2">
            <tr className="h-10 border-b border-border">
              <th className="w-10 pl-4 lg:pl-8">
                <input
                  type="checkbox"
                  aria-label="Select all on this page"
                  checked={rows.length > 0 && rows.every((r) => checked.has(r.id))}
                  onChange={(e) => setChecked(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                  className="size-4 accent-[#14213D]"
                />
              </th>
              <th className="w-[92px] px-2">Code</th>
              <th className="px-2">Question</th>
              <th className="w-[130px] px-2">Topic</th>
              <th className="w-[120px] px-2">Type</th>
              <th className="w-[80px] px-2">Difficulty</th>
              <th className="w-[130px] px-2">Status</th>
              <th className="w-[52px] pr-4 text-right lg:pr-8">Used</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const on = r.id === selectedId;
              return (
                <tr
                  key={r.id}
                  className={cn("h-14 border-b border-divider", on ? "bg-[#FFF8E1] shadow-[inset_4px_0_0_#F2B705]" : "bg-card hover:bg-background")}
                >
                  <td className="pl-4 lg:pl-8">
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.code}`}
                      checked={checked.has(r.id)}
                      onChange={(e) =>
                        setChecked((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.add(r.id);
                          else n.delete(r.id);
                          return n;
                        })
                      }
                      className="size-4 accent-[#14213D]"
                    />
                  </td>
                  <td className="px-2 font-mono text-xs text-muted-foreground">{r.code}</td>
                  <td className="max-w-0 px-2">
                    <Link href={href(r.id)} scroll={false} className="block truncate font-semibold no-underline hover:underline" aria-current={on ? "true" : undefined}>
                      {plainText(r.text) || "(image only)"}
                    </Link>
                  </td>
                  <td className="truncate px-2 text-[13px] text-ink-2">{r.topic ?? "—"}</td>
                  <td className="px-2 text-xs font-semibold">
                    <span className="rounded-full bg-chip px-2 py-[3px]">{TYPE_LABEL[r.type]}</span>
                  </td>
                  <td className="px-2">
                    <Difficulty level={r.difficulty} />
                  </td>
                  <td className="px-2">
                    <span className={cn("rounded-full px-2 py-[3px] text-xs font-semibold", STATUS_STYLE[r.status])}>{STATUS_LABEL[r.status]}</span>
                  </td>
                  <td className="pr-4 text-right font-mono text-[13px] lg:pr-8">{r.timesUsed}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Actions in the preview panel for the selected question. */
export function PreviewActions({
  slug,
  id,
  status,
  canEdit,
  isReviewer,
  isAuthor,
}: {
  slug: string;
  id: string;
  status: BankRow["status"];
  canEdit: boolean;
  isReviewer: boolean;
  isAuthor: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [returning, setReturning] = useState(false);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const act = (action: WorkflowAction, note?: string) =>
    start(async () => {
      setError(null);
      const r = await workflowAction(slug, [id], action, note);
      if (r.error) setError(r.error);
      else if (!r.changed) setError("That couldn't be done. Refresh and try again.");
      else {
        setReturning(false);
        router.refresh();
      }
    });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {canEdit && status !== "archived" && (
          <Link href={`/s/${slug}/questions/${id}/edit`} className={cn(buttonVariants({ variant: "outline", size: "md" }), "h-9 text-[13px]")}>
            Edit
          </Link>
        )}
        {isReviewer && (status === "pending" || status === "draft" || status === "returned") && (
          <Button size="md" className="h-9 text-[13px]" disabled={pending} onClick={() => act("approve")}>
            Approve
          </Button>
        )}
        {isReviewer && (status === "pending" || status === "approved") && !returning && (
          <Button size="md" variant="outline" className="h-9 text-[13px]" disabled={pending} onClick={() => setReturning(true)}>
            Return with comment
          </Button>
        )}
        {isAuthor && !isReviewer && (status === "draft" || status === "returned") && (
          <Button size="md" className="h-9 text-[13px]" disabled={pending} onClick={() => act("submit")}>
            Submit for approval
          </Button>
        )}
        {(isReviewer || isAuthor) && status !== "archived" && (
          <Button size="md" variant="outline" className="h-9 text-[13px]" disabled={pending} onClick={() => act("archive")}>
            Archive
          </Button>
        )}
        {isReviewer && status === "archived" && (
          <Button size="md" variant="outline" className="h-9 text-[13px]" disabled={pending} onClick={() => act("restore")}>
            Restore as draft
          </Button>
        )}
        {isAuthor && status === "draft" && (
          <Button
            size="md"
            variant="outline"
            className="h-9 text-[13px]"
            disabled={pending}
            onClick={() => {
              if (!confirm("Delete this draft? This can't be undone.")) return;
              start(async () => {
                const r = await deleteDraftAction(slug, id);
                if (r.error) setError(r.error);
                else router.push(`/s/${slug}/questions`);
              });
            }}
          >
            Delete draft
          </Button>
        )}
      </div>
      {returning && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            act("return", comment);
          }}
        >
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
            What needs changing?
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              required
              className="rounded-md border-[1.5px] border-input bg-card p-2.5 text-sm font-normal focus:border-2 focus:border-primary focus:outline-none"
              placeholder="e.g. Options B and D are both correct."
            />
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="md" className="h-9 text-[13px]" disabled={pending || !comment.trim()}>
              Send back to author
            </Button>
            <Button type="button" size="md" variant="outline" className="h-9 text-[13px]" onClick={() => setReturning(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
