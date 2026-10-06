import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ResetPasswordButton } from "@/components/students/reset-password-button";
import { StudentMoves } from "@/components/students/student-moves";
import { buttonVariants } from "@/components/ui/button";
import { can } from "@/lib/auth/permissions";
import { armsOf } from "@/lib/school/setup";
import { listStudents } from "@/lib/students/list";
import { requireStaff } from "@/lib/tenant/context";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Students" };

export default async function StudentsPage({ params, searchParams }: PageProps<"/s/[schoolSlug]/students">) {
  const { schoolSlug } = await params;
  const sp = await searchParams;
  const ctx = await requireStaff(schoolSlug);
  const isAdmin = can(ctx.actor, "student.manage", { schoolId: ctx.school.id });
  // Form teachers see (and can reset passwords for) their own class only.
  const ownArms = ctx.actor.roles.filter((r) => r.role === "form_teacher" && r.classArmId).map((r) => r.classArmId!);
  if (!isAdmin && !ownArms.length) notFound();

  const arms = (await armsOf(ctx.scope)).filter((a) => isAdmin || ownArms.includes(a.id));
  const classFilter = typeof sp.class === "string" && arms.some((a) => a.id === sp.class) ? sp.class : null;
  const q = typeof sp.q === "string" ? sp.q : "";
  const status = isAdmin && (sp.status === "graduated" || sp.status === "left") ? sp.status : "active";
  const rows = await listStudents(ctx.scope, {
    classArmIds: status !== "active" ? null : classFilter ? [classFilter] : isAdmin ? null : ownArms,
    q,
    status,
  });
  const STATUS_TABS = [
    ["active", "On the register"],
    ["graduated", "Graduated"],
    ["left", "Left"],
  ] as const;

  return (
    <main className="flex min-w-0 flex-col gap-5 p-4 lg:p-8">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-auto sm:flex-1">
          <h1 className="text-[28px] font-extrabold">Students</h1>
          <p className="text-sm text-ink-2">
            {rows.length === 500 ? "Showing the first 500 — search or pick a class to narrow down." : `${rows.length} shown`}
          </p>
        </div>
        {isAdmin && (
          <>
            <Link href={`/s/${schoolSlug}/students/promote`} className={cn(buttonVariants({ variant: "outline", size: "md" }))}>
              Promote to next class
            </Link>
            <Link href={`/s/${schoolSlug}/students/import`} className={cn(buttonVariants({ size: "md" }))}>
              Import students
            </Link>
          </>
        )}
      </div>

      {isAdmin && (
        <nav aria-label="Student status" className="flex gap-1">
          {STATUS_TABS.map(([k, label]) => (
            <Link key={k} href={k === "active" ? "?" : `?status=${k}`} aria-current={status === k ? "page" : undefined} className={cn("flex h-10 items-center rounded-md px-3 text-sm font-semibold text-foreground no-underline", status === k ? "bg-ink text-white" : "bg-card")}>
              {label}
            </Link>
          ))}
        </nav>
      )}

      <form className="flex flex-wrap gap-2" role="search">
        {status !== "active" && <input type="hidden" name="status" value={status} />}
        <input
          name="q"
          defaultValue={q}
          placeholder="Search name or admission no."
          aria-label="Search students"
          className="h-11 w-full min-w-0 rounded-md border-[1.5px] border-input bg-card px-3 text-sm sm:w-auto sm:flex-1 sm:max-w-xs"
        />
        <select
          name="class"
          defaultValue={classFilter ?? ""}
          aria-label="Class"
          className="h-11 min-w-0 flex-1 rounded-md border-[1.5px] border-input bg-card px-2 text-sm sm:flex-none"
        >
          {isAdmin && <option value="">All classes</option>}
          {arms.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "md" }))}>
          Show
        </button>
      </form>

      {rows.length ? (
        <div className="relative overflow-x-auto rounded-lg border border-border bg-card">
          <table className="stack-table w-full min-w-[720px] text-sm">
            <thead>
              <tr className="h-10 bg-secondary text-left text-xs font-bold text-ink-2">
                <th className="px-4">Name</th>
                <th className="px-2">Admission no.</th>
                <th className="px-2">Class</th>
                <th className="px-2">Guardian phone</th>
                <th className="px-2">{status === "active" ? "Sign-in" : status === "graduated" ? "Graduated" : "Left"}</th>
                <th className="px-4 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="h-12 border-t border-divider">
                  <td className="px-4 font-semibold">{r.name}</td>
                  <td data-label="Adm." className="px-2 font-mono text-[13px]">{r.admissionNo}</td>
                  <td data-label="Class" className="px-2">{r.className ?? "—"}</td>
                  <td data-label="Guardian" className="px-2 font-mono text-[13px]">{r.guardianPhone ?? "—"}</td>
                  <td data-cell="full" className="px-2 text-[13px] text-muted-foreground">
                    {r.status === "active" ? (r.pendingFirstSignIn ? "Starting password" : "Own password") : [r.leftOn ? r.leftOn.split("-").reverse().join("/") : null, r.leftReason].filter(Boolean).join(" · ")}
                  </td>
                  <td data-cell="full" className="px-4">
                    <span className="flex flex-wrap justify-end gap-2">
                      {r.status === "active" && <ResetPasswordButton slug={schoolSlug} studentId={r.id} name={r.name} />}
                      {isAdmin && <StudentMoves slug={schoolSlug} student={{ id: r.id, name: r.name, classArmId: r.classArmId, status: r.status }} arms={arms.map((a) => ({ id: a.id, name: a.name }))} />}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-ink-2">
          {q || classFilter ? "No students match." : "No students yet."}{" "}
          {isAdmin && !q && (
            <Link href={`/s/${schoolSlug}/students/import`} className="font-semibold text-foreground underline">
              Import your class lists
            </Link>
          )}
        </p>
      )}
    </main>
  );
}
