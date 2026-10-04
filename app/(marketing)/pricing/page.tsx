import type { Metadata } from "next";
import { Faq } from "@/components/marketing/parts";
import { PricingPlans } from "@/components/marketing/pricing-plans";

export const metadata: Metadata = {
  title: "Pricing",
  description: "School CBT and result software priced per student, per term, from ₦500. No setup fee; pay by card or bank transfer. Every plan starts with a free 30-day trial.",
  alternates: { canonical: "/pricing" },
};

export default function PricingPage() {
  return (
    <>
      <section className="mx-auto max-w-[1200px] px-5 pt-14 pb-8 lg:px-10">
        <h1 className="text-[40px] leading-tight font-extrabold tracking-tight md:text-5xl">Priced per student, per term.</h1>
        <p className="mt-4 max-w-[640px] text-lg text-ink-2">No setup fee. Pay by card or bank transfer at the start of each term. Every school starts with 30 days free, with every feature on.</p>
      </section>
      <PricingPlans />
      <section className="mx-auto max-w-[860px] px-5 py-16 lg:px-10">
        <h2 className="mb-4 text-2xl font-extrabold">Questions</h2>
        <Faq />
      </section>
    </>
  );
}
