/**
 * Phase 2 acceptance: a teacher creates every question type and an HOD approves them.
 */
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createStaffAccount } from "@/lib/accounts";
import type { Actor, Role } from "@/lib/auth/permissions";
import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { saveDepartment } from "@/lib/school/departments";
import { createSchoolWithAdmin, saveClassesAndSubjects } from "@/lib/school/setup";
import { tenantScope, type TenantScope } from "@/lib/tenant/scope";
import { createTestDb } from "@/test/db";
import type { QuestionInput } from "./model";
import { textDoc } from "./rich";
import { addQuestions, applyWorkflow, getQuestion, listQuestions, saveQuestion, savePassage, QuestionError } from "./service";

let db: Db;
let scope: TenantScope;
let otherScope: TenantScope;
let teacher: Actor;
let teacher2: Actor;
let hod: Actor;
let artsHod: Actor;
let maths: string;
let english: string;
let jss1: string;

async function actorFor(schoolId: string, userId: string): Promise<Actor> {
  const roles = await db.select().from(t.userRole).where(eq(t.userRole.userId, userId));
  return { id: userId, roles: roles.map((r) => ({ role: r.role as Role, schoolId: r.schoolId, departmentId: r.departmentId, classArmId: r.classArmId })) };
}

beforeAll(async () => {
  db = await createTestDb();
  const { school, admin } = await createSchoolWithAdmin(db, { schoolName: "Bank School", adminName: "A", email: "a@bank.ng", password: "password-1" });
  scope = tenantScope(db, school.id);
  await saveClassesAndSubjects(scope, {
    levels: [{ code: "JSS1", arms: ["A"] }],
    subjects: [
      { name: "Mathematics", stage: "all" },
      { name: "English Language", stage: "all" },
    ],
  });
  const subjects = await scope.findMany(t.subject);
  maths = subjects.find((s) => s.name === "Mathematics")!.id;
  english = subjects.find((s) => s.name === "English Language")!.id;
  jss1 = (await scope.findMany(t.classLevel))[0].id;

  const mk = (name: string, email: string) =>
    createStaffAccount(db, { schoolId: school.id, name, email, password: "password-1", roles: [{ role: "teacher" }] });
  const tUser = await mk("Mallam Ibrahim Sani", "t@bank.ng");
  const t2User = await mk("Mrs. Ngozi Eze", "t2@bank.ng");
  const hodUser = await mk("Mr. Kunle Ade", "hod@bank.ng");
  const artsUser = await mk("Mrs. Funke Akinola", "arts@bank.ng");
  await saveDepartment(scope, admin.id, { name: "Sciences", subjectIds: [maths], hodUserId: hodUser.id });
  await saveDepartment(scope, admin.id, { name: "Arts", subjectIds: [english], hodUserId: artsUser.id });
  teacher = await actorFor(school.id, tUser.id);
  teacher2 = await actorFor(school.id, t2User.id);
  hod = await actorFor(school.id, hodUser.id);
  artsHod = await actorFor(school.id, artsUser.id);

  const other = await createSchoolWithAdmin(db, { schoolName: "Other School", adminName: "O", email: "o@other.ng", password: "password-1" });
  otherScope = tenantScope(db, other.school.id);
});

const base = (over: Partial<QuestionInput> = {}): QuestionInput => ({
  type: "mcq_single",
  subjectId: maths,
  classLevelId: jss1,
  topicName: "Fractions",
  passageId: null,
  stem: textDoc("What is half of 10?"),
  marks: 1,
  difficulty: "easy",
  options: ["2", "5", "10", "20"].map((x, i) => ({ content: textDoc(x), isCorrect: i === 1 })),
  scoring: "all_or_nothing",
  trueFalse: null,
  accepted: [],
  caseSensitive: false,
  numericValue: "",
  tolerance: "",
  markingGuide: null,
  ...over,
});

