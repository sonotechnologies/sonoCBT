import type { Metadata } from "next";
import { getBilling } from "@/lib/billing/context";
import { hasFeature } from "@/lib/billing/state";
import { notFound } from "next/navigation";
import { MarkingClient } from "@/components/marking/marking-client";
import { MarkingError, markingSession } from "@/lib/marking/service";
import { requireStaff } from "@/lib/tenant/context";

export const metadata: Metadata = { title: "Theory marking" };

export default async function MarkingSessionPage({ params, searchParams }: PageProps<"/s/[schoolSlug]/marking/[examQuestionId]">) {
  const { schoolSlug, examQuestionId } = await params;
  const sp = await searchParams;
  const ctx = await requireStaff(schoolSlug);
  const showNames = sp.names === "1";
  let data: Awaited<ReturnType<typeof markingSession>>;
  try {
    data = await markingSession(ctx.scope, ctx.actor, examQuestionId, { showNames });
  } catch (e) {
    if (e instanceof MarkingError) notFound();
    throw e;
  }
  if (data.exam.aiMarking && !hasFeature(await getBilling(ctx.school.id), "ai_assistant")) data = { ...data, exam: { ...data.exam, aiMarking: false } };
  return <MarkingClient key={`${examQuestionId}:${showNames}`} slug={schoolSlug} data={data} showNames={showNames && data.canShowNames} />;
}
