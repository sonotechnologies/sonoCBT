/**
 * The public demo school, Crestview Model College, Ibadan (fictional), built
 * to the brief: JSS1–SS3 in two arms, 10 subjects, 120 students, 15 staff,
 * ~600 questions (maths notation, pictures, a comprehension passage), three
 * finished exams with answers and integrity events, one exam open all day,
 * last term's results released with report cards, and sample result PINs.
 * Rebuilt every night (lib/demo/reset.ts), so it uses bulk inserts.
 */
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { createStaffAccount, createStudentsBulk } from "@/lib/accounts";
import type { Actor } from "@/lib/auth/permissions";
import { refreshQuestionStats } from "@/lib/analytics/stats";
import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { DEMO_PARENT_CHILD, DEMO_PEOPLE, DEMO_SLUG, DEMO_STAFF_PASSWORD, DEMO_STUDENT_PASSWORD } from "@/lib/demo/config";
import { publishExam } from "@/lib/exams/builder";
import { WAEC_BANDS } from "@/lib/grading";
import type { QuestionInput } from "@/lib/questions/model";
import { addQuestions, savePassage } from "@/lib/questions/service";
import { AFFECTIVE, PSYCHOMOTOR, suggestPrincipalRemark } from "@/lib/results/extras-model";
import { hashPin } from "@/lib/results/pin";
import { storeBytes } from "@/lib/storage";
import { tenantScope, type TenantScope } from "@/lib/tenant/scope";
import { diagram } from "./images";
import { demoQuestions, PASSAGE, THEORY, type GenQ, type Level } from "./questions";
import { prng, simulate } from "./simulate";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const LEVELS: Level[] = ["JSS1", "JSS2", "JSS3", "SS1", "SS2", "SS3"];

const SUBJECTS: [string, string, "jss" | "ss" | "all", boolean][] = [
  ["English Language", "English", "all", false],
  ["Mathematics", "Maths", "all", true],
  ["Basic Science", "Basic Sci", "jss", true],
  ["Basic Technology", "Basic Tech", "jss", true],
  ["Social Studies", "Social St", "jss", false],
  ["Civic Education", "Civic", "all", false],
  ["Biology", "Biology", "ss", true],
  ["Chemistry", "Chemistry", "ss", true],
  ["Physics", "Physics", "ss", true],
  ["Economics", "Economics", "ss", false],
];

// [name, email local part, subjects and stages they teach]
const TEACHERS: [string, string, [string, "jss" | "ss" | "JSS3" | "all"][]][] = [
  [DEMO_PEOPLE.teacher.name, "e.nwosu", [["Mathematics", "jss"], ["Basic Science", "JSS3"]]],
  ["Mrs. Hauwa Bello", "h.bello", [["Mathematics", "ss"]]],
  ["Mrs. Ngozi Okeke", "n.okeke", [["English Language", "jss"]]],
  ["Mr. Femi Ojo", "f.ojo", [["English Language", "ss"]]],
  ["Mrs. Amaka Eze", "a.eze", [["Basic Science", "jss"]]],
  ["Mr. Tunde Bakare", "t.bakare", [["Basic Technology", "jss"]]],
  ["Mrs. Grace Etim", "g.etim", [["Social Studies", "jss"]]],
  ["Mr. Ibrahim Musa", "i.musa", [["Civic Education", "all"]]],
  ["Dr. Chika Obi", "c.obi", [["Biology", "ss"]]],
  ["Mr. Yusuf Lawal", "y.lawal", [["Chemistry", "ss"]]],
  ["Mr. Segun Afolabi", "s.afolabi", [["Physics", "ss"]]],
  ["Mrs. Ronke Alade", "r.alade", [["Economics", "ss"]]],
  ["Mrs. Blessing Udoh", "b.udoh", []],
];

