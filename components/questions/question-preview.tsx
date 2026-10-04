import type { QuestionAnswer } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

export type PreviewOption = { label: string; html: string; isCorrect: boolean };

/** Answer shown under the question for staff (never rendered for students). */
export function answerSummary(a: QuestionAnswer): string | null {
  switch (a.kind) {
    case "true_false":
      return `Answer: ${a.correct ? "True" : "False"}`;
    case "fill_blank":
      return `Accepted: ${a.accepted.join(" · ") || "—"}${a.caseSensitive ? " (exact case)" : ""}`;
    case "numeric":
      return `Answer: ${a.value}${a.tolerance ? ` ± ${a.tolerance}` : ""} (fractions like 1/2 also accepted)`;
    case "mcq_multi":
      return a.scoring === "partial" ? "Partial marks for each right choice" : "All right choices needed for the marks";
    default:
      return null;
  }
}

/**
 * The question as students see it (Atkinson Hyperlegible, options as bubble rows),
 * with the correct answer highlighted when `showAnswers`.
 */
export function QuestionPreview({
  passageHtml,
  passageTitle,
  stemHtml,
  type,
  options,
  answer,
  showAnswers = true,
  className,
}: {
  passageHtml?: string | null;
  passageTitle?: string | null;
  stemHtml: string;
  type: QuestionAnswer["kind"];
  options: PreviewOption[];
  answer: QuestionAnswer | null;
  showAnswers?: boolean;
  className?: string;
}) {
  const summary = showAnswers && answer ? answerSummary(answer) : null;
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {passageHtml && (
        <details className="rounded-lg border border-border bg-card p-3 text-[15px]" open>
          <summary className="cursor-pointer text-[13px] font-bold text-ink-2">Passage: {passageTitle}</summary>
          <div className="rich mt-2 max-h-56 overflow-auto" dangerouslySetInnerHTML={{ __html: passageHtml }} />
        </details>
      )}
      {stemHtml ? (
        <div className="rich text-lg" dangerouslySetInnerHTML={{ __html: stemHtml }} />
      ) : (
        <p className="text-base text-muted-foreground">The question appears here as you type.</p>
      )}

      {(type === "mcq_single" || type === "mcq_multi") && (
        <ul className="flex flex-col gap-2">
          {options.map((o) => {
            const ok = showAnswers && o.isCorrect;
            return (
              <li
                key={o.label}
                className={cn(
                  "flex min-h-12 items-center gap-3 rounded-[10px] bg-card px-3 py-1.5",
                  ok ? "border-2 border-success" : "border-[1.5px] border-[#D5D8DF]",
                )}
              >
                <span
                  className={cn(
                    "flex size-[30px] flex-none items-center justify-center border-2 text-[13px] font-extrabold",
                    type === "mcq_multi" ? "rounded-md" : "rounded-full",
                    ok ? "border-success bg-success text-white" : "border-[#8C93A3] bg-white",
                  )}
                >
                  {o.label}
                </span>
                <span className="rich flex-1 text-base" dangerouslySetInnerHTML={{ __html: o.html || "&nbsp;" }} />
                {ok && <span className="text-xs font-bold text-[#155E34]">Correct</span>}
              </li>
            );
          })}
        </ul>
      )}

      {type === "true_false" && (
        <div className="grid grid-cols-2 gap-2">
          {[true, false].map((v) => {
            const ok = showAnswers && answer?.kind === "true_false" && answer.correct === v;
            return (
              <div
                key={String(v)}
                className={cn(
                  "flex h-12 items-center justify-center rounded-[10px] bg-card font-exam text-base font-bold",
                  ok ? "border-2 border-success text-[#155E34]" : "border-[1.5px] border-[#D5D8DF]",
                )}
              >
                {v ? "True" : "False"}
              </div>
            );
          })}
        </div>
      )}

      {(type === "fill_blank" || type === "numeric") && (
        <div className="flex h-12 items-center rounded-md border-[1.5px] border-input bg-card px-3 font-exam text-base text-muted-foreground">
          {type === "numeric" ? "Type a number" : "Type your answer"}
        </div>
      )}

      {type === "theory" && (
        <div className="flex h-24 items-start rounded-md border-[1.5px] border-input bg-card p-3 font-exam text-base text-muted-foreground">
          Students write their answer here
        </div>
      )}

      {summary && <p className="text-[13px] font-semibold text-[#155E34]">{summary}</p>}
    </div>
  );
}
