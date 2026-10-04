import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ExamRuntime } from "@/components/exam/runtime/exam-runtime";
import { buildPayload, classNameOf, finishIfOverdue, getAttempt } from "@/lib/exams/runtime";
import { requireStudent } from "@/lib/tenant/context";

export const metadata: Metadata = { title: "Exam" };

/**
 * The exam. Only reachable once the lobby has started an attempt; the server's
 * deadline and the student's own question order come with the page.
 */
export default async function TakeExamPage({ params }: PageProps<"/s/[schoolSlug]/exam/[examId]/take">) {
  const { schoolSlug, examId } = await params;
  const { scope, school, student } = await requireStudent(schoolSlug);
  let a = await getAttempt(scope, student.id, examId);
  if (!a) redirect(`/s/${schoolSlug}/exam/${examId}`);
  a = (await finishIfOverdue(scope, a)) ?? a;
  // Finished attempts go back to the lobby, which shows the "submitted" screen.
  if (a.status !== "in_progress") redirect(`/s/${schoolSlug}/exam/${examId}`);

  const payload = await buildPayload(scope, a, { school, student, schoolSlug, className: await classNameOf(scope, student.classArmId) });
  return <ExamRuntime payload={payload} />;
}
