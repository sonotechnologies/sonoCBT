/**
 * Phase 9: billing rules, Paystack payments (API stubbed) and feature gating.
 * Acceptance: "Test payment activates a plan and unlocks gated features."
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPlatformOwner, createStudentAccount } from "@/lib/accounts";
import type { Actor } from "@/lib/auth/permissions";
import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { createExam } from "@/lib/exams/builder";
import { createImportJob } from "@/lib/import/service";
import { listSchools, setSuspended } from "@/lib/platform/service";
import { createSchoolWithAdmin, saveClassesAndSubjects } from "@/lib/school/setup";
import { tenantScope, type TenantScope } from "@/lib/tenant/scope";
import { createTestDb } from "@/test/db";
import { featureBlock } from "./gate";
import { signBody, validSignature } from "./paystack";
import { applyTransaction, confirmPayment, quote, startCheckout } from "./service";
import { billingState, computeBilling, hasFeature } from "./state";

const DAY = 86_400_000;
const T0 = new Date("2026-10-01T09:00:00Z");

describe("billing rules", () => {
  const base = { schoolStatus: "trial", trialEndsAt: new Date(T0.getTime() + 30 * DAY), createdAt: T0, currentTerm: { id: "t1", startsOn: "2026-09-14", createdAt: T0 }, paid: [], activeStudents: 40 };

  it("trial gives every feature, then a grace period, then lapses", () => {
    expect(computeBilling(base, T0)).toMatchObject({ status: "trial", plan: "premium" });
    expect(computeBilling(base, new Date(T0.getTime() + 31 * DAY))).toMatchObject({ status: "grace", plan: "premium" });
    const lapsed = computeBilling(base, new Date(T0.getTime() + 45 * DAY));
    expect(lapsed).toMatchObject({ status: "lapsed", plan: null });
    expect(hasFeature(lapsed, "analytics")).toBe(false);
  });

  it("paying for this term makes the school active on the best plan paid", () => {
    const b = computeBilling({ ...base, paid: [{ termId: "t1", plan: "standard", paidAt: T0 }, { termId: "t1", plan: "premium", paidAt: T0 }] }, new Date(T0.getTime() + 90 * DAY));
    expect(b).toMatchObject({ status: "active", plan: "premium", paidPlan: "premium" });
  });

  it("a new unpaid term keeps last term's plan for 14 days after it starts", () => {
    const i = { ...base, trialEndsAt: new Date("2026-01-01"), paid: [{ termId: "old", plan: "standard" as const, paidAt: new Date("2026-05-01") }] };
    expect(computeBilling(i, new Date("2026-09-20T12:00:00Z"))).toMatchObject({ status: "grace", plan: "standard" });
    expect(computeBilling(i, new Date("2026-09-29T12:00:00Z"))).toMatchObject({ status: "lapsed", plan: null });
  });

  it("suspension overrides everything", () => {
    expect(computeBilling({ ...base, schoolStatus: "suspended", paid: [{ termId: "t1", plan: "premium", paidAt: T0 }] }, T0)).toMatchObject({ status: "suspended", plan: null, paidPlan: "premium" });
  });

  it("plans unlock their features", () => {
    const on = (plan: "starter" | "standard" | "premium") => computeBilling({ ...base, paid: [{ termId: "t1", plan, paidAt: T0 }] }, T0);
    expect(hasFeature(on("starter"), "report_cards")).toBe(false);
    expect([hasFeature(on("standard"), "report_cards"), hasFeature(on("standard"), "analytics"), hasFeature(on("standard"), "smart_import")]).toEqual([true, true, false]);
    expect(["report_cards", "analytics", "smart_import", "photo_import", "ai_assistant", "snapshots"].every((f) => hasFeature(on("premium"), f as never))).toBe(true);
  });
});

describe("payments", () => {
  let db: Db;
  let scope: TenantScope;
  let schoolId: string;
  let admin: Actor;
  let subjectId: string;
  const paystack = new Map<string, { status: string; amount: number }>();

  beforeAll(async () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_unit";
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    // Paystack's API, stubbed: initialize answers with a checkout URL; verify reports what we set.
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/transaction/initialize")) {
        const b = JSON.parse(String(init?.body));
        expect(init?.headers).toMatchObject({ Authorization: "Bearer sk_test_unit" });
        return Response.json({ status: true, data: { authorization_url: `https://checkout.paystack.com/${b.reference}`, reference: b.reference } });
      }
      const ref = decodeURIComponent(u.split("/transaction/verify/")[1] ?? "");
      const tx = paystack.get(ref);
      return Response.json({ status: true, data: { status: tx?.status ?? "abandoned", reference: ref, amount: tx?.amount ?? 0, currency: "NGN", id: 1, channel: "card", paid_at: "2026-10-02T10:00:00Z" } });
    });
    db = await createTestDb();
    const s = await createSchoolWithAdmin(db, { schoolName: "Pay School", adminName: "A", email: "a@pay.ng", password: "password-1" });
    schoolId = s.school.id;
    scope = tenantScope(db, schoolId);
    admin = { id: s.admin.id, roles: [{ role: "school_admin", schoolId }] };
    await saveClassesAndSubjects(scope, { levels: [{ code: "JSS1", arms: ["A"] }], subjects: [{ name: "Mathematics", stage: "all" }] });
    subjectId = (await scope.findMany(t.subject))[0].id;
    const arm = (await scope.findMany(t.classArm))[0].id;
    const [sess] = await scope.insert(t.academicSession, { name: "2026/2027", isCurrent: true });
    await scope.insert(t.term, { sessionId: sess.id, number: 1, isCurrent: true, startsOn: "2026-09-14" });
    for (let i = 0; i < 12; i++) await createStudentAccount(db, { schoolId, admissionNo: `P/${i}`, firstName: "S", lastName: String(i), classArmId: arm, password: "password-1" });
    // The trial is over and so is the grace period.
    await db.update(t.school).set({ trialEndsAt: new Date(Date.now() - 60 * DAY) }).where(eq(t.school.id, schoolId));
  });
  afterAll(() => vi.unstubAllGlobals());

  it("a lapsed school can't set exams or use paid features", async () => {
    expect((await billingState(db, schoolId)).status).toBe("lapsed");
    await expect(createExam(scope, admin, { title: "T", type: "ca_test", termId: (await scope.findMany(t.term))[0].id, subjectIds: [subjectId], classArmIds: [], durationMinutes: 30, calculator: "off" })).rejects.toThrow(/lapsed/);
    expect(await featureBlock(scope, "analytics")).toMatch(/lapsed/);
  });

  it("quotes per student and starts a Paystack checkout", async () => {
    expect(await quote(db, schoolId, "standard")).toMatchObject({ students: 12, pricePerStudent: 90_000, amount: 12 * 90_000, upgradeFrom: null });
    const officer: Actor = { id: admin.id, roles: [{ role: "exam_officer", schoolId }] };
    await expect(startCheckout(db, officer, "pay-school", schoolId, "standard", "a@pay.ng")).rejects.toThrow(/school admin/);
    const c = await startCheckout(db, admin, "pay-school", schoolId, "standard", "a@pay.ng");
    expect(c.authorizationUrl).toBe(`https://checkout.paystack.com/${c.reference}`);
    expect(await db.select().from(t.subscription).where(eq(t.subscription.reference, c.reference))).toEqual([expect.objectContaining({ status: "pending", amount: 1_080_000, studentCount: 12 })]);
  });

  it("a test payment activates the plan and unlocks its features (and only then)", async () => {
    const c = await startCheckout(db, admin, "pay-school", schoolId, "standard", "a@pay.ng");
    // Returning without paying changes nothing.
    expect(await confirmPayment(db, c.reference)).toMatchObject({ outcome: "failed" });
    const again = await startCheckout(db, admin, "pay-school", schoolId, "standard", "a@pay.ng");
    paystack.set(again.reference, { status: "success", amount: 1_080_000 });
    expect(await confirmPayment(db, again.reference)).toMatchObject({ outcome: "paid", plan: "standard" });
    expect(await confirmPayment(db, again.reference)).toMatchObject({ outcome: "already_paid" });
    const b = await billingState(db, schoolId);
    expect(b).toMatchObject({ status: "active", plan: "standard", paidPlan: "standard" });
    expect(await featureBlock(scope, "analytics")).toBeNull();
    expect(await featureBlock(scope, "smart_import")).toMatch(/Premium plan/);
    await expect(createImportJob(scope, admin, { kind: "word", title: "x.docx", subjectId, classLevelId: null, items: [], passages: [], sourceHtml: "", notes: [] } as never)).rejects.toThrow(/Premium plan/);
    expect((await db.select().from(t.school).where(eq(t.school.id, schoolId)))[0]).toMatchObject({ plan: "standard", status: "active" });
    expect(await db.select().from(t.auditLog).where(eq(t.auditLog.action, "billing.paid"))).toHaveLength(1);
  });

  it("upgrading mid-term charges the difference and unlocks Premium", async () => {
    expect(await quote(db, schoolId, "premium")).toMatchObject({ amount: 12 * 50_000, upgradeFrom: "standard" });
    await expect(quote(db, schoolId, "starter")).rejects.toThrow(/already paid/);
    const c = await startCheckout(db, admin, "pay-school", schoolId, "premium", "a@pay.ng");
    // Paid, but the wrong amount: refused and logged.
    expect(await applyTransaction(db, { status: "success", reference: c.reference, amount: 100, currency: "NGN", id: 9, channel: "card", paidAt: null })).toMatchObject({ outcome: "failed" });
    expect(await db.select().from(t.auditLog).where(eq(t.auditLog.action, "billing.mismatch"))).toHaveLength(1);
    const ok = await startCheckout(db, admin, "pay-school", schoolId, "premium", "a@pay.ng");
    paystack.set(ok.reference, { status: "success", amount: 600_000 });
    expect(await confirmPayment(db, ok.reference)).toMatchObject({ outcome: "paid" });
    expect(await featureBlock(scope, "smart_import")).toBeNull();
    expect((await billingState(db, schoolId)).plan).toBe("premium");
  });

  it("accepts webhooks only with Paystack's signature", () => {
    const body = JSON.stringify({ event: "charge.success", data: { reference: "x" } });
    expect(validSignature(body, signBody(body, "sk_test_unit"))).toBe(true);
    expect(validSignature(body, signBody(body, "sk_test_other"))).toBe(false);
    expect(validSignature(body + " ", signBody(body, "sk_test_unit"))).toBe(false);
    expect(validSignature(body, null)).toBe(false);
  });

  it("the platform owner lists schools and can suspend one (logged); nobody else can", async () => {
    const owner = await createPlatformOwner(db, { name: "Owner", email: "owner@x.ng", password: "password-1" });
    const ownerActor: Actor = { id: owner.id, roles: [{ role: "platform_owner", schoolId: null }] };
    await expect(listSchools(db, admin)).rejects.toThrow(/Platform owners/);
    const rows = await listSchools(db, ownerActor);
    expect(rows.find((r) => r.id === schoolId)).toMatchObject({ status: "active", paidPlan: "premium", students: 12, paidTotal: 1_680_000 });
    await expect(setSuspended(db, ownerActor, schoolId, true, "")).rejects.toThrow(/reason/);
    await setSuspended(db, ownerActor, schoolId, true, "Unpaid invoice dispute");
    expect((await billingState(db, schoolId)).status).toBe("suspended");
    expect(await featureBlock(scope, "analytics")).toMatch(/suspended/);
    await setSuspended(db, ownerActor, schoolId, false, "");
    expect((await billingState(db, schoolId)).status).toBe("active");
    expect((await db.select().from(t.auditLog).where(eq(t.auditLog.schoolId, schoolId))).filter((a) => a.action.startsWith("platform.")).map((a) => a.action).sort()).toEqual(["platform.reactivate", "platform.suspend"]);
  });
});
