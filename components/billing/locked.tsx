import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { lockedMessage } from "@/lib/billing/gate";
import { FEATURE_LABEL, planFor, type Feature } from "@/lib/billing/plans";
import type { BillingState } from "@/lib/billing/state";
import { cn } from "@/lib/utils";

/** Shown in place of a paid feature the school's plan doesn't include. */
export function Locked({ feature, billing, slug, canManage, compact }: { feature: Feature; billing: BillingState; slug: string; canManage: boolean; compact?: boolean }) {
  const plan = planFor(feature);
  return (
    <section aria-label={`${FEATURE_LABEL[feature]} locked`} className={cn("rounded-xl border border-border bg-card", compact ? "p-5" : "mx-auto my-10 max-w-[560px] p-8 text-center")}>
      <div className={cn("inline-flex rounded-full bg-[#FFF4CC] px-2.5 py-1 text-xs font-bold text-[#7A5B00]", !compact && "mb-3")}>{plan.name} plan</div>
      <h2 className={cn("font-extrabold", compact ? "mt-2 text-base" : "text-xl")}>{FEATURE_LABEL[feature]}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{lockedMessage(billing, feature)}</p>
      {canManage ? (
        <Link href={`/s/${slug}/billing?plan=${plan.code}`} className={cn(buttonVariants({ variant: "primary", size: "md" }), "mt-4 no-underline")}>
          See plans
        </Link>
      ) : (
        <p className="mt-3 text-[13px] font-semibold text-muted-foreground">Ask your school admin about upgrading.</p>
      )}
    </section>
  );
}
