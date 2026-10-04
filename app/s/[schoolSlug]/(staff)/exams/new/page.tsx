import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DetailsForm } from "@/components/exams/details-form";
import { can } from "@/lib/auth/permissions";
import { builderChoices } from "@/lib/exams/builder-data";
import { requireStaff } from "@/lib/tenant/context";

export const metadata: Metadata = { title: "New exam" };

export default async function NewExamPage({ params, searchParams }: PageProps<"/s/[schoolSlug]/exams/new">) {
  const { schoolSlug } = await params;
  const sp = await searchParams;
  const ctx = await requireStaff(schoolSlug);
  // Admins and exam officers, or an HOD for their department's subjects.
  if (!ctx.actor.roles.some((r) => r.role === "hod") && !can(ctx.actor, "exam.manage", { schoolId: ctx.school.id })) notFound();
  const choices = await builderChoices(ctx.scope);
  const current = choices.terms.find((t) => t.isCurrent) ?? choices.terms[0];
  const subject = typeof sp.subject === "string" && choices.subjects.some((s) => s.id === sp.subject) ? [sp.subject] : [];

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <div className="border-b border-border bg-card px-4 py-5 lg:px-8">
        <div className="text-[13px] font-semibold text-muted-foreground">Exams · New exam</div>
        <h1 className="mt-0.5 text-2xl font-extrabold">New exam</h1>
      </div>
      <div className="p-4 lg:p-8">
        {!current ? (
          <p className="text-sm text-ink-2">Set up a session and term first (School setup → Session).</p>
        ) : (
          <DetailsForm
            slug={schoolSlug}
            choices={choices}
            initial={{ title: "", series: "", fullTitle: "", type: "ca_test", termId: current.id, subjectIds: subject, classArmIds: [], durationMinutes: 40, calculator: "off", instructions: "", componentId: null, aiMarking: false }}
          />
        )}
      </div>
    </main>
  );
}
