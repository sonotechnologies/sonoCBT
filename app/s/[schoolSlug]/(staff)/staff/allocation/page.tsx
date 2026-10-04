import type { Metadata } from "next";
import Link from "next/link";
import { getAllocation } from "@/lib/staff/allocation";
import { requireCan } from "@/lib/tenant/context";
import { TeacherSelect } from "./teacher-select";

export const metadata: Metadata = { title: "Who teaches what" };

export default async function AllocationPage({ params }: PageProps<"/s/[schoolSlug]/staff/allocation">) {
  const { schoolSlug } = await params;
  const { scope } = await requireCan(schoolSlug, "staff.manage");
  const { arms, teachers } = await getAllocation(scope);
  const unassigned = arms.reduce((n, a) => n + a.offerings.filter((o) => !o.teacherId).length, 0);

  return (
    <main className="flex min-w-0 flex-col gap-5 p-4 lg:p-8">
      <Link href={`/s/${schoolSlug}/staff`} className="text-sm font-semibold text-ink-2 underline">
        ← Staff
      </Link>
      <div>
        <h1 className="text-[28px] font-extrabold">Who teaches what</h1>
        <p className="text-sm text-ink-2">
          Teachers enter CA scores and mark theory only for the classes listed against them here.
          {unassigned > 0 && ` ${unassigned} class subjects have no teacher yet.`}
        </p>
      </div>
      {!teachers.length && (
        <p className="rounded-lg border border-border bg-card p-4 text-sm text-ink-2">
          No teachers have joined yet.{" "}
          <Link href={`/s/${schoolSlug}/staff`} className="font-semibold text-foreground underline">
            Invite your teachers
          </Link>{" "}
          first; you can assign classes as soon as they accept.
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {arms.map((arm) => (
          <section key={arm.id} className="rounded-lg border border-border bg-card" aria-labelledby={`arm-${arm.id}`}>
            <h2 id={`arm-${arm.id}`} className="border-b border-divider px-4 py-3 text-[15px] font-extrabold">
              {arm.name}
            </h2>
            <ul>
              {arm.offerings.map((o) => (
                <li key={o.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] items-center gap-3 border-t border-divider px-4 py-2 first:border-t-0">
                  <span className="truncate text-sm font-semibold">{o.subject}</span>
                  <TeacherSelect slug={schoolSlug} offeringId={o.id} label={`${o.subject}, ${arm.name}`} value={o.teacherId} teachers={teachers} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
