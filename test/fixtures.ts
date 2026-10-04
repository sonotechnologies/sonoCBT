import { createStaffAccount, createStudentAccount } from "@/lib/accounts";
import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import type { TenantTable } from "@/lib/tenant/scope";

export const PASSWORD = "correct-horse-battery";

/**
 * One school with a row in every tenant-owned table. Both schools deliberately
 * reuse the same admission number so cross-school logins can be tested.
 */
export async function seedSchoolFixture(db: Db, tag: string) {
  const [school] = await db.insert(t.school).values({ name: `School ${tag}`, slug: `school-${tag}` }).returning();
  const schoolId = school.id;
  const one = async <T extends TenantTable>(table: T, values: Record<string, unknown>) => {
    const [row] = (await db
      .insert(table)
      .values({ ...values, schoolId } as never)
      .returning()) as { id: string }[];
    return row.id;
  };

  const staff = await createStaffAccount(db, {
    schoolId,
    name: `Admin ${tag}`,
    email: `admin@${tag}.test`,
    password: PASSWORD,
    roles: [{ role: "school_admin" }],
  });

  const academicSession = await one(t.academicSession, { name: "2025/2026", isCurrent: true });
  const term = await one(t.term, { sessionId: academicSession, number: 3, isCurrent: true });
  const classLevel = await one(t.classLevel, { code: "JSS3", sortOrder: 3 });
  const classArm = await one(t.classArm, { classLevelId: classLevel, name: "JSS3B" });
  const department = await one(t.department, { name: "Sciences" });
  const subject = await one(t.subject, { name: "Mathematics", departmentId: department });
  const subjectOffering = await one(t.subjectOffering, { subjectId: subject, classArmId: classArm, teacherId: staff.id });

  const { student } = await createStudentAccount(db, {
    schoolId,
    admissionNo: "GFA/2021/0147",
    firstName: "Chiamaka",
    lastName: `Okafor-${tag}`,
    classArmId: classArm,
    password: `${PASSWORD}-${tag}`,
    mustChangePassword: false,
  });

  const enrollment = await one(t.enrollment, { studentId: student.id, termId: term, classArmId: classArm });
  const now = new Date();
  const exam = await one(t.exam, {
    termId: term,
    title: "Mock",
    type: "mock",
    durationMinutes: 90,
    windowStart: now,
    windowEnd: new Date(now.getTime() + 3 * 3600_000),
  });
  const examSection = await one(t.examSection, { examId: exam, title: "A", sortOrder: 1, questionCount: 10, marks: 10 });
  const examSubject = await one(t.examSubject, { examId: exam, subjectId: subject });
  const examAssignment = await one(t.examAssignment, { examId: exam, classArmId: classArm });
  const examCandidate = await one(t.examCandidate, { examId: exam, studentId: student.id, seat: "14" });
  const attempt = await one(t.attempt, {
    examId: exam,
    studentId: student.id,
    startedAt: now,
    deadlineAt: new Date(now.getTime() + 90 * 60_000),
  });
  const gradingScale = await one(t.gradingScale, { name: "WAEC", isDefault: true });
  const gradeBand = await one(t.gradeBand, { scaleId: gradingScale, min: 75, max: 100, grade: "A1", remark: "Excellent" });
  const assessmentComponent = await one(t.assessmentComponent, { termId: term, name: "Exam", weight: 60, sortOrder: 2 });
  const scoreEntry = await one(t.scoreEntry, {
    termId: term,
    studentId: student.id,
    subjectId: subject,
    componentId: assessmentComponent,
    value: 48,
  });
  const resultBatch = await one(t.resultBatch, { termId: term, classArmId: classArm, status: "released" });
  const reportCardExtras = await one(t.reportCardExtras, { termId: term, studentId: student.id, daysPresent: 60 });
  const resultPin = await one(t.resultPin, { termId: term, serial: `SN-${tag}`, pinHash: `hash-${tag}` });
  const reportCardCode = await one(t.reportCardCode, { termId: term, studentId: student.id, code: `RC-${tag}` });
  const subscription = await one(t.subscription, { termId: term, plan: "standard", studentCount: 1, pricePerStudent: 90000, amount: 90000, reference: `SUB-${tag}` });
  const staffInvite = await one(t.staffInvite, {
    name: "Mr. Emeka Nwosu",
    email: `e.nwosu@${tag}.test`,
    roles: [{ role: "teacher" }],
    tokenHash: `invite-${tag}`,
    expiresAt: new Date(now.getTime() + 7 * 86400_000),
  });
  const doc = { type: "doc" as const, content: [{ type: "paragraph", content: [{ type: "text", text: "What is 2 + 2?" }] }] };
  const topic = await one(t.topic, { subjectId: subject, classLevelId: classLevel, name: "Arithmetic" });
  const passage = await one(t.passage, { subjectId: subject, title: "Market day", content: doc, contentText: "Market day" });
  const question = await one(t.question, {
    number: 1,
    subjectId: subject,
    classLevelId: classLevel,
    topicId: topic,
    passageId: passage,
    type: "mcq_single",
    stem: doc,
    stemText: "What is 2 + 2?",
    answer: { kind: "mcq_single" },
    authorId: staff.id,
  });
  const questionOption = await one(t.questionOption, { questionId: question, label: "A", content: doc, contentText: "4", isCorrect: true, sortOrder: 1 });
  const questionStats = await one(t.questionStats, { questionId: question, timesUsed: 1 });
  const importJob = await one(t.importJob, { kind: "word", title: "Mock.docx", subjectId: subject, items: [] });
  const staffProfile = (await db.select().from(t.staffProfile)).find((p) => p.schoolId === schoolId)!.id;
  const examSectionItem = await one(t.examSectionItem, { examId: exam, sectionId: examSection, questionId: question, sortOrder: 1 });
  const examDrawRule = await one(t.examDrawRule, { examId: exam, sectionId: examSection, subjectId: subject, count: 5 });
  const examQuestion = await one(t.examQuestion, {
    examId: exam,
    sectionId: examSection,
    questionId: question,
    sortOrder: 1,
    marks: 1,
    snapshot: { type: "mcq_single", stem: doc, options: [], answer: { kind: "mcq_single" }, passage: null, code: "MTH-0001", topicName: null },
  });
  const examPin = await one(t.examPin, { examId: exam, studentId: student.id, pinHash: `pin-${tag}`, pinSealed: "sealed" });
  const attemptAnswer = await one(t.attemptAnswer, { attemptId: attempt, examQuestionId: examQuestion, clientSeq: 1, answeredAt: now });
  const integrityEvent = await one(t.integrityEvent, { attemptId: attempt, type: "tab_hidden", clientSeq: 1, at: now, meta: { awayMs: 8000 } });

  const ids = {
    academicSession,
    term,
    classLevel,
    classArm,
    department,
    subject,
    subjectOffering,
    staffProfile,
    student: student.id,
    enrollment,
    exam,
    examSection,
    examSubject,
    examAssignment,
    examCandidate,
    attempt,
    gradingScale,
    gradeBand,
    assessmentComponent,
    scoreEntry,
    resultBatch,
    reportCardExtras,
    resultPin,
    reportCardCode,
    subscription,
    staffInvite,
    topic,
    passage,
    question,
    questionOption,
    questionStats,
    importJob,
    examSectionItem,
    examDrawRule,
    examQuestion,
    examPin,
    attemptAnswer,
    integrityEvent,
  };
  return { school, staff, student, ids };
}