const FIRST_F = ["Adaeze", "Aisha", "Amarachi", "Bukola", "Chiamaka", "Chioma", "Damilola", "Esther", "Fatima", "Funke", "Halima", "Hauwa", "Ifeoma", "Kemi", "Mariam", "Ngozi", "Nkechi", "Rukayat", "Temitope", "Titilayo", "Yetunde", "Zainab", "Folasade", "Habiba", "Morenike", "Precious", "Salamatu", "Uchenna", "Blessing", "Grace"];
const FIRST_M = ["Abdulrahman", "Adebayo", "Babatunde", "Chidi", "Chinedu", "Chukwudi", "Emeka", "Gbenga", "Ibrahim", "Ifeanyi", "Ikenna", "Kayode", "Kelechi", "Musa", "Nnamdi", "Obinna", "Olumide", "Oluwaseun", "Rotimi", "Sadiq", "Samuel", "Segun", "Tobiloba", "Tosin", "Tunde", "Uche", "Victor", "Yakubu", "Emmanuel", "Daniel"];
const LAST = ["Adebisi", "Adeleke", "Adewale", "Agu", "Ajayi", "Akinola", "Akpan", "Alabi", "Aliyu", "Anyanwu", "Bakare", "Balogun", "Bello", "Chukwu", "Coker", "Danjuma", "Edet", "Ekpo", "Eze", "Fadahunsi", "Falana", "Fashola", "Garba", "Ibe", "Idris", "Iwu", "Lawal", "Mbah", "Mohammed", "Nnaji", "Nwachukwu", "Nwosu", "Obi", "Obiora", "Ogunbiyi", "Ogunleye", "Okafor", "Okeke", "Okon", "Okonkwo", "Oladipo", "Olatunji", "Onyeka", "Oyebanji", "Oyelaran", "Salami", "Sani", "Suleiman", "Udo", "Ugwu", "Umeh", "Usman", "Yusuf"];

const doc = (...paras: string[]): t.RichDoc => ({
  type: "doc",
  content: paras.map((s) => ({
    type: "paragraph",
    content: s
      .split(/\$([^$]+)\$/)
      .map((part, i) => (i % 2 ? { type: "inlineMath", attrs: { latex: part } } : part ? { type: "text", text: part } : null))
      .filter(Boolean),
  })),
});

export type DemoSeed = { schoolId: string; liveExamId: string; parentChildId: string; pins: { pin: string; serial: string; term: string }[] };

