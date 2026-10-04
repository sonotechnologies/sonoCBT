/**
 * Seed skeleton (Phase 0). Wipes the database and creates:
 *  - Greenfield Academy, Lekki — the school in the designs (Chiamaka Okafor, JSS3B)
 *  - Crestview Model College, Ibadan — the public demo school (one-click roles,
 *    rebuilt nightly), also a second tenant for isolation checks
 *
 * Exam times are relative to when the seed runs, so the student home always
 * shows an exam opening shortly. Demo passwords are listed at the bottom.
 */
import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { createPlatformOwner, createStaffAccount, createStudentAccount } from "@/lib/accounts";
import { createDb, type Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { lagosDayKey } from "@/lib/format";
import { WAEC_BANDS } from "@/lib/grading";
import { AFFECTIVE, PSYCHOMOTOR, suggestPrincipalRemark } from "@/lib/results/extras-model";
import { formatPin, hashPin } from "@/lib/results/pin";
import type { Actor } from "@/lib/auth/permissions";
import type { QuestionInput } from "@/lib/questions/model";
import { saveQuestion } from "@/lib/questions/service";
import { seedDemoSchool } from "./demo/seed-demo";
import { seedCompletedExams } from "./seed-analytics";
import { seedPaperOne } from "./seed-paper1";
import { tenantScope, type TenantTable } from "@/lib/tenant/scope";

config({ path: [".env.local", ".env"], quiet: true });

export const DEMO_STAFF_PASSWORD = "sonocbt-staff-demo";
export const DEMO_STUDENT_PASSWORD = "sonocbt-student";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** A wall-clock time in Lagos (UTC+1, no DST) `dayOffset` days from today. */
function lagosAt(dayOffset: number, hh: number, mm: number): Date {
  const [y, m, d] = lagosDayKey(new Date()).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + dayOffset, hh - 1, mm));
}

/** Deterministic PRNG so every seed produces the same class. */
function prng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
}

async function one<T extends TenantTable>(db: Db, table: T, values: Record<string, unknown>) {
  const [row] = (await db.insert(table).values(values as never).returning()) as { id: string }[];
  return row.id;
}

const OTHER_STUDENTS: [string, string, "female" | "male"][] = [
  ["Abdulrahman", "Bello", "male"],
  ["Oluwaseun", "Adeyemi", "male"],
  ["Ngozi", "Eze", "female"],
  ["Tobiloba", "Ogunleye", "male"],
  ["Aisha", "Mohammed", "female"],
  ["Emeka", "Nwosu", "male"],
  ["Temitope", "Balogun", "female"],
  ["Ifeanyi", "Obi", "male"],
  ["Zainab", "Yusuf", "female"],
  ["Chukwudi", "Okeke", "male"],
  ["Funke", "Akinola", "female"],
  ["Ibrahim", "Sani", "male"],
  ["Adaeze", "Umeh", "female"],
  ["Segun", "Oladipo", "male"],
  ["Halima", "Garba", "female"],
  ["Kelechi", "Onyeka", "male"],
  ["Bukola", "Fashola", "female"],
  ["Musa", "Abubakar", "male"],
  ["Chioma", "Nnaji", "female"],
  ["Damilola", "Ajayi", "female"],
  ["Uche", "Ibe", "male"],
  ["Hauwa", "Idris", "female"],
  ["Tunde", "Bakare", "male"],
  ["Nkechi", "Agu", "female"],
  ["Yetunde", "Oyelaran", "female"],
  ["Obinna", "Chukwu", "male"],
  ["Fatima", "Lawal", "female"],
  ["Babatunde", "Salami", "male"],
  ["Amarachi", "Iwu", "female"],
  ["Kayode", "Adebisi", "male"],
  ["Rukayat", "Olatunji", "female"],
  ["Chinedu", "Anyanwu", "male"],
  ["Esther", "Okon", "female"],
  ["Samuel", "Etim", "male"],
  ["Blessing", "Udo", "female"],
  ["Victor", "Ekpo", "male"],
  ["Mariam", "Aliyu", "female"],
];

