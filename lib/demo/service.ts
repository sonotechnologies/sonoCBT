import "server-only";
import { randomInt } from "node:crypto";
import { and, eq, gt, inArray, like, sql } from "drizzle-orm";
import { createStudentAccount } from "@/lib/accounts";
import type { Db } from "@/lib/db/client";
import { classArm, enrollment, exam, examAssignment, examCandidate, school, student, term } from "@/lib/db/schema";
import { DEMO_SLUG, DEMO_STUDENT_PASSWORD } from "./config";

export class DemoError extends Error {}

const NAMES = ["Tolu", "Ada", "Musa", "Ifeoma", "Kunle", "Zainab", "Chidi", "Bisi", "Femi", "Halima", "Obinna", "Yemi"];
/** Visitors per day before the demo stops making new students (they're wiped nightly anyway). */
const DAILY_CAP = 3000;

export async function demoSchool(db: Db) {
  const [s] = await db.select().from(school).where(and(eq(school.slug, DEMO_SLUG), eq(school.isDemo, true)));
  return s ?? null;
}

/**
 * A fresh student for each demo visitor, in JSS3A and seated for any exam open
 * now, so everyone can sit the mock without bumping into someone else's attempt.
 */
export async function createDemoVisitor(db: Db, now = new Date()) {
  const s = await demoSchool(db);
  if (!s) throw new DemoError("The demo school isn't set up on this server.");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(student).where(and(eq(student.schoolId, s.id), like(student.admissionNo, "DEMO/%")));
  if (n >= DAILY_CAP) throw new DemoError("The demo is very busy today. Try again tomorrow.");
  const [arm] = await db.select().from(classArm).where(and(eq(classArm.schoolId, s.id), eq(classArm.name, "JSS3A")));
  const [cur] = await db.select().from(term).where(and(eq(term.schoolId, s.id), eq(term.isCurrent, true)));
  if (!arm || !cur) throw new DemoError("The demo school isn't set up on this server.");
  const admissionNo = `DEMO/${now.getUTCFullYear()}/${String(randomInt(0, 1_000_000)).padStart(6, "0")}`;
  const { student: st } = await createStudentAccount(db, {
    schoolId: s.id,
    admissionNo,
    firstName: NAMES[randomInt(0, NAMES.length)],
    lastName: "Visitor",
    classArmId: arm.id,
    password: DEMO_STUDENT_PASSWORD,
    mustChangePassword: false,
  });
  await db.insert(enrollment).values({ schoolId: s.id, studentId: st.id, termId: cur.id, classArmId: arm.id });
  const open = await db
    .select({ id: exam.id })
    .from(exam)
    .innerJoin(examAssignment, and(eq(examAssignment.examId, exam.id), eq(examAssignment.classArmId, arm.id)))
    .where(and(eq(exam.schoolId, s.id), inArray(exam.status, ["scheduled", "live"]), gt(exam.windowEnd, now)));
  for (const e of open) {
    const [{ seats }] = await db.select({ seats: sql<number>`count(*)::int` }).from(examCandidate).where(eq(examCandidate.examId, e.id));
    await db.insert(examCandidate).values({ schoolId: s.id, examId: e.id, studentId: st.id, seat: String(seats + 1).padStart(2, "0") });
  }
  return { schoolId: s.id, admissionNo };
}
