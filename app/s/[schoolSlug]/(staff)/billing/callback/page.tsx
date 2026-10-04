import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { buttonVariants } from "@/components/ui/button";
import { PaymentError } from "@/lib/billing/paystack";
import { planByCode } from "@/lib/billing/plans";
import { confirmPayment } from "@/lib/billing/service";
import { getDb } from "@/lib/db";
import { subscription } from "@/lib/db/schema";
import { requireCan } from "@/lib/tenant/context";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Payment" };

/** Where Paystack sends the admin back. We check with Paystack before believing it. */
export default async function PaymentCallback({ params, searchParams }: PageProps<"/s/[schoolSlug]/billing/callback">) {
  const { schoolSlug } = await params;
  const sp = await searchParams;
  const ctx = await requireCan(schoolSlug, "billing.manage");
  const reference = String(sp.reference ?? sp.trxref ?? "");
  const sub = reference ? await ctx.scope.findFirst(subscription, eq(subscription.reference, reference)) : undefined;
  let outcome: "paid" | "failed" | "waiting" | "unknown" = "unknown";
  let problem: string | null = null;
  if (sub) {
    try {
      const r = await confirmPayment(getDb(), reference);
      outcome = r.outcome === "paid" || r.outcome === "already_paid" ? "paid" : r.outcome === "failed" ? "failed" : "waiting";
    } catch (e) {
      if (!(e instanceof PaymentError)) throw e;
      outcome = "waiting";
      problem = e.message;
    }
  }
  const view = {
    paid: { title: `${sub ? planByCode(sub.plan).name : ""} is active`, body: "Payment received. Every feature on your plan is switched on for this term.", cls: "border-[#BFE0CB] bg-[#E8F4EC] text-[#155E34]" },
    failed: { title: "The payment didn't go through", body: "Nothing was charged. You can try again from Billing.", cls: "border-[#F2C6C2] bg-[#FBEAE9] text-[#7A1F18]" },
    waiting: { title: "Waiting for Paystack", body: problem ?? "We haven't had confirmation yet. If you paid, this page will update shortly; Paystack also tells us directly.", cls: "border-[#F3D3B5] bg-[#FDF1E6] text-[#7A3B0A]" },
    unknown: { title: "Payment not found", body: "That payment reference isn't one of this school's.", cls: "border-border bg-card text-foreground" },
  }[outcome];

  return (
    <main className="min-w-0 flex-1">
      <div className="mx-auto flex max-w-[560px] flex-col gap-4 px-4 py-12">
        <section role="status" className={cn("rounded-xl border p-6", view.cls)}>
          <h1 className="text-xl font-extrabold">{view.title}</h1>
          <p className="mt-2 text-[15px]">{view.body}</p>
          {reference && <p className="mt-3 font-mono text-xs opacity-80">{reference}</p>}
        </section>
        <div className="flex gap-2.5">
          <Link href={`/s/${schoolSlug}/billing`} className={cn(buttonVariants({ variant: "primary", size: "md" }), "no-underline")}>
            Back to Billing
          </Link>
          {outcome === "waiting" && (
            <Link href={`?reference=${encodeURIComponent(reference)}`} className={cn(buttonVariants({ variant: "outline", size: "md" }), "no-underline")}>
              Check again
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
