import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { mockComplete, safeCallback } from "@/lib/billing/mock";
import { mockMode } from "@/lib/billing/paystack";
import { naira } from "@/lib/billing/plans";

export const metadata: Metadata = { title: "Test checkout", robots: { index: false } };

/**
 * Stand-in for Paystack's hosted checkout, for development without Paystack
 * keys (PAYSTACK_MOCK=1). With real test keys, schools go to Paystack instead.
 */
export default async function MockCheckout({ searchParams }: PageProps<"/dev/paystack-checkout">) {
  if (!mockMode()) notFound();
  const sp = await searchParams;
  const reference = String(sp.reference ?? "");
  const amount = Number(sp.amount ?? 0);
  const callback = safeCallback(typeof sp.callback === "string" ? sp.callback : null);
  if (!reference || !callback) notFound();

  async function finish(outcome: "success" | "failed") {
    "use server";
    await mockComplete(getDb(), reference, outcome);
    redirect(`${callback}?reference=${encodeURIComponent(reference)}`);
  }

  return (
    <main className="flex min-h-dvh flex-1 items-center justify-center bg-[#EEF1F5] p-6">
      <div className="w-full max-w-[400px] rounded-2xl bg-white p-7 shadow-[0_12px_40px_rgba(20,33,61,.12)]">
        <p className="rounded-md bg-[#FDF1E6] px-3 py-2 text-xs font-semibold text-[#7A3B0A]">Test mode stand-in for Paystack · no real money moves</p>
        <div className="mt-5 text-sm text-ink-2">{String(sp.email ?? "")}</div>
        <div className="mt-1 text-xs text-muted-foreground">Pay</div>
        <div className="font-mono text-3xl font-semibold">{naira(amount)}</div>
        <div className="mt-1 font-mono text-xs text-muted-foreground">{reference}</div>
        <form className="mt-6 flex flex-col gap-2.5">
          <button formAction={finish.bind(null, "success")} className="h-12 rounded-md bg-[#0BA4DB] text-[15px] font-bold text-white">
            Pay with test card
          </button>
          <button formAction={finish.bind(null, "failed")} className="h-11 rounded-md border-[1.5px] border-input text-sm font-semibold">
            Decline payment
          </button>
        </form>
      </div>
    </main>
  );
}
