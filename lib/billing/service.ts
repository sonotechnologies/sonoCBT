import "server-only";
import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { can, type Actor } from "@/lib/auth/permissions";
import type { Db } from "@/lib/db/client";
import { school, subscription, term, user } from "@/lib/db/schema";
import { appUrl } from "@/lib/pdf/assets";
import { initializeTransaction, PaymentError, verifyTransaction, type VerifiedTransaction } from "./flutterwave";
import { planByCode, type PlanCode } from "./plans";
import { billingState } from "./state";

const RANK: Record<PlanCode, number> = { starter: 1, standard: 2, premium: 3 };

export type Quote = { plan: PlanCode; students: number; pricePerStudent: number; amount: number; upgradeFrom: PlanCode | null; termId: string };

/**
 * What the school pays now for a plan this term, in kobo: students × price,
 * or only the difference when upgrading a plan already paid for this term.
 */
export async function quote(db: Db, schoolId: string, plan: PlanCode, now = new Date()): Promise<Quote> {
  const b = await billingState(db, schoolId, now);
  if (!b.currentTermId) throw new PaymentError("Set the current term first (School setup → Session).");
  if (b.activeStudents < 1) throw new PaymentError("Add your students first: the price is per student.");
  const price = planByCode(plan).naira * 100;
  if (b.paidPlan && RANK[plan] <= RANK[b.paidPlan]) throw new PaymentError(`This term is already paid on ${planByCode(b.paidPlan).name}.`);
  const already = b.paidPlan ? planByCode(b.paidPlan).naira * 100 : 0;
  return { plan, students: b.activeStudents, pricePerStudent: price, amount: (price - already) * b.activeStudents, upgradeFrom: b.paidPlan, termId: b.currentTermId };
}

/** Creates a pending payment and returns Flutterwave's checkout page to send the admin to. */
export async function startCheckout(db: Db, actor: Actor, slug: string, schoolId: string, plan: PlanCode, email: string, now = new Date()) {
  if (!can(actor, "billing.manage", { schoolId })) throw new PaymentError("Only the school admin can pay for the school.");
  const [s] = await db.select({ isDemo: school.isDemo }).from(school).where(eq(school.id, schoolId));
  if (s?.isDemo) throw new PaymentError("The demo school can't make payments. Sign up for a free trial to try billing for your own school.");
  const q = await quote(db, schoolId, plan, now);
  const reference = `SNC-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${randomBytes(5).toString("hex").toUpperCase()}`;
  const [sub] = await db
    .insert(subscription)
    .values({ schoolId, termId: q.termId, plan, studentCount: q.students, pricePerStudent: q.pricePerStudent, amount: q.amount, reference, createdBy: actor.id })
    .returning();
  const { authorizationUrl } = await initializeTransaction({
    email,
    amountKobo: q.amount,
    reference,
    callbackUrl: `${appUrl()}/s/${slug}/billing/callback`,
    metadata: { schoolId, subscriptionId: sub.id, plan, students: q.students },
  });
  return { reference, authorizationUrl };
}

export type Applied = { outcome: "paid" | "already_paid" | "failed" | "unknown"; plan?: PlanCode; schoolId?: string };

/**
 * Records what Flutterwave says about a payment. Used by both the webhook and
 * the return page, so it must be safe to run twice; the amount and currency
 * must match what we asked for.
 */
export async function applyTransaction(db: Db, tx: VerifiedTransaction, now = new Date()): Promise<Applied> {
  const [sub] = await db.select().from(subscription).where(eq(subscription.reference, tx.reference));
  if (!sub) return { outcome: "unknown" };
  if (sub.status === "paid") return { outcome: "already_paid", plan: sub.plan, schoolId: sub.schoolId };
  const ok = tx.status === "success" && Number(tx.amount) === sub.amount && tx.currency === sub.currency;
  if (!ok) {
    if (tx.status === "success") {
      // Paid, but not what we asked for: keep it for a human to look at.
      await audit(db, { schoolId: sub.schoolId, actorUserId: null, action: "billing.mismatch", entityType: "subscription", entityId: sub.id, meta: { expected: sub.amount, got: tx.amount, currency: tx.currency } });
    }
    if (tx.status === "failed" || tx.status === "success") await db.update(subscription).set({ status: "failed" }).where(and(eq(subscription.id, sub.id), eq(subscription.status, "pending")));
    return { outcome: "failed", schoolId: sub.schoolId };
  }
  return db.transaction(async (t) => {
    const [done] = await t
      .update(subscription)
      .set({ status: "paid", paidAt: tx.paidAt ? new Date(tx.paidAt) : now, channel: tx.channel, providerTransactionId: String(tx.id) })
      .where(and(eq(subscription.id, sub.id), eq(subscription.status, "pending")))
      .returning();
    if (!done) return { outcome: "already_paid" as const, plan: sub.plan, schoolId: sub.schoolId };
    // The school's plan is the best one paid for this term.
    const paid = await t.select({ plan: subscription.plan }).from(subscription).where(and(eq(subscription.schoolId, sub.schoolId), eq(subscription.termId, sub.termId), eq(subscription.status, "paid")));
    const best = paid.map((p) => p.plan).sort((a, b) => RANK[b] - RANK[a])[0];
    await t.update(school).set({ plan: best, status: "active" }).where(and(eq(school.id, sub.schoolId)));
    await audit(t as unknown as Db, {
      schoolId: sub.schoolId,
      actorUserId: sub.createdBy,
      action: "billing.paid",
      entityType: "subscription",
      entityId: sub.id,
      meta: { plan: sub.plan, amount: sub.amount, students: sub.studentCount, reference: sub.reference },
    });
    return { outcome: "paid" as const, plan: sub.plan, schoolId: sub.schoolId };
  });
}

/** The return page: ask Flutterwave, then record it. */
export async function confirmPayment(db: Db, reference: string): Promise<Applied> {
  return applyTransaction(db, await verifyTransaction(reference));
}

/** Payments for the billing page (the school's own) and the owner console. */
export async function paymentHistory(db: Db, schoolId: string) {
  return db
    .select({
      id: subscription.id,
      plan: subscription.plan,
      studentCount: subscription.studentCount,
      amount: subscription.amount,
      reference: subscription.reference,
      status: subscription.status,
      paidAt: subscription.paidAt,
      createdAt: subscription.createdAt,
      channel: subscription.channel,
      termNumber: term.number,
      by: user.name,
    })
    .from(subscription)
    .innerJoin(term, eq(term.id, subscription.termId))
    .leftJoin(user, eq(user.id, subscription.createdBy))
    .where(eq(subscription.schoolId, schoolId))
    .orderBy(desc(subscription.createdAt));
}
