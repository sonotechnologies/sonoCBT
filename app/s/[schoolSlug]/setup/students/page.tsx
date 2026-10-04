import { StudentImporter } from "@/components/students/student-importer";
import { buttonVariants } from "@/components/ui/button";
import { normaliseAdmissionNo } from "@/lib/auth/student-username";
import { student } from "@/lib/db/schema";
import { armsOf } from "@/lib/school/setup";
import { requireCan } from "@/lib/tenant/context";
import { cn } from "@/lib/utils";
import { finishSetupAction } from "../actions";
import { StepPage } from "../step-shell";

export default async function StudentsStep({ params }: PageProps<"/s/[schoolSlug]/setup/students">) {
  const { schoolSlug } = await params;
  const { scope } = await requireCan(schoolSlug, "school.manage");
  const [arms, existing] = await Promise.all([armsOf(scope), scope.findMany(student)]);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  return (
    <StepPage
      base={`/s/${schoolSlug}/setup`}
      step="students"
      primary={
        <form action={finishSetupAction.bind(null, schoolSlug)}>
          <button type="submit" className={cn(buttonVariants({ size: "lg" }), "px-[22px] text-[15px]")}>
            Finish setup
          </button>
        </form>
      }
    >
      {arms.length ? (
        <StudentImporter
          slug={schoolSlug}
          arms={arms.map((a) => ({ id: a.id, name: a.name }))}
          existingAdmissionNos={existing.map((s) => normaliseAdmissionNo(s.admissionNo))}
          loginUrl={`${appUrl}/s/${schoolSlug}/login`}
        />
      ) : (
        <p className="rounded-lg border border-border bg-card p-4 text-sm text-ink-2">
          Set up your classes first, so we can match each student to a class.
        </p>
      )}
    </StepPage>
  );
}