describe("teacher creates every type; HOD approves", () => {
  const ids: string[] = [];

  it("creates all six types and sends them for approval", async () => {
    const psg = await savePassage(scope, teacher, {
      subjectId: maths,
      classLevelId: jss1,
      title: "Market day",
      content: textDoc("Ada bought 3 oranges at ₦50 each and 2 mangoes at ₦80 each."),
    });
    const inputs: QuestionInput[] = [
      base(),
      base({
        type: "mcq_multi",
        stem: textDoc("Which of these are prime numbers?"),
        options: ["2", "4", "7", "9"].map((x, i) => ({ content: textDoc(x), isCorrect: i === 0 || i === 2 })),
        scoring: "partial",
      }),
      base({ type: "true_false", stem: textDoc("Every square is a rectangle."), options: [], trueFalse: true }),
      base({ type: "fill_blank", stem: textDoc("A triangle with three equal sides is called ___."), options: [], accepted: ["equilateral"] }),
      base({ type: "numeric", stem: textDoc("How much did Ada spend on oranges (in naira)?"), options: [], numericValue: "150", passageId: psg.id }),
      base({ type: "theory", stem: textDoc("Explain how to add two fractions with different denominators."), options: [], marks: 5, markingGuide: textDoc("Common denominator (2), convert (2), add (1).") }),
    ];
    for (const input of inputs) {
      const r = await saveQuestion(scope, teacher, { input, submit: true });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.status).toBe("pending");
        ids.push(r.id);
      }
    }
    const types = (await scope.findMany(t.question)).map((q) => q.type).sort();
    expect(types).toEqual(["fill_blank", "mcq_multi", "mcq_single", "numeric", "theory", "true_false"]);
  });

  it("gives questions running codes per subject", async () => {
    const q = await getQuestion(scope, hod, ids[5]);
    expect(q?.code).toBe("MTH-0006");
    expect(q?.topicName).toBe("Fractions");
  });

  it("does not let a teacher approve", async () => {
    const r = await applyWorkflow(scope, teacher, ids, "approve");
    expect(r.changed).toBe(0);
  });

  it("does not let another department's HOD approve", async () => {
    const r = await applyWorkflow(scope, artsHod, ids, "approve");
    expect(r.changed).toBe(0);
  });

  it("lets the Sciences HOD approve all six", async () => {
    const r = await applyWorkflow(scope, hod, ids, "approve");
    expect(r.changed).toBe(6);
    const statuses = (await scope.findMany(t.question)).map((q) => q.status);
    expect(statuses.every((s) => s === "approved")).toBe(true);
  });
});

describe("workflow rules", () => {
  it("returns with a comment, and the author resubmits", async () => {
    const r = await saveQuestion(scope, teacher, { input: base({ stem: textDoc("What is a quarter of 20?") }), submit: true });
    if (!r.ok) throw new Error("save failed");
    await expect(applyWorkflow(scope, hod, [r.id], "return", " ")).rejects.toBeInstanceOf(QuestionError);
    await applyWorkflow(scope, hod, [r.id], "return", "Options B and C are both 5.");
    let q = await getQuestion(scope, teacher, r.id);
    expect(q?.status).toBe("returned");
    expect(q?.reviewComment).toBe("Options B and C are both 5.");
    await applyWorkflow(scope, teacher, [r.id], "submit");
    q = await getQuestion(scope, teacher, r.id);
    expect(q?.status).toBe("pending");
  });

  it("sends an approved question back for approval when its author edits it", async () => {
    const r = await saveQuestion(scope, teacher, { input: base({ stem: textDoc("What is 7 × 8?"), options: ["54", "56", "58", "64"].map((x, i) => ({ content: textDoc(x), isCorrect: i === 1 })) }), submit: true });
    if (!r.ok) throw new Error("save failed");
    await applyWorkflow(scope, hod, [r.id], "approve");
    const edited = await saveQuestion(scope, teacher, { id: r.id, input: base({ stem: textDoc("What is 7 × 8 ?"), options: ["54", "56", "58", "64"].map((x, i) => ({ content: textDoc(x), isCorrect: i === 1 })) }), submit: false });
    expect(edited.ok && edited.status).toBe("pending");
  });

  it("approves straight away when a reviewer submits", async () => {
    const r = await saveQuestion(scope, hod, { input: base({ stem: textDoc("Simplify 6/8.") , options: ["3/4", "2/3", "1/2", "4/3"].map((x, i) => ({ content: textDoc(x), isCorrect: i === 0 }))}), submit: true });
    expect(r.ok && r.status).toBe("approved");
  });

  it("keeps drafts private to their author", async () => {
    const r = await saveQuestion(scope, teacher, { input: base({ stem: textDoc("Draft: what is the reciprocal of 9?") }), submit: false });
    if (!r.ok) throw new Error("save failed");
    expect(r.status).toBe("draft");
    expect(await getQuestion(scope, teacher2, r.id)).toBeNull();
    const list = await listQuestions(scope, teacher2, { q: "reciprocal" });
    expect(list.rows).toHaveLength(0);
    expect((await listQuestions(scope, teacher, { status: "mine", q: "reciprocal" })).rows).toHaveLength(1);
  });

  it("stops another teacher editing someone else's question", async () => {
    const [q] = await scope.findMany(t.question);
    await expect(saveQuestion(scope, teacher2, { id: q.id, input: base({ stem: textDoc("Hijack") }), submit: false })).rejects.toBeInstanceOf(QuestionError);
  });

  it("warns about near-duplicates, and saves when told to", async () => {
    const dup = await saveQuestion(scope, teacher2, { input: base({ stem: textDoc("what is HALF of 10") }), submit: true });
    expect(dup.ok).toBe(false);
    expect(!dup.ok && "duplicates" in dup && dup.duplicates[0].code).toBe("MTH-0001");
    const forced = await saveQuestion(scope, teacher2, { input: base({ stem: textDoc("what is HALF of 10") }), submit: true, allowDuplicate: true });
    expect(forced.ok).toBe(true);
  });

  it("searches by words in the question", async () => {
    const r = await listQuestions(scope, hod, { q: "three equal sides" });
    expect(r.rows.map((x) => x.type)).toContain("fill_blank");
  });

  it("filters by type and subject", async () => {
    const r = await listQuestions(scope, hod, { type: "theory", subjectId: maths });
    expect(r.rows).toHaveLength(1);
    expect((await listQuestions(scope, hod, { subjectId: english })).rows).toHaveLength(0);
  });

  it("keeps each school's bank separate", async () => {
    const [q] = await scope.findMany(t.question);
    expect(await getQuestion(otherScope, hod, q.id)).toBeNull();
    expect((await listQuestions(otherScope, hod, {})).rows).toHaveLength(0);
  });
});

