import Link from "next/link";
import { formatDate } from "@/lib/format";
import { planByCode } from "@/lib/billing/plans";
import type { BillingState } from "@/lib/billing/state";
import { cn } from "@/lib/utils";

const daysTo = (d: Date) => Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86_400_000));

/** A strip under the header when the trial is ending, payment is due, or the subscription has lapsed. */
export function BillingBanner({ billing: b, slug, canManage }: { billing: BillingState; slug: string; canManage: boolean }) {
  let text: string | null = null;
  let tone = "bg-[#EAF1F9] text-[#1D4B80]";
  if (b.status === "trial" && b.trialEndsAt && daysTo(b.trialEndsAt) <= 7 && canManage) {
    text = `Your free trial ends in ${daysTo(b.trialEndsAt)} days (${formatDate(b.trialEndsAt)}).`;
  } else if (b.status === "grace" && b.graceEndsAt) {
    tone = "bg-[#FDF1E6] text-[#7A3B0A]";
    text = `Payment due: ${planByCode(b.plan!).name} features stop on ${formatDate(b.graceEndsAt)} unless this term is paid.`;
  } else if (b.status === "lapsed") {
    tone = "bg-[#FBEAE9] text-[#7A1F18]";
    text = "The school's subscription has lapsed: paid features and new exams are paused. Your data is safe.";
  }
  if (!text) return null;
  return (
    <div role="status" className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-2.5 text-sm font-semibold lg:px-8 print:hidden", tone)}>
      <span>{text}</span>
      {canManage ? (
        <Link href={`/s/${slug}/billing`} className="underline">
          {b.status === "trial" ? "Choose a plan" : "Pay now"}
        </Link>
      ) : (
        <span className="font-normal">The school admin can sort this out in Billing.</span>
      )}
    </div>
  );
}