/** JSS3A, so analytics can compare two classes. */
const JSS3A_STUDENTS: [string, string, "female" | "male"][] = [
  ["Adebayo", "Ogunbiyi", "male"],
  ["Ifeoma", "Nwachukwu", "female"],
  ["Sadiq", "Usman", "male"],
  ["Titilayo", "Adeleke", "female"],
  ["Nnamdi", "Eze", "male"],
  ["Habiba", "Suleiman", "female"],
  ["Olumide", "Coker", "male"],
  ["Ebere", "Okafor", "female"],
  ["Yakubu", "Danjuma", "male"],
  ["Folasade", "Ibikunle", "female"],
  ["Chidi", "Obiora", "male"],
  ["Rahma", "Bello", "female"],
  ["Gbenga", "Alabi", "male"],
  ["Ngozi", "Okonkwo", "female"],
  ["Aliyu", "Garba", "male"],
  ["Morenike", "Fadahunsi", "female"],
  ["Emmanuel", "Akpan", "male"],
  ["Kemi", "Oyebanji", "female"],
  ["Ikenna", "Ugwu", "male"],
  ["Salamatu", "Abdullahi", "female"],
  ["Tosin", "Adewale", "male"],
  ["Uchenna", "Mbah", "female"],
  ["Rotimi", "Falana", "male"],
  ["Precious", "Edet", "female"],
];