/** Every tenant-owned table, keyed like the fixture ids. */
export const TENANT_TABLES = {
  academicSession: t.academicSession,
  term: t.term,
  classLevel: t.classLevel,
  classArm: t.classArm,
  department: t.department,
  subject: t.subject,
  subjectOffering: t.subjectOffering,
  staffProfile: t.staffProfile,
  student: t.student,
  enrollment: t.enrollment,
  exam: t.exam,
  examSection: t.examSection,
  examSubject: t.examSubject,
  examAssignment: t.examAssignment,
  examCandidate: t.examCandidate,
  attempt: t.attempt,
  gradingScale: t.gradingScale,
  gradeBand: t.gradeBand,
  assessmentComponent: t.assessmentComponent,
  scoreEntry: t.scoreEntry,
  resultBatch: t.resultBatch,
  reportCardExtras: t.reportCardExtras,
  resultPin: t.resultPin,
  reportCardCode: t.reportCardCode,
  subscription: t.subscription,
  staffInvite: t.staffInvite,
  topic: t.topic,
  passage: t.passage,
  question: t.question,
  questionOption: t.questionOption,
  questionStats: t.questionStats,
  importJob: t.importJob,
  examSectionItem: t.examSectionItem,
  examDrawRule: t.examDrawRule,
  examQuestion: t.examQuestion,
  examPin: t.examPin,
  attemptAnswer: t.attemptAnswer,
  integrityEvent: t.integrityEvent,
} satisfies Record<string, TenantTable>;