describe("adding many questions at once (imports)", () => {
  it("adds valid ones with running numbers, reuses topics, and reports the bad ones", async () => {
    const before = await scope.findMany(t.question, eq(t.question.subjectId, maths));
    const topicsBefore = await scope.findMany(t.topic, eq(t.topic.subjectId, maths));
    const res = await addQuestions(scope, teacher, {
      subjectId: maths,
      submit: true,
      source: "word",
      items: [
        { input: base({ stem: textDoc("Bulk one?"), topicName: "fractions " }) },
        { input: base({ stem: textDoc("Bulk two?"), options: [] }) },
        { input: base({ stem: textDoc("Bulk three?"), topicName: "Decimals" }), explanation: " Because. " },
      ],
    });
    expect(res.map((r) => r.ok)).toEqual([true, false, true]);
    expect(res[1]).toMatchObject({ ok: false, errors: expect.any(Array) });

    const added = (await scope.findMany(t.question, eq(t.question.subjectId, maths))).filter((q) => !before.some((b) => b.id === q.id));
    expect(added).toHaveLength(2);
    const top = Math.max(...before.map((q) => q.number));
    expect(added.map((q) => q.number).sort()).toEqual([top + 1, top + 2]);
    expect(added.every((q) => q.status === "pending" && q.source === "word" && q.authorId === teacher.id)).toBe(true);
    expect(added.find((q) => q.stemText === "Bulk three?")?.explanation).toBe("Because.");

    const topics = await scope.findMany(t.topic, eq(t.topic.subjectId, maths));
    expect(topics).toHaveLength(topicsBefore.length + 1); // "fractions " reuses Fractions; Decimals is new
    expect(added.find((q) => q.stemText === "Bulk one?")?.topicId).toBe(topicsBefore.find((x) => x.name === "Fractions")?.id);
    const opts = await scope.findMany(t.questionOption);
    expect(opts.filter((o) => added.some((q) => q.id === o.questionId))).toHaveLength(8);
  });

  it("approves straight away for a reviewer, and keeps drafts as drafts", async () => {
    const [a] = await addQuestions(scope, hod, { subjectId: maths, submit: true, source: "ai", items: [{ input: base({ stem: textDoc("HOD bulk?") }) }] });
    const [b] = await addQuestions(scope, teacher, { subjectId: maths, submit: false, source: "sheet", items: [{ input: base({ stem: textDoc("Draft bulk?") }) }] });
    expect(a).toMatchObject({ ok: true, status: "approved" });
    expect(b).toMatchObject({ ok: true, status: "draft" });
  });

  it("refuses a subject from another school", async () => {
    await expect(addQuestions(otherScope, teacher, { subjectId: maths, submit: false, source: "word", items: [{ input: base() }] })).rejects.toThrow();
  });
});