export async function seedGreenfield(db: Db) {
  const [school] = await db
    .insert(t.school)
    .values({
      name: "Greenfield Academy",
      slug: "greenfield-academy",
      locality: "Lekki",
      address: "14 Admiralty Way, Lekki Phase 1, Lagos",
      motto: "Knowledge, Discipline and Service",
      state: "Lagos",
      phone: "08034127788",
      email: "info@greenfieldacademy.ng",
      principalName: "Mrs. Adunni Ogundipe",
      brandColor: "#1B5E3A",
      plan: "standard",
      status: "active",
      onboardingCompletedAt: new Date(),
    })
    .returning();
  const schoolId = school.id;
  const ins = <T extends TenantTable>(table: T, v: Record<string, unknown>) => one(db, table, { ...v, schoolId });

  // Sessions and terms: last session's 3rd term is released; we are in 1st term 2026/2027.
  const s2526 = await ins(t.academicSession, { name: "2025/2026", startsOn: "2025-09-15", endsOn: "2026-07-24" });
  const s2627 = await ins(t.academicSession, { name: "2026/2027", startsOn: "2026-09-14", isCurrent: true });
  const t3Last = await ins(t.term, {
    sessionId: s2526,
    number: 3,
    startsOn: "2026-04-27",
    endsOn: "2026-07-24",
    nextResumesOn: "2026-09-14",
  });
  const t1Now = await ins(t.term, {
    sessionId: s2627,
    number: 1,
    startsOn: "2026-09-14",
    endsOn: "2026-12-18",
    isCurrent: true,
  });

  // Classes
  const levels: Record<string, string> = {};
  const arms: Record<string, string> = {};
  for (const [i, code] of ["JSS1", "JSS2", "JSS3", "SS1", "SS2", "SS3"].entries()) {
    levels[code] = await ins(t.classLevel, { code, sortOrder: i + 1 });
    for (const arm of ["A", "B"]) arms[`${code}${arm}`] = await ins(t.classArm, { classLevelId: levels[code], name: `${code}${arm}` });
  }

  // Departments and subjects
  const sciences = await ins(t.department, { name: "Sciences" });
  const arts = await ins(t.department, { name: "Arts & Humanities" });
  const subjects: Record<string, string> = {};
  for (const [name, shortName, dept, stage] of [
    ["English Language", "English", arts, "all"],
    ["Mathematics", "Maths", sciences, "all"],
    ["Basic Science", "Basic Science", sciences, "jss"],
    ["Basic Technology", "Basic Tech", sciences, "jss"],
    ["Social Studies", "Social Studies", arts, "jss"],
    ["Civic Education", "Civic", arts, "all"],
    ["Yoruba", "Yoruba", arts, "jss"],
    ["Business Studies", "Business", arts, "jss"],
    ["French", "French", arts, "jss"],
  ] as const) {
    subjects[name] = await ins(t.subject, { name, shortName, departmentId: dept, stage, sortOrder: Object.keys(subjects).length + 1 });
  }

  // Staff
  const admin = await createStaffAccount(db, {
    schoolId,
    name: "Dr. Adewale Ogunleye",
    title: "Dr.",
    email: "proprietor@greenfieldacademy.ng",
    password: DEMO_STAFF_PASSWORD,
    roles: [{ role: "school_admin" }],
  });
  await createStaffAccount(db, {
    schoolId,
    name: "Mrs. Funmilayo Adebayo",
    title: "Mrs.",
    email: "f.adebayo@greenfieldacademy.ng",
    password: DEMO_STAFF_PASSWORD,
    roles: [{ role: "exam_officer" }],
  });
  const formTeacher = await createStaffAccount(db, {
    schoolId,
    name: "Mr. Ibrahim Musa",
    title: "Mr.",
    email: "i.musa@greenfieldacademy.ng",
    password: DEMO_STAFF_PASSWORD,
    roles: [{ role: "teacher" }, { role: "form_teacher", classArmId: arms.JSS3B }],
  });
  await db.update(t.classArm).set({ formTeacherId: formTeacher.id }).where(sql`${t.classArm.id} = ${arms.JSS3B}`);
  for (const name of Object.keys(subjects)) {
    for (const arm of ["JSS2B", "JSS3B"]) {
      await ins(t.subjectOffering, { subjectId: subjects[name], classArmId: arms[arm], teacherId: formTeacher.id });
    }
  }

  // Students: JSS3B now, JSS2B last session.
  const chiamaka = await createStudentAccount(db, {
    schoolId,
    admissionNo: "GFA/2021/0147",
    firstName: "Chiamaka",
    lastName: "Okafor",
    gender: "female",
    classArmId: arms.JSS3B,
    password: DEMO_STUDENT_PASSWORD,
    mustChangePassword: false,
  });
  const classmates: string[] = [];
  for (const [i, [first, last, gender]] of OTHER_STUDENTS.entries()) {
    const { student } = await createStudentAccount(db, {
      schoolId,
      admissionNo: `GFA/2021/${String(150 + i).padStart(4, "0")}`,
      firstName: first,
      lastName: last,
      gender,
      classArmId: arms.JSS3B,
      password: DEMO_STUDENT_PASSWORD,
    });
    classmates.push(student.id);
  }
  const everyone = [chiamaka.student.id, ...classmates];
  for (const [i, [first, last, gender]] of JSS3A_STUDENTS.entries()) {
    await createStudentAccount(db, {
      schoolId,
      admissionNo: `GFA/2021/${String(200 + i).padStart(4, "0")}`,
      firstName: first,
      lastName: last,
      gender,
      classArmId: arms.JSS3A,
      password: DEMO_STUDENT_PASSWORD,
    });
  }
  await db.insert(t.enrollment).values(
    everyone.flatMap((studentId) => [
      { schoolId, studentId, termId: t3Last, classArmId: arms.JSS2B },
      { schoolId, studentId, termId: t1Now, classArmId: arms.JSS3B },
    ]),
  );

  // Grading scale
  const scale = await ins(t.gradingScale, { name: "WAEC (A1–F9)", isDefault: true });
  await db.insert(t.gradeBand).values(WAEC_BANDS.map((b) => ({ ...b, schoolId, scaleId: scale })));

  // ── 3rd Term 2025/2026 results (released) ───────────────────────────────
  const ca = await ins(t.assessmentComponent, { termId: t3Last, name: "CA", weight: 40, sortOrder: 1 });
  const ex = await ins(t.assessmentComponent, { termId: t3Last, name: "Exam", weight: 60, sortOrder: 2 });
  // This term: the split in the CA grid design.
  const nowComps: Record<string, string> = {};
  for (const [i, [name, weight]] of ([["CA1", 10], ["CA2", 10], ["Assignment", 10], ["Project", 10], ["Exam", 60]] as const).entries()) {
    nowComps[name] = await ins(t.assessmentComponent, { termId: t1Now, name, weight, sortOrder: i + 1 });
  }

  // Chiamaka's scores and each subject's class average, as in the design.
  const design: [string, number, number, number][] = [
    ["English Language", 24, 48, 61],
    ["Mathematics", 30, 52, 58],
    ["Basic Science", 26, 45, 63],
    ["Basic Technology", 22, 40, 55],
    ["Social Studies", 28, 50, 66],
    ["Civic Education", 27, 46, 64],
    ["Yoruba", 20, 38, 52],
    ["Business Studies", 25, 50, 60],
  ];
  const rand = prng(147);
  const [TIE_A, TIE_B] = [2, 3];
  const scoreRows: (typeof t.scoreEntry.$inferInsert)[] = [];
  const push = (studentId: string, subjectId: string, total: number) => {
    const caScore = Math.min(40, Math.round(total * 0.4));
    scoreRows.push(
      { schoolId, termId: t3Last, studentId, subjectId, componentId: ca, value: caScore },
      { schoolId, termId: t3Last, studentId, subjectId, componentId: ex, value: total - caScore },
    );
  };
  for (const [name, caScore, examScore, classAvg] of design) {
    const subjectId = subjects[name];
    const mine = caScore + examScore;
    scoreRows.push(
      { schoolId, termId: t3Last, studentId: chiamaka.student.id, subjectId, componentId: ca, value: caScore },
      { schoolId, termId: t3Last, studentId: chiamaka.student.id, subjectId, componentId: ex, value: examScore },
    );
    // Five classmates finish above Chiamaka (she is 6th of 38); the rest land below
    // so that the subject's class average matches the design exactly.
    const top = [0, 1, 2, 3, 4].map((i) => Math.min(96, mine + 8 + i));
    top.forEach((v, i) => push(classmates[i], subjectId, v));
    const rest = classmates.slice(5);
    const remaining = classAvg * everyone.length - mine - top.reduce((a, b) => a + b, 0);
    const mean = remaining / rest.length;
    // Everyone else stays below Chiamaka's average (max 69) with a realistic spread.
    const [lo, hi] = [15, 69];
    const values = rest.map(() => Math.max(lo, Math.min(hi, Math.round(mean + (rand() - 0.5) * 22))));
    // Two classmates (Ifeanyi Obi and Zainab Yusuf) score the same in every subject,
    // so the class has a tie to show positions working (e.g. 13th, 13th, then 15th).
    values[TIE_B] = values[TIE_A];
    // Nudge integer totals, within bounds, so they sum exactly to the target.
    let diff = remaining - values.reduce((a, b) => a + b, 0);
    for (let i = 0; diff !== 0; i = (i + 1) % values.length) {
      if (i === TIE_A || i === TIE_B) continue;
      const step = Math.sign(diff);
      if (values[i] + step < lo || values[i] + step > hi) continue;
      values[i] += step;
      diff -= step;
    }
    rest.forEach((id, i) => push(id, subjectId, values[i]));
  }
  await db.insert(t.scoreEntry).values(scoreRows);
  await ins(t.resultBatch, {
    termId: t3Last,
    classArmId: arms.JSS2B,
    status: "released",
    releasedAt: new Date("2026-07-31T10:00:00Z"),
    releasedBy: admin.id,
  });
  // Report-card extras for the whole class: ratings, attendance and remarks.
  const extrasRand = prng(61);
  const rating = () => 3 + Math.floor(extrasRand() * 3);
  const termTotals = new Map<string, number[]>();
  for (const r of scoreRows) {
    const key = `${r.studentId}:${r.subjectId}`;
    termTotals.set(key, [...(termTotals.get(key) ?? []), r.value as number]);
  }
  const averageOf = (studentId: string) => {
    const totals = [...termTotals].filter(([k]) => k.startsWith(`${studentId}:`)).map(([, v]) => v.reduce((a, b) => a + b, 0));
    return totals.reduce((a, b) => a + b, 0) / totals.length;
  };
  const TEACHER_REMARKS = [
    "A steady, hard-working student.",
    "Participates well in class. Should read more at home.",
    "Polite and neat. Needs to be more punctual.",
    "Capable, but must stay focused in lessons.",
    "Shows good leadership among classmates.",
  ];
  await db.insert(t.reportCardExtras).values(
    everyone.map((studentId, i) => ({
      schoolId,
      termId: t3Last,
      studentId,
      formTeacherRemark: studentId === chiamaka.student.id ? "Chiamaka is focused and helpful in class. More practice with essay writing." : TEACHER_REMARKS[i % TEACHER_REMARKS.length],
      principalRemark: studentId === chiamaka.student.id ? "A good result. Keep it up." : suggestPrincipalRemark(averageOf(studentId)),
      affective: Object.fromEntries(AFFECTIVE.map((a) => [a.key, rating()])),
      psychomotor: Object.fromEntries(PSYCHOMOTOR.map((a) => [a.key, rating()])),
      daysPresent: studentId === chiamaka.student.id ? 58 : 61 - Math.floor(extrasRand() * 8),
      daysOpened: 61,
    })),
  );

  // 1st and 2nd terms of 2025/2026, also released, so the 3rd-term report card shows the session's totals.
  for (const [number, startsOn, endsOn, releasedAt] of [
    [1, "2025-09-15", "2025-12-12", "2025-12-19T10:00:00Z"],
    [2, "2026-01-05", "2026-04-02", "2026-04-10T10:00:00Z"],
  ] as const) {
    const termId = await ins(t.term, { sessionId: s2526, number, startsOn, endsOn });
    const [caC, exC] = [await ins(t.assessmentComponent, { termId, name: "CA", weight: 40, sortOrder: 1 }), await ins(t.assessmentComponent, { termId, name: "Exam", weight: 60, sortOrder: 2 })];
    await db.insert(t.enrollment).values(everyone.map((studentId) => ({ schoolId, studentId, termId, classArmId: arms.JSS2B })));
    const earlier = prng(100 + number);
    const rows: (typeof t.scoreEntry.$inferInsert)[] = [];
    for (const [key, parts] of termTotals) {
      const [studentId, subjectId] = key.split(":");
      const total = Math.max(12, Math.min(95, parts.reduce((a, b) => a + b, 0) + Math.round((earlier() - 0.5) * 16)));
      const caScore = Math.min(40, Math.round(total * 0.4));
      rows.push(
        { schoolId, termId, studentId, subjectId, componentId: caC, value: caScore },
        { schoolId, termId, studentId, subjectId, componentId: exC, value: total - caScore },
      );
    }
    await db.insert(t.scoreEntry).values(rows);
    await ins(t.resultBatch, { termId, classArmId: arms.JSS2B, status: "released", releasedAt: new Date(releasedAt), releasedBy: admin.id });
  }
  // This term's results are still being prepared: CA1, CA2 and the assignment are in;
  // the project and exam aren't yet (Paper 1 feeds the exam column once it's marked).
  const jssSubjects = Object.keys(subjects).filter((n) => !["French"].includes(n));
  const nowRand = prng(2026);
  const nowRows: (typeof t.scoreEntry.$inferInsert)[] = [];
  for (const studentId of everyone) {
    for (const name of jssSubjects) {
      for (const comp of ["CA1", "CA2", "Assignment"]) {
        nowRows.push({ schoolId, termId: t1Now, studentId, subjectId: subjects[name], componentId: nowComps[comp], value: Math.round(4 + nowRand() * 6) });
      }
    }
  }
  await db.insert(t.scoreEntry).values(nowRows);
  await ins(t.resultBatch, { termId: t1Now, classArmId: arms.JSS3B, status: "draft" });

  // Result-checker PINs
  const pins = [
    { serial: "GFA-3T26-000147", pin: "482177305519", termId: t3Last },
    { serial: "GFA-3T26-000148", pin: "736204918352", termId: t3Last },
    { serial: "GFA-1T27-000001", pin: "915530287746", termId: t1Now },
  ];
  await db
    .insert(t.resultPin)
    .values(pins.map((p) => ({ schoolId, termId: p.termId, serial: p.serial, pinHash: hashPin(schoolId, p.pin) })));

  // ── Exams (1st term 2026/2027) ───────────────────────────────────────────
  const now = Date.now();
  // SEED_EXAM_OPEN=1 opens Paper 1 straight away (end-to-end tests, trying the runtime).
  const opensSoon = process.env.SEED_EXAM_OPEN === "1" ? new Date(now - MIN) : new Date(Math.ceil((now + 12 * MIN) / MIN) * MIN);
  const exams = [
    {
      key: "paper1",
      series: "JSS3 Mock Examination",
      title: "JSS3 Mock · Paper 1",
      fullTitle: "Paper 1 — English, Mathematics & Basic Science",
      type: "mock" as const,
      durationMinutes: 90,
      windowStart: opensSoon,
      windowEnd: new Date(opensSoon.getTime() + 3 * 60 * MIN),
      lateEntryUntil: new Date(opensSoon.getTime() + 30 * MIN),
      venue: "ICT Lab 2",
      subjects: ["English Language", "Mathematics", "Basic Science"],
      // Questions, sections and seats come from seedPaperOne, which publishes it.
      sections: [] as const,
      status: "draft" as const,
      integrity: "strict" as const,
    },
    {
      key: "paper2",
      series: "JSS3 Mock Examination",
      title: "Mock · Paper 2",
      fullTitle: "Paper 2 — Social Studies, Civic Education & Business Studies",
      type: "mock" as const,
      durationMinutes: 90,
      windowStart: lagosAt(2, 9, 30),
      windowEnd: lagosAt(2, 12, 30),
      venue: "ICT Lab 2",
      subjects: ["Social Studies", "Civic Education", "Business Studies"],
      sections: [
        ["Social Studies", 10],
        ["Civic Education", 10],
        ["Business Studies", 10],
      ] as const,
      status: "scheduled" as const,
    },
    {
      key: "basictech",
      title: "Basic Tech CA test",
      fullTitle: "Basic Technology — CA test",
      type: "ca_test" as const,
      durationMinutes: 30,
      windowStart: lagosAt(4, 10, 0),
      windowEnd: lagosAt(4, 12, 0),
      venue: "ICT Lab 1",
      subjects: ["Basic Technology"],
      sections: [["Objectives", 20]] as const,
      status: "scheduled" as const,
      showScoreAfterSubmit: true,
    },
    {
      key: "french",
      title: "French oral practice",
      fullTitle: "French — oral practice",
      type: "practice" as const,
      durationMinutes: 20,
      windowStart: lagosAt(9, 11, 0),
      windowEnd: lagosAt(9, 13, 0),
      subjects: ["French"],
      sections: [["Listening", 10]] as const,
      status: "scheduled" as const,
      graded: false,
      integrity: "practice" as const,
    },
    {
      key: "mathsCa",
      title: "Mathematics CA test 1",
      fullTitle: "Mathematics — CA test 1",
      type: "ca_test" as const,
      durationMinutes: 30,
      windowStart: new Date(now - 10 * DAY),
      windowEnd: new Date(now - 10 * DAY + 2 * 60 * MIN),
      subjects: ["Mathematics"],
      sections: [["Objectives", 20]] as const,
      status: "closed" as const,
      scoresReleasedAt: new Date(now - 8 * DAY),
      score: 17,
    },
    {
      key: "englishCa",
      title: "English CA test 1",
      fullTitle: "English Language — CA test 1",
      type: "ca_test" as const,
      durationMinutes: 30,
      windowStart: new Date(now - 11 * DAY),
      windowEnd: new Date(now - 11 * DAY + 2 * 60 * MIN),
      subjects: ["English Language"],
      sections: [["Objectives", 20]] as const,
      status: "closed" as const,
      scoresReleasedAt: new Date(now - 10 * DAY),
      score: 14,
    },
  ];

  let paperOneId = "";
  const finished = {} as Record<"maths" | "english", { id: string; windowStart: Date }>;
  for (const e of exams) {
    const totalMarks = e.sections.reduce((a: number, [, n]: readonly [string, number]) => a + n, 0);
    const examId = await ins(t.exam, {
      termId: t1Now,
      series: "series" in e ? e.series : null,
      title: e.title,
      fullTitle: e.fullTitle,
      type: e.type,
      durationMinutes: e.durationMinutes,
      windowStart: e.windowStart,
      windowEnd: e.windowEnd,
      lateEntryUntil: "lateEntryUntil" in e ? e.lateEntryUntil : null,
      venue: "venue" in e ? e.venue : null,
      totalMarks,
      graded: "graded" in e ? e.graded : true,
      integrity: "integrity" in e ? e.integrity : "standard",
      showScoreAfterSubmit: "showScoreAfterSubmit" in e ? e.showScoreAfterSubmit : false,
      scoresReleasedAt: "scoresReleasedAt" in e ? e.scoresReleasedAt : null,
      // The finished CA tests are published (then closed) by seedCompletedExams.
      status: e.key === "mathsCa" || e.key === "englishCa" ? "draft" : e.status,
      integritySettings: null,
      componentId: e.key === "paper1" ? nowComps.Exam : null,
      aiMarking: e.key === "paper1",
    });
    await db
      .insert(t.examSubject)
      .values(e.subjects.map((name, i) => ({ schoolId, examId, subjectId: subjects[name], sortOrder: i })));
    await db.insert(t.examAssignment).values({ schoolId, examId, classArmId: arms.JSS3B, venue: "venue" in e ? e.venue : null });
    if (e.key === "paper1") {
      paperOneId = examId;
      continue;
    }
    if (e.key === "mathsCa" || e.key === "englishCa") {
      finished[e.key === "mathsCa" ? "maths" : "english"] = { id: examId, windowStart: e.windowStart };
      continue;
    }
    await db
      .insert(t.examSection)
      .values(e.sections.map(([title, n], i) => ({ schoolId, examId, title, sortOrder: i + 1, questionCount: n, marks: n })));
    await db
      .insert(t.examCandidate)
      .values(everyone.map((studentId, i) => ({ schoolId, examId, studentId, seat: String(i === 0 ? 14 : i < 14 ? i : i + 1) })));
    if ("score" in e) {
      await db.insert(t.attempt).values({
        schoolId,
        examId,
        studentId: chiamaka.student.id,
        startedAt: new Date(e.windowStart.getTime() + 5 * MIN),
        deadlineAt: new Date(e.windowStart.getTime() + 35 * MIN),
        submittedAt: new Date(e.windowStart.getTime() + 28 * MIN),
        status: "submitted",
        score: e.score,
        maxScore: totalMarks,
      });
    }
  }

  // ── Question bank (Phase 2) ────────────────────────────────────────────────
  const hod = await createStaffAccount(db, {
    schoolId,
    name: "Mr. Kunle Ade",
    title: "Mr.",
    email: "k.ade@greenfieldacademy.ng",
    password: DEMO_STAFF_PASSWORD,
    roles: [{ role: "teacher" }, { role: "hod", departmentId: sciences }],
  });
  await db.update(t.department).set({ hodUserId: hod.id }).where(sql`${t.department.id} = ${sciences}`);
  const scope = tenantScope(db, schoolId);
  const musa: Actor = { id: formTeacher.id, roles: [{ role: "teacher", schoolId }] };
  const kunle: Actor = { id: hod.id, roles: [{ role: "teacher", schoolId }, { role: "hod", schoolId, departmentId: sciences }] };
  const jss3 = levels.JSS3;
  const P = (...content: unknown[]) => ({ type: "paragraph", content });
  const txt = (text: string) => ({ type: "text", text });
  const m = (latex: string) => ({ type: "inlineMath", attrs: { latex } });
  const doc = (...content: unknown[]): t.RichDoc => ({ type: "doc", content });
  const opt = (...xs: (string | { latex: string })[]) =>
    xs.map((x) => doc(P(typeof x === "string" ? txt(x) : m(x.latex))));
  const q = (over: Partial<QuestionInput>): QuestionInput => ({
    type: "mcq_single",
    subjectId: subjects.Mathematics,
    classLevelId: jss3,
    topicName: "",
    passageId: null,
    stem: doc(P(txt(""))),
    marks: 1,
    difficulty: "medium",
    options: [],
    scoring: "all_or_nothing",
    trueFalse: null,
    accepted: [],
    caseSensitive: false,
    numericValue: "",
    tolerance: "",
    markingGuide: null,
    ...over,
  });
  const withCorrect = (docs: t.RichDoc[], correct: number[]) => docs.map((content, i) => ({ content, isCorrect: correct.includes(i) }));

  const bank: { by: Actor; input: QuestionInput; submit: boolean }[] = [
    {
      by: kunle,
      submit: true,
      input: q({
        topicName: "Indices",
        stem: doc(P(txt("Simplify "), m("2^{3} \\times 2^{4}"), txt("."))),
        options: withCorrect(opt({ latex: "2^{7}" }, { latex: "2^{12}" }, { latex: "4^{7}" }, { latex: "4^{12}" }), [0]),
        difficulty: "easy",
      }),
    },
    {
      by: kunle,
      submit: true,
      input: q({
        topicName: "Fractions",
        stem: doc(P(txt("Evaluate "), m("\\frac{3}{4} + \\frac{1}{6}"), txt("."))),
        options: withCorrect(opt({ latex: "\\frac{4}{10}" }, { latex: "\\frac{11}{12}" }, { latex: "\\frac{2}{5}" }, { latex: "\\frac{5}{6}" }), [1]),
      }),
    },
    {
      by: kunle,
      submit: true,
      input: q({
        type: "numeric",
        topicName: "Percentages",
        stem: doc(P(txt("A shop sells a bag of rice for ₦45,000 and gives a 10% discount. How much does the customer pay, in naira?"))),
        numericValue: "40500",
      }),
    },
    {
      by: kunle,
      submit: true,
      input: q({
        subjectId: subjects["Basic Science"],
        topicName: "Acids and bases",
        stem: doc(P(txt("Which gas turns lime water milky?"))),
        options: withCorrect(opt("Oxygen", "Hydrogen", "Carbon(IV) oxide", "Nitrogen"), [2]),
        difficulty: "easy",
      }),
    },
    {
      by: kunle,
      submit: true,
      input: q({
        subjectId: subjects["Basic Science"],
        type: "fill_blank",
        topicName: "States of matter",
        stem: doc(P(txt("The process of converting a liquid to vapour below its boiling point is ___."))),
        accepted: ["evaporation"],
      }),
    },
    {
      by: kunle,
      submit: true,
      input: q({
        subjectId: subjects["Basic Science"],
        type: "true_false",
        topicName: "Chemical symbols",
        stem: doc(P(txt("The chemical formula of water is "), m("\\ce{H2O}"), txt("."))),
        trueFalse: true,
        difficulty: "easy",
      }),
    },
    {
      by: musa,
      submit: true,
      input: q({
        type: "theory",
        topicName: "Simple equations",
        marks: 5,
        difficulty: "hard",
        stem: doc(P(txt("Solve "), m("3x - 7 = 11"), txt(" and check your answer."))),
        markingGuide: doc(P(txt("Adds 7 to both sides (1). "), m("3x = 18"), txt(" (1). "), m("x = 6"), txt(" (2). Substitutes to check (1)."))),
      }),
    },
  ];
  for (const b of bank) {
    const r = await saveQuestion(scope, b.by, { input: b.input, submit: b.submit });
    if (!r.ok) throw new Error(`Seed question failed: ${JSON.stringify(r)}`);
  }

  // ── Paper 1 (Phase 4): the design's 30 questions, published through the builder ──
  await seedPaperOne(scope, { id: admin.id, roles: [{ role: "school_admin", schoolId }] }, {
    examId: paperOneId,
    subjects,
    jss3,
    now: new Date(Math.min(now, opensSoon.getTime())),
    seats: Object.fromEntries(everyone.map((id, i) => [id, String(i === 0 ? 14 : i < 14 ? i : i + 1).padStart(2, "0")])),
  });

  // ── Finished CA tests with every candidate's answers (Phase 8 analytics) ──
  await seedCompletedExams(scope, { id: admin.id, roles: [{ role: "school_admin", schoolId }] }, {
    jss3,
    subjects,
    arms,
    exams: finished,
    strong: [chiamaka.student.id],
  });

  // ── Billing: Standard paid for last term and this one (report cards and analytics on; Premium features locked) ──
  const paying = await db.select({ id: t.student.id }).from(t.student).where(sql`${t.student.schoolId} = ${schoolId} and ${t.student.classArmId} is not null`);
  for (const [termId, ref, paidAt] of [
    [t3Last, "SNC-20260428-SEED3T", new Date("2026-04-28T09:12:00Z")],
    [t1Now, "SNC-20260915-SEED1T", new Date("2026-09-15T10:04:00Z")],
  ] as const) {
    await ins(t.subscription, {
      termId,
      plan: "standard",
      studentCount: paying.length,
      pricePerStudent: 90_000,
      amount: 90_000 * paying.length,
      reference: ref,
      status: "paid",
      paidAt,
      channel: "card",
      providerTransactionId: "seed",
      createdBy: admin.id,
    });
  }

  return { school, pins };
}

