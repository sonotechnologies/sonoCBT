import type { TenantScope } from "@/lib/tenant/scope";
import { FEATURE_LABEL, planFor, type Feature } from "./plans";
import { billingState, canRunExams, hasFeature, type BillingState } from "./state";

export function schoolBilling(scope: TenantScope, now?: Date): Promise<BillingState> {
  return scope.query((db) => billingState(db, scope.schoolId, now));
}

export function lockedMessage(b: BillingState, f: Feature): string {
  if (b.status === "suspended") return "This school's account is suspended. Contact SonoCBT.";
  if (b.status === "lapsed") return `The school's subscription has lapsed, so ${FEATURE_LABEL[f].toLowerCase()} is paused. The school admin can renew in Billing.`;
  return `${FEATURE_LABEL[f]} is on the ${planFor(f).name} plan. The school admin can upgrade in Billing.`;
}

/** Null when the school may use the feature, otherwise a message to show. */
export async function featureBlock(scope: TenantScope, f: Feature): Promise<string | null> {
  const b = await schoolBilling(scope);
  return hasFeature(b, f) ? null : lockedMessage(b, f);
}

/** Null when the school may set and publish new exams. */
export async function examsBlock(scope: TenantScope): Promise<string | null> {
  const b = await schoolBilling(scope);
  if (canRunExams(b)) return null;
  return b.status === "suspended" ? "This school's account is suspended. Contact SonoCBT." : "The school's subscription has lapsed, so new exams can't be set. The school admin can renew in Billing.";
}
