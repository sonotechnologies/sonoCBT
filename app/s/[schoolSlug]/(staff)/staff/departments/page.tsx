import type { Metadata } from "next";
import Link from "next/link";
import { asc } from "drizzle-orm";
import { subject } from "@/lib/db/schema";
import { listDepartments } from "@/lib/school/departments";
import { listStaff } from "@/lib/staff/list";
import { requireCan } from "@/lib/tenant/context";
import { DepartmentEditor } from "./department-editor";

export const metadata: Metadata = { title: "Departments" };

export default async function DepartmentsPage({ params }: PageProps<"/s/[schoolSlug]/staff/departments">) {
  const { schoolSlug } = await params;
  const { scope } = await requireCan(schoolSlug, "staff.manage");
  const [departments, subjects, staffRows] = await Promise.all([
    listDepartments(scope),
    scope.query((db, owns) =>
      db.select({ id: subject.id, name: subject.name }).from(subject).where(owns(subject)).orderBy(asc(subject.sortOrder), asc(subject.name)),
    ),
    listStaff(scope),
  ]);
  const staff = staffRows.filter((s) => s.kind === "member").map((s) => ({ id: s.id, name: s.name }));

  return (
    <main className="flex min-w-0 max-w-[960px] flex-col gap-5 p-4 lg:p-8">
      <Link href={`/s/${schoolSlug}/staff`} className="text-sm font-semibold text-ink-2 underline">
        ← Staff
      </Link>
      <div>
        <h1 className="text-[28px] font-extrabold">Departments</h1>
        <p className="text-sm text-ink-2">
          Group subjects and choose a head for each. HODs approve questions for their department&apos;s subjects.
        </p>
      </div>
      {departments.map((d) => {
        const takenBy = Object.fromEntries(
          departments.filter((o) => o.id !== d.id).flatMap((o) => o.subjectIds.map((sid) => [sid, o.name])),
        );
        return <DepartmentEditor key={d.id} slug={schoolSlug} dept={d} subjects={subjects} staff={staff} takenBy={takenBy} />;
      })}
      <DepartmentEditor
        slug={schoolSlug}
        dept={null}
        subjects={subjects}
        staff={staff}
        takenBy={Object.fromEntries(departments.flatMap((o) => o.subjectIds.map((sid) => [sid, o.name])))}
      />
    </main>
  );
}
