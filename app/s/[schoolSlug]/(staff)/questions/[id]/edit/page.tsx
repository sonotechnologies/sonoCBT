import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { QuestionEditor } from "@/components/questions/question-editor";
import { editorChoices } from "@/lib/questions/editor-data";
import { canReview, getQuestion, toInput } from "@/lib/questions/service";
import { requireCan } from "@/lib/tenant/context";

export const metadata: Metadata = { title: "Edit question" };

export default async function EditQuestionPage({ params }: PageProps<"/s/[schoolSlug]/questions/[id]/edit">) {
  const { schoolSlug, id } = await params;
  const ctx = await requireCan(schoolSlug, "question.create");
  const q = await getQuestion(ctx.scope, ctx.actor, id);
  if (!q) notFound();
  const mayEdit = (await canReview(ctx.scope, ctx.actor, q.subjectId)) || (q.authorId === ctx.user.id && q.status !== "archived");
  if (!mayEdit) notFound();
  const choices = await editorChoices(ctx);

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-4 border-b border-border bg-card px-4 py-5 lg:px-8">
        <div className="flex-1">
          <div className="text-[13px] font-semibold text-muted-foreground">Question bank</div>
          <h1 className="mt-0.5 text-2xl font-extrabold">Edit question {q.code}</h1>
        </div>
      </div>
      <QuestionEditor
        slug={schoolSlug}
        id={q.id}
        code={q.code}
        status={q.status}
        reviewComment={q.reviewComment}
        reviewSubjectIds={choices.reviewSubjectIds}
        initial={toInput(q)}
        subjects={choices.subjects}
        levels={choices.levels}
        topics={choices.topics}
        passages={choices.passages}
      />
    </main>
  );
}
