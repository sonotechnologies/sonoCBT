import type { Metadata } from "next";
import Link from "next/link";
import { StudentImporter } from "@/components/students/student-importer";
import { normaliseAdmissionNo } from "@/lib/auth/student-username";
import { student } from "@/lib/db/schema";
import { armsOf } from "@/lib/school/setup";
import { requireCan } from "@/lib/tenant/context";

export const metadata: Metadata = { title: "Import students" };

export default async function ImportStudentsPage({ params }: PageProps<"/s/[schoolSlug]/students/import">) {
  const { schoolSlug } = await params;
  const { scope } = await requireCan(schoolSlug, "student.manage");
  const [arms, existing] = await Promise.all([armsOf(scope), scope.findMany(student)]);
  return (
    <main className="flex min-w-0 max-w-[860px] flex-col gap-2 p-4 lg:p-8">
      <Link href={`/s/${schoolSlug}/students`} className="text-sm font-semibold text-ink-2 underline">
        ← Students
      </Link>
      <h1 className="text-[28px] font-extrabold">Import students</h1>
      <p className="mb-6 text-base text-ink-2">Upload a class list. We match names to classes and flag anything unclear.</p>
      <StudentImporter
        slug={schoolSlug}
        arms={arms.map((a) => ({ id: a.id, name: a.name }))}
        existingAdmissionNos={existing.map((s) => normaliseAdmissionNo(s.admissionNo))}
        loginUrl={`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/s/${schoolSlug}/login`}
      />
    </main>
  );
}
