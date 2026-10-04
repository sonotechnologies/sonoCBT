import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExamRuntime } from "@/components/exam/runtime/exam-runtime";
import { ExamError, previewPayload } from "@/lib/exams/builder";
import { requireStaff } from "@/lib/tenant/context";

export const metadata: Metadata = { title: "Exam preview" };

/** Staff try the exam exactly as a student sees it. Full screen, outside the staff shell; nothing is saved. */
export default async function TryExamPage({ params }: PageProps<"/s/[schoolSlug]/exams/[id]/try">) {
  const { schoolSlug, id } = await params;
  const ctx = await requireStaff(schoolSlug);
  let payload: Awaited<ReturnType<typeof previewPayload>>;
  try {
    payload = await previewPayload(ctx.scope, ctx.actor, id, { schoolName: ctx.school.name, logoUrl: ctx.school.logoUrl, slug: schoolSlug });
  } catch (e) {
    if (e instanceof ExamError) notFound();
    throw e;
  }
  if (!payload.questions.length) {
    return <main className="flex flex-1 items-center justify-center p-6 text-center text-ink-2">Add some questions first, then try the exam.</main>;
  }
  return <ExamRuntime payload={payload} preview />;
}
