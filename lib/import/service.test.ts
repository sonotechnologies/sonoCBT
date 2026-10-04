import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";
import { createStaffAccount } from "@/lib/accounts";
import type { Actor } from "@/lib/auth/permissions";
import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { createSchoolWithAdmin, saveClassesAndSubjects } from "@/lib/school/setup";
import { tenantScope, type TenantScope } from "@/lib/tenant/scope";
import { createTestDb } from "@/test/db";
import { readDocx } from "./docx";
import { commitImport, createImportJob, getImportJob, greenIds, updateImportItems } from "./service";
import { parseQuestionPaper } from "./word-parser";

let db: Db;
let scope: TenantScope;
let teacher: Actor;
let otherTeacher: Actor;
let english: string;

beforeAll(async () => {
  db = await createTestDb();
  const { school } = await createSchoolWithAdmin(db, { schoolName: "Import School", adminName: "A", email: "a@imp.ng", password: "password-1" });
  scope = tenantScope(db, school.id);
  await saveClassesAndSubjects(scope, { levels: [{ code: "JSS2", arms: ["A"] }], subjects: [{ name: "English Language", stage: "all" }] });
  english = (await scope.findMany(t.subject))[0].id;
  const mk = async (email: string) => {
    const u = await createStaffAccount(db, { schoolId: school.id, name: email, email, password: "password-1", roles: [{ role: "teacher" }] });
    return { id: u.id, roles: [{ role: "teacher" as const, schoolId: school.id }] };
  };
  teacher = await mk("t@imp.ng");
  otherTeacher = await mk("o@imp.ng");
});

async function importFixture(name: string) {
  const { blocks, html } = await readDocx(readFileSync(path.join(__dirname, "fixtures", name)), async () => "/files/test/x.png");
  const parsed = parseQuestionPaper(blocks);
  return createImportJob(scope, teacher, {
    kind: "word",
    title: name,
    subjectId: english,
    classLevelId: null,
    items: parsed.items,
    passages: parsed.passages,
    sourceHtml: html,
    notes: parsed.notes,
  });
}

describe("Word import → bank", () => {
  it("accepts all green questions and adds them, with the passage, as pending", async () => {
    const id = await importFixture("07-comprehension-passage.docx");
    const job = (await getImportJob(scope, teacher, id))!;
    const green = new Set(greenIds(job.items));
    expect(green.size).toBe(7);
    await updateImportItems(scope, teacher, id, job.items.map((i) => (green.has(i.id) ? { ...i, status: "accepted" } : i)));
    const res = await commitImport(scope, teacher, id, true);
    expect(res).toMatchObject({ saved: 7, failed: [] });
    expect(res.items.filter((i) => i.status === "saved").every((i) => i.questionId)).toBe(true);

    const qs = await scope.findMany(t.question);
    expect(qs).toHaveLength(7);
    expect(qs.every((q) => q.source === "word" && q.status === "pending")).toBe(true);
    const passages = await scope.findMany(t.passage);
    expect(passages).toHaveLength(1);
    expect(qs.filter((q) => q.passageId === passages[0].id)).toHaveLength(4);
    expect((await getImportJob(scope, teacher, id))?.status).toBe("saved");
  });

  it("flags questions already in the bank on the next import", async () => {
    const id = await importFixture("07-comprehension-passage.docx");
    const job = (await getImportJob(scope, teacher, id))!;
    expect(job.items.every((i) => i.flags.some((f) => /already in the bank/.test(f.message)))).toBe(true);
    expect(greenIds(job.items)).toHaveLength(0);
  });

  it("keeps imports private to the teacher who started them", async () => {
    const id = await importFixture("01-classic-ans-lines.docx");
    expect(await getImportJob(scope, otherTeacher, id)).toBeNull();
    await expect(updateImportItems(scope, otherTeacher, id, [])).rejects.toThrow(/not found/);
  });

  it("rejects hand-crafted content in review edits", async () => {
    const id = await importFixture("01-classic-ans-lines.docx");
    const job = (await getImportJob(scope, teacher, id))!;
    const bad = { ...job.items[0], stem: { type: "doc", content: [{ type: "image", attrs: { src: "javascript:alert(1)" } }] } };
    await expect(updateImportItems(scope, teacher, id, [bad])).rejects.toThrow(/image/);
  });

  it("does not add questions still under review", async () => {
    const id = await importFixture("01-classic-ans-lines.docx");
    const before = (await scope.findMany(t.question)).length;
    const res = await commitImport(scope, teacher, id, false);
    expect(res.saved).toBe(0);
    expect((await scope.findMany(t.question)).length).toBe(before);
  });
});
