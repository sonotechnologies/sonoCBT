import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ImportReview } from "@/components/import/import-review";
import { aiConfigured } from "@/lib/ai";
import { classLevel, subject } from "@/lib/db/schema";
import { getImportJob } from "@/lib/import/service";
import { canReview } from "@/lib/questions/service";
import { requireCan } from "@/lib/tenant/context";

export const metadata: Metadata = { title: "Review import" };

export default async function ImportReviewPage({ params }: PageProps<"/s/[schoolSlug]/import/[id]">) {
  const { schoolSlug, id } = await params;
  const ctx = await requireCan(schoolSlug, "question.create");
  const job = await getImportJob(ctx.scope, ctx.actor, id);
  if (!job || job.status === "discarded") notFound();
  const [subj, level, approves] = await Promise.all([
    ctx.scope.findFirst(subject, eq(subject.id, job.subjectId)),
    job.classLevelId ? ctx.scope.findFirst(classLevel, eq(classLevel.id, job.classLevelId)) : undefined,
    canReview(ctx.scope, ctx.actor, job.subjectId),
  ]);

  return (
    <main className="flex h-[calc(100dvh-3.5rem)] min-w-0 flex-1 flex-col">
      <ImportReview
        slug={schoolSlug}
        jobId={job.id}
        kind={job.kind}
        title={job.title}
        context={[level?.code, subj?.name].filter(Boolean).join(" ")}
        initialItems={job.items}
        passages={job.passages}
        sourceHtml={job.sourceHtml}
        notes={job.notes}
        approves={approves}
        aiReady={aiConfigured()}
      />
    </main>
  );
}
