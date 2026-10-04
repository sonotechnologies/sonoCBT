import type { Metadata } from "next";
import Link from "next/link";
import { BankFilters, BankTable, PreviewActions } from "@/components/questions/bank-client";
import { STATUS_LABEL, STATUS_STYLE } from "@/lib/questions/labels";
import { QuestionPreview } from "@/components/questions/question-preview";
import { buttonVariants } from "@/components/ui/button";
import { formatDate, num } from "@/lib/format";
import { editorChoices } from "@/lib/questions/editor-data";
import { TYPE_LABEL, type QuestionType } from "@/lib/questions/model";
import { renderDoc } from "@/lib/questions/render";
import { canReview, countAwaitingReview, getQuestion, listQuestions, PAGE_SIZE, type BankFilters as Filters } from "@/lib/questions/service";
import { requireCan } from "@/lib/tenant/context";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Question bank" };

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const TYPES = Object.keys(TYPE_LABEL);

export default async function QuestionBankPage({ params, searchParams }: PageProps<"/s/[schoolSlug]/questions">) {
  const { schoolSlug } = await params;
  const sp = await searchParams;
  const ctx = await requireCan(schoolSlug, "question.create");
  const choices = await editorChoices(ctx);

  const values = {
    q: str(sp.q),
    subject: choices.subjects.some((s) => s.id === sp.subject) ? str(sp.subject) : "",
    class: choices.levels.some((l) => l.id === sp.class) ? str(sp.class) : "",
    topic: str(sp.topic),
    type: TYPES.includes(str(sp.type)) ? str(sp.type) : "",
    difficulty: ["easy", "medium", "hard"].includes(str(sp.difficulty)) ? str(sp.difficulty) : "",
    status: ["mine", "pending", "returned", "approved", "draft", "archived"].includes(str(sp.status)) ? str(sp.status) : "",
  };
  const page = Math.max(0, Number(str(sp.page)) || 0);
  const filters: Filters = {
    q: values.q || undefined,
    subjectId: values.subject || undefined,
    classLevelId: values.class || undefined,
    topicId: choices.topics.some((t) => t.id === values.topic) ? values.topic : undefined,
    type: (values.type || undefined) as QuestionType | undefined,
    difficulty: (values.difficulty || undefined) as Filters["difficulty"],
    status: (values.status || undefined) as Filters["status"],
  };

  const [{ rows, total }, awaiting] = await Promise.all([
    listQuestions(ctx.scope, ctx.actor, filters, page),
    countAwaitingReview(ctx.scope, ctx.actor),
  ]);
  const selId = str(sp.sel) || null;
  const sel = selId ? await getQuestion(ctx.scope, ctx.actor, selId) : null;
  const selReviewer = sel ? await canReview(ctx.scope, ctx.actor, sel.subjectId) : false;
  const anyReviewer = choices.reviewSubjectIds.length > 0;

  const subjectName = choices.subjects.find((s) => s.id === values.subject)?.name;
  const levelCode = choices.levels.find((l) => l.id === values.class)?.code;
  const title = [levelCode, subjectName].filter(Boolean).join(" ") || "All questions";
  const query = new URLSearchParams(Object.entries(values).filter(([, v]) => v)).toString();
  const pageHref = (p: number) => {
    const q = new URLSearchParams(query);
    if (p) q.set("page", String(p));
    return `?${q}`;
  };

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-5 lg:px-8">
        <div className="min-w-[200px] flex-1">
          <div className="text-[13px] font-semibold text-muted-foreground">Question bank</div>
          <h1 className="mt-0.5 text-2xl font-extrabold">{title}</h1>
        </div>
        {anyReviewer && (
          <Link
            href={`?status=pending`}
            className={cn(buttonVariants({ variant: "outline", size: "md" }), values.status === "pending" && "border-ink")}
          >
            Review queue
            <span className="rounded-full bg-pencil px-[7px] py-px font-mono text-[11px] font-semibold text-ink">{awaiting}</span>
          </Link>
        )}
        <Link href={`/s/${schoolSlug}/import`} className={cn(buttonVariants({ variant: "outline", size: "md" }))}>
          Upload Word doc
        </Link>
        <Link
          href={`/s/${schoolSlug}/questions/new${values.subject || values.class ? `?${new URLSearchParams({ ...(values.subject && { subject: values.subject }), ...(values.class && { class: values.class }) })}` : ""}`}
          className={cn(buttonVariants({ size: "md" }))}
        >
          New question
        </Link>
      </div>

      <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
        <div className="flex min-h-[420px] min-w-0 flex-1 flex-col">
          <BankFilters
            subjects={choices.subjects}
            levels={choices.levels}
            topics={choices.topics.filter((t) => t.subjectId === values.subject)}
            values={values}
          />
          {rows.length ? (
            <BankTable slug={schoolSlug} rows={rows} selectedId={sel?.id ?? null} isReviewer={anyReviewer} levels={choices.levels} query={query} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
              <p className="text-base font-bold">
                {values.status === "pending" && anyReviewer
                  ? "Nothing is waiting for approval"
                  : Object.values(filters).some(Boolean)
                    ? "No questions match"
                    : "No questions yet"}
              </p>
              <p className="max-w-sm text-sm text-ink-2">
                {values.status === "pending" && anyReviewer
                  ? "New and edited questions from your teachers will appear here."
                  : Object.values(filters).some(Boolean)
                  ? "Try clearing a filter or searching for a different word."
                  : "Add your first question. Objective, theory, fill-in-the-gap and more, with maths and images."}
              </p>
              <Link href={`/s/${schoolSlug}/questions/new`} className={cn(buttonVariants({ size: "md" }))}>
                New question
              </Link>
            </div>
          )}
          {total > PAGE_SIZE && (
            <nav className="flex items-center justify-between border-t border-border bg-card px-4 py-2.5 text-sm lg:px-8" aria-label="Pages">
              <span className="text-ink-2">
                {page * PAGE_SIZE + 1}–{Math.min(total, (page + 1) * PAGE_SIZE)} of {total}
              </span>
              <span className="flex gap-2">
                {page > 0 && (
                  <Link href={pageHref(page - 1)} className="font-semibold underline">
                    Previous
                  </Link>
                )}
                {(page + 1) * PAGE_SIZE < total && (
                  <Link href={pageHref(page + 1)} className="font-semibold underline">
                    Next
                  </Link>
                )}
              </span>
            </nav>
          )}
        </div>

        {sel && (
          <aside
            aria-label={`Question ${sel.code}`}
            className="flex w-full flex-none flex-col gap-4 overflow-auto border-t border-border bg-card p-6 xl:w-[clamp(320px,30vw,420px)] xl:border-t-0 xl:border-l"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">{sel.code}</span>
              <span className="rounded-full bg-chip px-2 py-[3px] text-xs font-semibold">{TYPE_LABEL[sel.type]}</span>
              <span className="text-xs text-muted-foreground">
                {num(sel.marks)} {sel.marks === 1 ? "mark" : "marks"}
              </span>
              <span className={cn("ml-auto rounded-full px-2 py-[3px] text-xs font-semibold", STATUS_STYLE[sel.status])}>{STATUS_LABEL[sel.status]}</span>
            </div>
            {sel.status === "returned" && sel.reviewComment && (
              <p className="rounded-md bg-[#FBEFE3] p-3 text-[13px] text-[#8A430B]">
                <b>Returned:</b> {sel.reviewComment}
              </p>
            )}
            <PreviewActions
              slug={schoolSlug}
              id={sel.id}
              status={sel.status}
              canEdit={selReviewer || sel.authorId === ctx.user.id}
              isReviewer={selReviewer}
              isAuthor={sel.authorId === ctx.user.id}
            />
            <div className="eyebrow">Student preview</div>
            <div className="rounded-xl border border-border bg-background p-5">
              <QuestionPreview
                passageHtml={sel.passage ? renderDoc(sel.passage.content) : null}
                passageTitle={sel.passage?.title}
                stemHtml={renderDoc(sel.stem)}
                type={sel.type}
                options={sel.options.map((o) => ({ label: o.label, html: renderDoc(o.content), isCorrect: o.isCorrect }))}
                answer={sel.answer}
              />
              {sel.answer.kind === "theory" && sel.answer.markingGuide && (
                <div className="mt-4 border-t border-border pt-3">
                  <div className="eyebrow mb-1">Marking guide</div>
                  <div className="rich text-[15px]" dangerouslySetInnerHTML={{ __html: renderDoc(sel.answer.markingGuide) }} />
                </div>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-3 text-[13px]">
              <div>
                <dt className="text-muted-foreground">Topic</dt>
                <dd className="mt-0.5 font-bold">{sel.topicName ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Class</dt>
                <dd className="mt-0.5 font-bold">{sel.classLevelCode ?? "Any"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Last used</dt>
                <dd className="mt-0.5 font-mono font-bold">{sel.stats?.lastUsedAt ? formatDate(sel.stats.lastUsedAt) : "Not yet"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Got it right</dt>
                <dd className="mt-0.5 font-mono font-bold">{sel.stats?.pctCorrect != null ? `${num(sel.stats.pctCorrect, 0)}%` : "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Author</dt>
                <dd className="mt-0.5 font-bold">{sel.authorName ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Updated</dt>
                <dd className="mt-0.5 font-mono font-bold">{formatDate(sel.updatedAt)}</dd>
              </div>
            </dl>
          </aside>
        )}
      </div>
    </main>
  );
}
