"use server";

import { and, desc, eq, gt } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { studentUsername } from "@/lib/auth/student-username";
import { getDb } from "@/lib/db";
import { exam, student } from "@/lib/db/schema";
import { releasedTermsFor } from "@/lib/results/report-card";
import { createResultToken, RESULT_COOKIE, RESULT_TTL_SECONDS } from "@/lib/results/token";
import { tenantScope } from "@/lib/tenant/scope";
import { DEMO_PARENT_CHILD, DEMO_PEOPLE, DEMO_SLUG, DEMO_STAFF_PASSWORD, DEMO_STUDENT_PASSWORD, demoEnabled } from "./config";
import { createDemoVisitor, demoSchool, DemoError } from "./service";

export type DemoRole = "admin" | "examOfficer" | "teacher" | "student" | "parent";

/** One click on /demo: signs the visitor in to the demo school in that role. No sign-up. */
export async function enterDemoAction(role: DemoRole) {
  if (!demoEnabled()) redirect("/demo?error=off");
  const db = getDb();
  const s = await demoSchool(db);
  if (!s) redirect("/demo?error=missing");
  const base = `/s/${DEMO_SLUG}`;

  if (role === "parent") {
    const [child] = await db.select().from(student).where(and(eq(student.schoolId, s.id), eq(student.admissionNo, DEMO_PARENT_CHILD)));
    const termId = child ? (await releasedTermsFor(tenantScope(db, s.id), child.id))[0]?.termId : undefined;
    if (!child || !termId) redirect("/demo?error=missing");
    (await cookies()).set(RESULT_COOKIE, createResultToken({ schoolId: s.id, studentId: child.id, termId }), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/results",
      maxAge: RESULT_TTL_SECONDS,
    });
    redirect("/results/view");
  }

  if (role === "student") {
    let admissionNo: string;
    try {
      ({ admissionNo } = await createDemoVisitor(db));
    } catch (e) {
      if (e instanceof DemoError) redirect(`/demo?error=${encodeURIComponent(e.message)}`);
      throw e;
    }
    await getAuth().api.signInUsername({ body: { username: studentUsername(s.id, admissionNo), password: DEMO_STUDENT_PASSWORD }, headers: await headers() });
    redirect(`${base}/student`);
  }

  const who = role === "admin" ? DEMO_PEOPLE.admin : role === "examOfficer" ? DEMO_PEOPLE.examOfficer : DEMO_PEOPLE.teacher;
  await getAuth().api.signInEmail({ body: { email: who.email, password: DEMO_STAFF_PASSWORD }, headers: await headers() });
  if (role === "examOfficer") {
    // Straight to the live monitor of the exam that's open now.
    const [live] = await db
      .select({ id: exam.id })
      .from(exam)
      .where(and(eq(exam.schoolId, s.id), eq(exam.status, "scheduled"), gt(exam.windowEnd, new Date())))
      .orderBy(desc(exam.windowStart))
      .limit(1);
    redirect(live ? `${base}/exams/${live.id}/monitor` : `${base}/monitor`);
  }
  redirect(role === "teacher" ? `${base}/marking` : `${base}/dashboard`);
}