/** Crestview Model College, the public demo school (scripts/demo/seed-demo.ts). */
export const seedCrestview = (db: Db) => seedDemoSchool(db);

async function main() {
  const url = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  const db = createDb(url);
  await db.execute(sql`TRUNCATE TABLE "school", "user", "verification", "audit_log" RESTART IDENTITY CASCADE`);

  const g = await seedGreenfield(db);
  await seedCrestview(db);
  await createPlatformOwner(db, { name: "SonoCBT Support", email: "owner@sonocbt.ng", password: DEMO_STAFF_PASSWORD });

  console.info(`
Seeded ${g.school.name} (/s/${g.school.slug}) and the demo school Crestview Model College (/s/crestview; try it at /demo).

Staff sign in at /login — password "${DEMO_STAFF_PASSWORD}":
  proprietor@greenfieldacademy.ng   School admin
  f.adebayo@greenfieldacademy.ng    Exam officer
  i.musa@greenfieldacademy.ng       Teacher + JSS3B form teacher
  k.ade@greenfieldacademy.ng        Teacher + HOD Sciences (approves Maths & Basic Science questions)
  principal@crestview.edu.ng        Demo school admin (password "crestview-demo-2026", public)
  owner@sonocbt.ng                  Platform owner (/platform)

Students sign in at /s/<school>/login — password "${DEMO_STUDENT_PASSWORD}":
  GFA/2021/0147  Chiamaka Okafor (Greenfield)

Parent result checker at /results?school=${g.school.slug} — admission no GFA/2021/0147:
${g.pins.map((p) => `  ${formatPin(p.pin)}  ${p.serial}`).join("\n")}
  (the first is for 3rd Term 2025/2026 — released; the last is for 1st Term 2026/2027 — not yet released)
`);
  process.exit(0);
}

// Run only when called as a script (tests import the seed functions).
if (process.argv[1] && /seed\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
