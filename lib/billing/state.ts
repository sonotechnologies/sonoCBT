import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { school, student, subscription, term } from "@/lib/db/schema";
import { GRACE_DAYS, planByCode, TRIAL_DAYS, type Feature, type PlanCode } from "./plans";

const DAY = 86_400_000;

export type BillingStatus = "trial" | "active" | "grace" | "lapsed" | "suspended";

export type BillingState = {
  status: BillingStatus;
  /** The plan whose features apply now (Premium during the trial); null when lapsed or suspended. */
  plan: PlanCode | null;
  /** The plan paid for this term, if any. */
  paidPlan: PlanCode | null;
  trialEndsAt: Date | null;
  /** When paid features stop, in a grace period. */
  graceEndsAt: Date | null;
  currentTermId: string | null;
  activeStudents: number;
};

type Inputs = {
  schoolStatus: string;
  trialEndsAt: Date | null;
  createdAt: Date;
  currentTerm: { id: string; startsOn: string | null; createdAt: Date } | null;
  /** Paid subscriptions, newest first. */
  paid: { termId: string; plan: PlanCode; paidAt: Date | null }[];
  activeStudents: number;
};

const RANK: Record<PlanCode, number> = { starter: 1, standard: 2, premium: 3 };

/**
 * Works out where a school stands. Pure, so the rules are easy to test:
 * - paid for the current term → active on the best plan paid for that term;
 * - paid before, but not this term → grace for GRACE_DAYS after the term starts, then lapsed;
 * - never paid → the trial (all features), then GRACE_DAYS of grace, then lapsed;
 * - suspended by the platform owner overrides everything.
 */
export function computeBilling(i: Inputs, now = new Date()): BillingState {
  const trialEndsAt = i.trialEndsAt ?? new Date(i.createdAt.getTime() + TRIAL_DAYS * DAY);
  const base = { trialEndsAt, currentTermId: i.currentTerm?.id ?? null, activeStudents: i.activeStudents };
  const thisTerm = i.currentTerm ? i.paid.filter((p) => p.termId === i.currentTerm!.id) : [];
  const paidPlan = thisTerm.length ? thisTerm.map((p) => p.plan).sort((a, b) => RANK[b] - RANK[a])[0] : null;
  if (i.schoolStatus === "suspended") return { ...base, status: "suspended", plan: null, paidPlan, graceEndsAt: null };
  if (paidPlan) return { ...base, status: "active", plan: paidPlan, paidPlan, graceEndsAt: null };
  const last = i.paid[0];
  if (last) {
    // A new term has started without payment: the previous plan carries on for a while.
    const start = i.currentTerm?.startsOn ? new Date(`${i.currentTerm.startsOn}T00:00:00+01:00`) : (i.currentTerm?.createdAt ?? now);
    const graceEndsAt = new Date(start.getTime() + GRACE_DAYS * DAY);
    return now < graceEndsAt ? { ...base, status: "grace", plan: last.plan, paidPlan: null, graceEndsAt } : { ...base, status: "lapsed", plan: null, paidPlan: null, graceEndsAt };
  }
  if (now < trialEndsAt) return { ...base, status: "trial", plan: "premium", paidPlan: null, graceEndsAt: null };
  const graceEndsAt = new Date(trialEndsAt.getTime() + GRACE_DAYS * DAY);
  return now < graceEndsAt ? { ...base, status: "grace", plan: "premium", paidPlan: null, graceEndsAt } : { ...base, status: "lapsed", plan: null, paidPlan: null, graceEndsAt };
}

/** The single gate for paid features. */
export function hasFeature(b: BillingState, f: Feature): boolean {
  return !!b.plan && planByCode(b.plan).features.includes(f);
}

/** New exams can be made and published unless the school has lapsed or is suspended. */
export function canRunExams(b: BillingState): boolean {
  return b.status !== "lapsed" && b.status !== "suspended";
}

export async function billingState(db: Db, schoolId: string, now = new Date()): Promise<BillingState> {
  const [[sch], [cur], paid, [{ n }]] = await Promise.all([
    db.select().from(school).where(eq(school.id, schoolId)),
    db.select().from(term).where(and(eq(term.schoolId, schoolId), eq(term.isCurrent, true))),
    db
      .select({ termId: subscription.termId, plan: subscription.plan, paidAt: subscription.paidAt })
      .from(subscription)
      .where(and(eq(subscription.schoolId, schoolId), eq(subscription.status, "paid")))
      .orderBy(desc(subscription.paidAt)),
    db.select({ n: sql<number>`count(*)::int` }).from(student).where(and(eq(student.schoolId, schoolId), isNotNull(student.classArmId))),
  ]);
  return computeBilling(
    {
      schoolStatus: sch?.status ?? "trial",
      trialEndsAt: sch?.trialEndsAt ?? null,
      createdAt: sch?.createdAt ?? now,
      currentTerm: cur ? { id: cur.id, startsOn: cur.startsOn, createdAt: cur.createdAt } : null,
      paid,
      activeStudents: n,
    },
    now,
  );
}
