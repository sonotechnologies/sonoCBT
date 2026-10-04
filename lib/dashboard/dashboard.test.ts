/**
 * The staff dashboard against the demo school: the admin's whole-school view
 * and a teacher's own view.
 */
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/auth/permissions";
import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { DEMO_PEOPLE } from "@/lib/demo/config";
import { tenantScope, type TenantScope } from "@/lib/tenant/scope";
import { createTestDb } from "@/test/db";
import { seedDemoSchool } from "@/scripts/demo/seed-demo";
import { greeting, greetingName, staffDashboard } from "./service";

let db: Db;
let scope: TenantScope;

async function actor(email: string): Promise<Actor> {
  const [u] = await db.select().from(t.user).where(eq(t.user.email, email));
  const roles = await db.select({ role: t.userRole.role, schoolId: t.userRole.schoolId, departmentId: t.userRole.departmentId, classArmId: t.userRole.classArmId }).from(t.userRole).where(eq(t.userRole.userId, u.id));
  return { id: u.id, roles };
}

beforeAll(async () => {
  db = await createTestDb();
  scope = tenantScope(db, (await seedDemoSchool(db)).schoolId);
});

describe("dashboard", () => {
  it("greets people by title and surname, at the right time of day", () => {
    expect(greetingName("Mrs. Folake Adeyemi")).toBe("Mrs. Adeyemi");
    expect(greetingName("Dr. Chika Obi")).toBe("Dr. Obi");
    expect(greetingName("Tolu Bakare")).toBe("Tolu");
    expect([greeting(8), greeting(13), greeting(19)]).toEqual(["Good morning", "Good afternoon", "Good evening"]);
  });

  it("gives the admin the whole school: live mock, flags, theory to mark, results by class, billing", async () => {
    const d = await staffDashboard(scope, await actor(DEMO_PEOPLE.admin.email));
    expect(d.dateLine).toMatch(/1st Term, week \d+ of 14/);
    expect(d.quick.map((q) => q.t)).toEqual(["New exam", "Import questions", "Enter CA", "Release results"]);
    expect(d.stats.map((s) => s.k)).toEqual(["Students", "Sitting now", "Theory to mark", "Results released"]);
    expect(d.stats[0]).toMatchObject({ v: "120", d: "across 12 class arms" });
    expect(Number(d.stats[1].v)).toBeGreaterThan(0);
    expect(d.stats[1].d).toBe("JSS3 Mock · Paper 1");
    expect(Number(d.stats[2].v)).toBeGreaterThan(0);
    expect(d.stats[3]).toMatchObject({ v: "0/12" });
    expect(d.exams[0]).toMatchObject({ title: "JSS3 Mock · Paper 1", status: "live", detail: "JSS3A, JSS3B · English, Maths, Basic Sci" });
    expect(d.exams[0].href).toMatch(/^exams\/.+\/monitor$/);
    expect(d.alerts.map((a) => a.title)).toEqual(expect.arrayContaining([expect.stringMatching(/flagged in JSS3 Mock · Paper 1/), "Premium paid for this term"]));
    expect(d.levels.map((l) => l.level)).toEqual(["JSS1", "JSS2", "JSS3", "SS1", "SS2", "SS3"]);
    expect(d.levels.every((l) => l.draft > 0 && l.released === 0)).toBe(true);
  });

  it("gives a teacher their own classes and exams only", async () => {
    const d = await staffDashboard(scope, await actor(DEMO_PEOPLE.teacher.email));
    expect(d.stats[0].k).toBe("Your classes");
    expect(d.stats[3].k).toBe("Exams this week");
    expect(d.quick.map((q) => q.t)).not.toContain("New exam");
    expect(d.exams.map((e) => e.title)).toContain("JSS3 Mock · Paper 1");
    expect(d.exams.map((e) => e.title)).not.toContain("SS2 Physics CA test");
    expect(d.resultsVisible).toBe(false);
    expect(d.alerts.some((a) => a.cta === "Billing")).toBe(false);
  });
});