export async function seedDemoSchool(db: Db, now = new Date()): Promise<DemoSeed> {
  const rand = prng(4242);
  // DEMO_TIMING=1 prints how long each step takes (to keep the nightly reset quick).
  let last = Date.now();
  const mark = (step: string) => {
    if (process.env.DEMO_TIMING === "1") console.info(`  ${step}: ${((Date.now() - last) / 1000).toFixed(1)}s`);
    last = Date.now();
  };
  const [school] = await db
    .insert(t.school)
    .values({
      name: "Crestview Model College",
      slug: DEMO_SLUG,
      locality: "Ibadan",
      address: "7 Ring Road, Ibadan",
      state: "Oyo",
      phone: "08025550113",
      email: "info@crestview.edu.ng",
      principalName: DEMO_PEOPLE.admin.name,
      motto: "Excellence and Integrity",
      brandColor: "#6B2D5C",
      plan: "premium",
      status: "active",
      isDemo: true,
      onboardingCompletedAt: now,
    })
    .returning();
  const schoolId = school.id;
  const scope = tenantScope(db, schoolId);
  const one = async <T extends Parameters<TenantScope["insert"]>[0]>(table: T, v: Record<string, unknown>) => ((await scope.insert(table, v as never)) as unknown as { id: string }[])[0].id;

  // ── Calendar, classes, subjects ──
  const s2526 = await one(t.academicSession, { name: "2025/2026", startsOn: "2025-09-15", endsOn: "2026-07-24" });
  const s2627 = await one(t.academicSession, { name: "2026/2027", startsOn: "2026-09-14", isCurrent: true });
  const lastTerm = await one(t.term, { sessionId: s2526, number: 3, startsOn: "2026-04-27", endsOn: "2026-07-24", nextResumesOn: "2026-09-14" });
  const nowTerm = await one(t.term, { sessionId: s2627, number: 1, startsOn: "2026-09-14", endsOn: "2026-12-18", nextResumesOn: "2027-01-11", isCurrent: true });
  const levels: Record<string, string> = {};
  const arms: Record<string, string> = {};
  for (const [i, code] of LEVELS.entries()) {
    levels[code] = await one(t.classLevel, { code, sortOrder: i + 1 });
    for (const a of ["A", "B"]) arms[`${code}${a}`] = await one(t.classArm, { classLevelId: levels[code], name: `${code}${a}` });
  }
  const sciences = await one(t.department, { name: "Sciences" });
  const subjects: Record<string, string> = {};
  for (const [i, [name, short, stage, sci]] of SUBJECTS.entries()) subjects[name] = await one(t.subject, { name, shortName: short, stage, departmentId: sci ? sciences : null, sortOrder: i + 1 });
  const takes = (level: Level) => SUBJECTS.filter(([, , stage]) => stage === "all" || stage === (level.startsWith("JSS") ? "jss" : "ss")).map(([n]) => n);

  mark("calendar, classes, subjects");
  // ── Staff: principal, exam officer, 13 teachers (12 of them form teachers) ──
  const staffHash = await hashPassword(DEMO_STAFF_PASSWORD);
  const admin = await createStaffAccount(db, { schoolId, name: DEMO_PEOPLE.admin.name, email: DEMO_PEOPLE.admin.email, password: DEMO_STAFF_PASSWORD, passwordHash: staffHash, title: "Mrs.", roles: [{ role: "school_admin" }] });
  await createStaffAccount(db, { schoolId, name: DEMO_PEOPLE.examOfficer.name, email: DEMO_PEOPLE.examOfficer.email, password: DEMO_STAFF_PASSWORD, passwordHash: staffHash, title: "Mr.", roles: [{ role: "exam_officer" }] });
  const armList = Object.keys(arms);
  const teacherIds: Record<string, string> = {};
  for (const [i, [name, local, teaches]] of TEACHERS.entries()) {
    const formArm = armList[i];
    const roles: { role: "teacher" | "form_teacher" | "hod"; classArmId?: string; departmentId?: string }[] = [{ role: "teacher" }];
    if (formArm) roles.push({ role: "form_teacher", classArmId: arms[formArm] });
    if (local === "c.obi") roles.push({ role: "hod", departmentId: sciences });
    const u = await createStaffAccount(db, { schoolId, name, email: `${local}@crestview.edu.ng`, password: DEMO_STAFF_PASSWORD, passwordHash: staffHash, roles });
    teacherIds[local] = u.id;
    if (formArm) await db.update(t.classArm).set({ formTeacherId: u.id }).where(eq(t.classArm.id, arms[formArm]));
    void teaches;
  }
  const teacherFor = (subject: string, level: Level) =>
    TEACHERS.find(([, , teaches]) => teaches.some(([s, st]) => s === subject && (st === "all" || st === level || (st === "jss" && level.startsWith("JSS") && !(subject === "Basic Science" && level === "JSS3")) || (st === "ss" && level.startsWith("SS")))))?.[1];
  await scope.insert(
    t.subjectOffering,
    LEVELS.flatMap((level) => ["A", "B"].flatMap((a) => takes(level).map((sub) => ({ subjectId: subjects[sub], classArmId: arms[`${level}${a}`], teacherId: teacherIds[teacherFor(sub, level) ?? ""] ?? null })))),
  );

  mark("staff");
  // ── 120 students, 10 per class ──
  const ENTRY: Record<Level, number> = { JSS1: 2026, JSS2: 2025, JSS3: 2024, SS1: 2023, SS2: 2022, SS3: 2021 };
  const rows: Parameters<typeof createStudentsBulk>[2] = [];
  const used = new Set<string>();
  for (const level of LEVELS) {
    let seq = 100;
    for (const a of ["A", "B"]) {
      for (let k = 0; k < 10; k++) {
        const female = (k + (a === "B" ? 1 : 0)) % 2 === 0;
        let first: string, last: string;
        do {
          first = (female ? FIRST_F : FIRST_M)[Math.floor(rand() * 30)];
          last = LAST[Math.floor(rand() * LAST.length)];
        } while (used.has(`${first} ${last}`));
        used.add(`${first} ${last}`);
        rows.push({ admissionNo: `CMC/${ENTRY[level]}/${String(++seq).padStart(4, "0")}`, firstName: first, lastName: last, gender: female ? "female" : "male", classArmId: arms[`${level}${a}`] });
      }
    }
  }
  const students = await createStudentsBulk(db, schoolId, rows, DEMO_STUDENT_PASSWORD);
  const levelOf = (armId: string) => LEVELS.find((l) => arms[`${l}A`] === armId || arms[`${l}B`] === armId)!;
  const ability = new Map(students.map((s) => [s.id, Math.max(0.2, Math.min(0.92, 0.58 + (rand() + rand() + rand() - 1.5) * 0.22))]));
  await scope.insert(t.enrollment, students.map((s) => ({ studentId: s.id, termId: nowTerm, classArmId: s.classArmId! })));
  // Last term each student was a class lower (JSS1 joined this term).
  const lastArm = (s: (typeof students)[number]) => {
    const l = levelOf(s.classArmId!);
    const i = LEVELS.indexOf(l);
    return i > 0 ? arms[`${LEVELS[i - 1]}${(Object.entries(arms).find(([, id]) => id === s.classArmId)![0]).slice(-1)}`] : null;
  };
  const returning = students.filter((s) => lastArm(s));
  await scope.insert(t.enrollment, returning.map((s) => ({ studentId: s.id, termId: lastTerm, classArmId: lastArm(s)! })));

  mark("students");
  // ── Grading, components, last term released, this term in progress ──
  const scale = await one(t.gradingScale, { name: "WAEC (A1–F9)", isDefault: true });
  await scope.insert(t.gradeBand, WAEC_BANDS.map((b) => ({ ...b, scaleId: scale })));
  const ca = await one(t.assessmentComponent, { termId: lastTerm, name: "CA", weight: 40, sortOrder: 1 });
  const ex = await one(t.assessmentComponent, { termId: lastTerm, name: "Exam", weight: 60, sortOrder: 2 });
  const comps: Record<string, string> = {};
  for (const [i, [n, w]] of ([["1st CA", 20], ["2nd CA", 20], ["Exam", 60]] as const).entries()) comps[n] = await one(t.assessmentComponent, { termId: nowTerm, name: n, weight: w, sortOrder: i + 1 });

  const subjectBias = Object.fromEntries(SUBJECTS.map(([n], i) => [n, [0.04, -0.06, 0.02, 0.05, 0.08, 0.1, 0, -0.04, -0.08, 0.03][i]]));
  const scoreRows: (typeof t.scoreEntry.$inferInsert)[] = [];
  const totals = new Map<string, number[]>();
  for (const s of returning) {
    const lvl = LEVELS[LEVELS.indexOf(levelOf(s.classArmId!)) - 1];
    for (const sub of takes(lvl)) {
      const total = Math.round(Math.max(18, Math.min(96, (ability.get(s.id)! + subjectBias[sub]) * 100 + (rand() - 0.5) * 18)));
      const c = Math.min(40, Math.round(total * (0.36 + rand() * 0.08)));
      scoreRows.push({ schoolId, termId: lastTerm, studentId: s.id, subjectId: subjects[sub], componentId: ca, value: c }, { schoolId, termId: lastTerm, studentId: s.id, subjectId: subjects[sub], componentId: ex, value: total - c });
      totals.set(s.id, [...(totals.get(s.id) ?? []), total]);
    }
  }
  for (const s of students) {
    for (const sub of takes(levelOf(s.classArmId!))) {
      for (const comp of ["1st CA", "2nd CA"]) {
        const v = Math.round(Math.max(3, Math.min(20, (ability.get(s.id)! + subjectBias[sub]) * 20 + (rand() - 0.5) * 6)));
        scoreRows.push({ schoolId, termId: nowTerm, studentId: s.id, subjectId: subjects[sub], componentId: comps[comp], value: v });
      }
    }
  }
  for (let i = 0; i < scoreRows.length; i += 2000) await db.insert(t.scoreEntry).values(scoreRows.slice(i, i + 2000));
  const lastArms = [...new Set(returning.map((s) => lastArm(s)!))];
  await scope.insert(t.resultBatch, lastArms.map((classArmId) => ({ termId: lastTerm, classArmId, status: "released" as const, releasedAt: new Date("2026-07-31T10:00:00Z"), releasedBy: admin.id })));
  await scope.insert(t.resultBatch, armList.map((name) => ({ termId: nowTerm, classArmId: arms[name], status: "draft" as const })));
  const REMARKS = ["A steady, hard-working student.", "Participates well in class. Should read more at home.", "Polite and neat. Needs to be more punctual.", "Capable, but must stay focused in lessons.", "Shows good leadership among classmates.", "A cheerful and helpful member of the class."];
  await scope.insert(
    t.reportCardExtras,
    returning.map((s, i) => {
      const avg = totals.get(s.id)!.reduce((a, b) => a + b, 0) / totals.get(s.id)!.length;
      return {
        termId: lastTerm,
        studentId: s.id,
        formTeacherRemark: REMARKS[i % REMARKS.length],
        principalRemark: suggestPrincipalRemark(avg),
        affective: Object.fromEntries(AFFECTIVE.map((a) => [a.key, 3 + Math.floor(rand() * 3)])),
        psychomotor: Object.fromEntries(PSYCHOMOTOR.map((a) => [a.key, 2 + Math.floor(rand() * 4)])),
        daysPresent: 61 - Math.floor(rand() * 8),
        daysOpened: 61,
      };
    }),
  );

  mark("scores, results, report cards");
  // ── Question bank (~600) ──
  const adminActor: Actor = { id: admin.id, roles: [{ role: "school_admin", schoolId }] };
  const images: Record<string, string> = {};
  for (const k of ["hexagon", "right-triangle", "bar-chart"] as const) {
    try {
      images[k] = await storeBytes(schoolId, "question", diagram(k), "image/png");
    } catch {
      // No file storage on this server: those three questions go in without a picture.
    }
  }
  const base = (subjectId: string, level: Level): QuestionInput => ({
    type: "mcq_single",
    subjectId,
    classLevelId: levels[level],
    topicName: "",
    passageId: null,
    stem: doc(""),
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
  });
  const stemOf = (q: GenQ): t.RichDoc => {
    const d = doc(q.stem);
    if (q.image && images[q.image]) d.content = [...(d.content ?? []), { type: "image", attrs: { src: images[q.image], alt: "Diagram for the question" } }];
    return d;
  };
  const gen = demoQuestions();
  const bankIds = new Map<GenQ, string>();
  for (const [name] of SUBJECTS) {
    const mine = gen.filter((q) => q.subject === name);
    if (!mine.length) continue;
    const res = await addQuestions(scope, adminActor, {
      subjectId: subjects[name],
      submit: true,
      source: "manual",
      items: mine.map((q) => ({ input: { ...base(subjects[name], q.level), topicName: q.topic, difficulty: q.difficulty, stem: stemOf(q), options: q.options.map((o, i) => ({ content: doc(o), isCorrect: i === q.correct })) } })),
    });
    res.forEach((r, i) => {
      if (!r.ok) throw new Error(`Demo question failed: ${JSON.stringify(r)} for ${mine[i].stem}`);
      bankIds.set(mine[i], r.id);
    });
  }
  const passage = await savePassage(scope, adminActor, { subjectId: subjects["English Language"], classLevelId: levels.JSS2, title: PASSAGE.title, content: doc(...PASSAGE.paras) });
  const passageRes = await addQuestions(scope, adminActor, {
    subjectId: subjects["English Language"],
    submit: true,
    source: "manual",
    items: PASSAGE.questions.map(([stem, a, b, c, d]) => ({ input: { ...base(subjects["English Language"], "JSS2"), passageId: passage.id, topicName: "Comprehension", difficulty: "medium", stem: doc(stem), options: [a, b, c, d].map((o, i) => ({ content: doc(o), isCorrect: i === 0 })) } })),
  });
  const passageIds = passageRes.map((r) => (r.ok ? r.id : ""));
  const theoryIds = new Map<string, string>();
  for (const th of THEORY) {
    const [r] = await addQuestions(scope, adminActor, {
      subjectId: subjects[th.subject],
      submit: true,
      source: "manual",
      items: [{ input: { ...base(subjects[th.subject], th.level), type: "theory", marks: th.marks, topicName: th.topic, difficulty: "hard", stem: doc(th.stem), markingGuide: doc(th.guide) } }],
    });
    if (r.ok) theoryIds.set(th.stem, r.id);
  }

  mark("question bank");
  // ── Exams: three finished CA tests, one mock open all day ──
  const meta = new Map<string, { difficulty: "easy" | "medium" | "hard"; trap: number }>();
  for (const [q, id] of bankIds) meta.set(id, { difficulty: q.difficulty, trap: q.trap });
  PASSAGE.questions.forEach((q, i) => meta.set(passageIds[i], { difficulty: "medium", trap: q[5] }));
  const fromBank = (subject: string, lv: Level[], n: number, topicsFirst: string[] = []) => {
    const pool = gen.filter((q) => q.subject === subject && lv.includes(q.level) && !q.image);
    const first = topicsFirst.flatMap((tp) => pool.filter((q) => q.topic === tp).slice(0, 3));
    return [...new Set([...first, ...pool])].slice(0, n).map((q) => bankIds.get(q)!);
  };
  const makeExam = async (o: { title: string; fullTitle: string; type: "ca_test" | "mock"; subjects: string[]; armNames: string[]; start: Date; minutes: number; windowHours: number; integrity: "standard" | "strict" | "practice"; sections: { title: string; subject: string | null; ids: string[] }[]; componentId?: string | null; aiMarking?: boolean; released?: boolean }) => {
    const examId = await one(t.exam, {
      termId: nowTerm,
      title: o.title,
      fullTitle: o.fullTitle,
      type: o.type,
      durationMinutes: o.minutes,
      windowStart: o.start,
      windowEnd: new Date(o.start.getTime() + o.windowHours * 60 * MIN),
      venue: "ICT Lab",
      totalMarks: 0,
      graded: true,
      integrity: o.integrity,
      showScoreAfterSubmit: false,
      scoresReleasedAt: o.released ? new Date(o.start.getTime() + 2 * DAY) : null,
      status: "draft",
      componentId: o.componentId ?? null,
      aiMarking: !!o.aiMarking,
    });
    await scope.insert(t.examSubject, o.subjects.map((s, i) => ({ examId, subjectId: subjects[s], sortOrder: i })));
    await scope.insert(t.examAssignment, o.armNames.map((a) => ({ examId, classArmId: arms[a], venue: "ICT Lab" })));
    for (const [i, sec] of o.sections.entries()) {
      const [row] = await scope.insert(t.examSection, { examId, title: sec.title, subjectId: sec.subject ? subjects[sec.subject] : null, sortOrder: i + 1, questionCount: sec.ids.length, marks: 0 });
      await scope.insert(t.examSectionItem, sec.ids.map((questionId, n) => ({ examId, sectionId: row.id, questionId, sortOrder: n + 1 })));
    }
    await publishExam(scope, adminActor, examId, { now: new Date(o.start.getTime() - DAY), seed: o.title });
    return examId;
  };
  const abil = (id: string) => ability.get(id) ?? 0.55;

  const done: [string, number][] = [];
  const mathsCa = await makeExam({ title: "JSS3 Mathematics CA test", fullTitle: "Mathematics — 2nd CA test", type: "ca_test", subjects: ["Mathematics"], armNames: ["JSS3A", "JSS3B"], start: new Date(now.getTime() - 9 * DAY), minutes: 30, windowHours: 3, integrity: "standard", sections: [{ title: "Objectives", subject: "Mathematics", ids: fromBank("Mathematics", ["JSS2", "JSS3"], 20, ["Indices", "Number bases", "Standard form"]) }], released: true });
  done.push([mathsCa, 31]);
  const physicsCa = await makeExam({ title: "SS2 Physics CA test", fullTitle: "Physics — 2nd CA test", type: "ca_test", subjects: ["Physics"], armNames: ["SS2A", "SS2B"], start: new Date(now.getTime() - 6 * DAY), minutes: 30, windowHours: 3, integrity: "strict", sections: [{ title: "Objectives", subject: "Physics", ids: fromBank("Physics", ["SS1", "SS2", "SS3"], 15, ["Work and energy", "Electricity"]) }], released: true });
  done.push([physicsCa, 37]);
  const englishCa = await makeExam({ title: "JSS2 English CA test", fullTitle: "English Language — 2nd CA test", type: "ca_test", subjects: ["English Language"], armNames: ["JSS2A", "JSS2B"], start: new Date(now.getTime() - 4 * DAY), minutes: 30, windowHours: 3, integrity: "standard", sections: [{ title: "Comprehension", subject: "English Language", ids: passageIds }, { title: "Lexis and structure", subject: "English Language", ids: fromBank("English Language", ["JSS1", "JSS2", "JSS3"], 12, ["Concord"]) }] });
  done.push([englishCa, 43]);
  for (const [examId, seed] of done) {
    await simulate(scope, { examId, meta, ability: abil, startAt: new Date((await scope.findFirst(t.exam, eq(t.exam.id, examId)))!.windowStart.getTime()), durationMinutes: 30, seed, absent: (i) => i % 19 === 7 });
    await scope.update(t.exam, { status: "closed" }, eq(t.exam.id, examId));
  }

  mark("finished exams");
  // The mock is open all day so every visitor can sit it. A few classmates are already writing.
  const mathsTheory = theoryIds.get(THEORY[0].stem)!;
  const scienceTheory = theoryIds.get(THEORY[1].stem)!;
  const imageQs = gen.filter((q) => q.image && images[q.image]).map((q) => bankIds.get(q)!);
  const liveStart = new Date(now.getTime() - 40 * MIN);
  const liveExamId = await makeExam({
    title: "JSS3 Mock · Paper 1",
    fullTitle: "Paper 1 — English, Mathematics & Basic Science",
    type: "mock",
    subjects: ["English Language", "Mathematics", "Basic Science"],
    armNames: ["JSS3A", "JSS3B"],
    start: liveStart,
    minutes: 45,
    windowHours: 23.5,
    integrity: "standard",
    componentId: comps.Exam,
    aiMarking: true,
    sections: [
      { title: "English", subject: "English Language", ids: fromBank("English Language", ["JSS2", "JSS3"], 6, ["Vocabulary", "Concord"]) },
      { title: "Mathematics", subject: "Mathematics", ids: [...imageQs.slice(0, 2), ...fromBank("Mathematics", ["JSS3"], 8, ["Fractions", "Indices", "Simple equations"])] },
      { title: "Basic Science", subject: "Basic Science", ids: fromBank("Basic Science", ["JSS1", "JSS2", "JSS3"], 6) },
      { title: "Theory", subject: null, ids: [mathsTheory, scienceTheory] },
    ],
  });
  const jss3 = students.filter((s) => s.classArmId === arms.JSS3A || s.classArmId === arms.JSS3B);
  await simulate(scope, {
    examId: liveExamId,
    meta,
    ability: abil,
    startAt: new Date(now.getTime() - 35 * MIN),
    durationMinutes: 45,
    seed: 53,
    // Half the class has handed in (their theory is waiting to be marked); some are still writing; the rest haven't started.
    absent: (i) => i >= 14,
    inProgress: new Set(jss3.slice(8, 14).map((s) => s.id)),
    theoryText: new Map([
      [mathsTheory, ["Adding the two equations: 3x = 9, so x = 3. Then 2(3) + y = 7, so y = 1.", "x = 3 and y = 1. Check: 3 - 1 = 2.", "2x + y = 7, x - y = 2. x = 3, y = 2."]],
      [scienceTheory, ["Clear stagnant water and gutters, sleep under treated nets, and cut the grass around the hostels.", "Spray insecticide in the classrooms and keep the compound clean.", "Use mosquito nets and screen the windows. Go to the clinic early when sick."]],
    ]),
  });

  mark("live mock");
  // ── Billing: Premium paid (every feature on), sample result PINs ──
  await scope.insert(t.subscription, [
    { termId: nowTerm, plan: "premium", studentCount: students.length, pricePerStudent: 140_000, amount: 140_000 * students.length, reference: `SNC-DEMO-${now.getTime()}`, status: "paid", paidAt: new Date("2026-09-14T09:00:00Z"), channel: "card", createdBy: admin.id },
  ]);
  const child = students.find((s) => s.admissionNo === DEMO_PARENT_CHILD)!;
  const pins = [
    { pin: "250413369087", serial: "CMC-3T26-000001", term: lastTerm, uses: 30000 },
    { pin: "617250938442", serial: "CMC-1T27-000001", term: nowTerm, uses: 30000 },
  ];
  await scope.insert(t.resultPin, pins.map((p) => ({ termId: p.term, serial: p.serial, pinHash: hashPin(schoolId, p.pin), usesLeft: p.uses, maxUses: p.uses, batch: "B-DEMO" })));
  mark("billing and PINs");
  await refreshQuestionStats(scope);
  mark("question stats");
  return { schoolId, liveExamId, parentChildId: child.id, pins: pins.map((p) => ({ pin: p.pin, serial: p.serial, term: p.term === lastTerm ? "3rd Term 2025/2026 (released)" : "1st Term 2026/2027 (not released)" })) };
}
