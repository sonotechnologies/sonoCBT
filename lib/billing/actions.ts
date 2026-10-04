"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { requireCan } from "@/lib/tenant/context";
import { PaymentError } from "./paystack";
import type { PlanCode } from "./plans";
import { startCheckout } from "./service";

const CODES: PlanCode[] = ["starter", "standard", "premium"];

/** "Pay with Paystack": records the pending payment and sends the admin to the checkout page. */
export async function checkoutAction(slug: string, plan: string) {
  const ctx = await requireCan(slug, "billing.manage");
  if (!CODES.includes(plan as PlanCode)) redirect(`/s/${slug}/billing?error=${encodeURIComponent("Choose a plan.")}`);
  let url: string;
  try {
    url = (await startCheckout(getDb(), ctx.actor, slug, ctx.school.id, plan as PlanCode, ctx.user.email)).authorizationUrl;
  } catch (e) {
    if (!(e instanceof PaymentError)) throw e;
    redirect(`/s/${slug}/billing?error=${encodeURIComponent(e.message)}`);
  }
  redirect(url);
}
