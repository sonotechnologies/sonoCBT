import type { Metadata } from "next";
import { QuestionEditor } from "@/components/questions/question-editor";
import { editorChoices } from "@/lib/questions/editor-data";
import type { QuestionInput } from "@/lib/questions/model";
import { EMPTY_DOC } from "@/lib/questions/rich";
import { requireCan } from "@/lib/tenant/context";

export const metadata: Metadata = { title: "New question" };

export default async function NewQuestionPage({ params, searchParams }: PageProps<"/s/[schoolSlug]/questions/new">) {
  const { schoolSlug } = await params;
  const sp = await searchParams;
  const ctx = await requireCan(schoolSlug, "question.create");
  const choices = await editorChoices(ctx);

  const pick = (v: unknown, list: { id: string }[]) => (typeof v === "string" && list.some((x) => x.id === v) ? v : null);
  const subjectId = pick(sp.subject, choices.subjects) ?? choices.mySubjectIds[0] ?? "";
  const initial: QuestionInput = {
    type: "mcq_single",
    subjectId,
    classLevelId: pick(sp.class, choices.levels),
    topicName: "",
    passageId: null,
    stem: EMPTY_DOC,
    marks: 1,
    difficulty: "medium",
    options: [],
    scoring: "all_or_nothing",
    trueFalse: null,
    accepted: [],
    caseSensitive: false,
    numericValue: "",
    tolerance: "",
    markingGuide: null,
  };

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-4 border-b border-border bg-card px-4 py-5 lg:px-8">
        <div className="flex-1">
          <div className="text-[13px] font-semibold text-muted-foreground">Question bank</div>
          <h1 className="mt-0.5 text-2xl font-extrabold">New question</h1>
        </div>
      </div>
      <QuestionEditor
        slug={schoolSlug}
        reviewSubjectIds={choices.reviewSubjectIds}
        initial={initial}
        subjects={choices.subjects}
        levels={choices.levels}
        topics={choices.topics}
        passages={choices.passages}
      />
    </main>
  );
}
