import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/auth/permissions";
import * as t from "@/lib/db/schema";
import { createSchoolWithAdmin, saveClassesAndSubjects } from "@/lib/school/setup";
import { tenantScope, type TenantScope } from "@/lib/tenant/scope";
import { createTestDb } from "@/test/db";
import { readDocx } from "./docx";
import { commitImport, createImportJob, getImportJob, greenIds, updateImportItems } from "./service";
import { parseQuestionPaper } from "./word-parser";

// Simulates the connection dropping part-way through a commit.
const failOn = vi.hoisted(() => ({ call: 0, at: -1 }));
vi.mock("@/lib/questions/service", async (orig) => {
  const real = await orig<typeof import("@/lib/questions/service")>();
  return {
    ...real,
    addQuestions: async (...args: Parameters<typeof real.addQuestions>) => {
      if (++failOn.call === failOn.at) throw new Error("connection lost");
      return real.addQuestions(...args);
    },
  };
});

let scope: TenantScope;
let admin: Actor;
let english: string;

beforeAll(async () => {
  const db = await createTestDb();
  const { school, admin: user } = await createSchoolWithAdmin(db, { schoolName: "Atomic School", adminName: "A", email: "a@atom.ng", password: "password-1" });
  scope = tenantScope(db, school.id);
  admin = { id: user.id, roles: [{ role: "school_admin", schoolId: school.id }] };
  await saveClassesAndSubjects(scope, { levels: [{ code: "JSS2", arms: ["A"] }], subjects: [{ name: "English Language", stage: "all" }] });
  english = (await scope.findMany(t.subject))[0].id;
});

describe("commitImport", () => {
  it("saves nothing when interrupted, and a retry adds each question exactly once", async () => {
    const { blocks, html } = await readDocx(readFileSync(path.join(__dirname, "fixtures", "07-comprehension-passage.docx")), async () => "/x.png");
    const parsed = parseQuestionPaper(blocks);
    const id = await createImportJob(scope, admin, { kind: "word", title: "t", subjectId: english, classLevelId: null, ...parsed, sourceHtml: html });
    const job = (await getImportJob(scope, admin, id))!;
    const green = new Set(greenIds(job.items));
    await updateImportItems(scope, admin, id, job.items.map((i) => (green.has(i.id) ? { ...i, status: "accepted" } : i)));

    failOn.at = 1;
    await expect(commitImport(scope, admin, id, false)).rejects.toThrow(/connection lost/);
    expect(await scope.findMany(t.question)).toHaveLength(0);
    expect(await scope.findMany(t.passage)).toHaveLength(0);
    expect((await getImportJob(scope, admin, id))!.items.every((i) => i.status === "accepted")).toBe(true);

    failOn.at = -1;
    expect(await commitImport(scope, admin, id, false)).toMatchObject({ saved: 7, failed: [] });
    expect(await scope.findMany(t.question)).toHaveLength(7);
    expect(await scope.findMany(t.passage)).toHaveLength(1);
  });
});
