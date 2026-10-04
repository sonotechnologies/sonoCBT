import type { Metadata } from "next";
import Link from "next/link";
import { SITE, whatsappLink } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact",
  description: "Book a demo of SonoCBT for your school, or ask us anything about CBT exams and report cards for Nigerian secondary schools.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  const wa = whatsappLink();
  return (
    <section className="mx-auto grid max-w-[1000px] gap-10 px-5 py-14 md:grid-cols-2 lg:px-10">
      <div>
        <h1 className="text-[40px] leading-tight font-extrabold tracking-tight">Talk to us.</h1>
        <p className="mt-4 text-lg text-ink-2">We&apos;ll show SonoCBT with your own Word papers, answer questions from your exam officer, and help you set up your first term.</p>
      </div>
      <div className="flex flex-col gap-3">
        {wa && (
          <a href={wa} className="flex flex-col rounded-xl bg-[#1F8A4C] px-5 py-4 text-white no-underline">
            <span className="text-lg font-extrabold">Book a demo on WhatsApp</span>
            <span className="text-sm text-white/85">Usually a reply the same working day</span>
          </a>
        )}
        <a href={`mailto:${SITE.email}?subject=${encodeURIComponent("SonoCBT for our school")}`} className="flex flex-col rounded-xl border border-border bg-card px-5 py-4 no-underline">
          <span className="text-lg font-extrabold text-foreground">Email {SITE.email}</span>
          <span className="text-sm text-muted-foreground">Tell us your school&apos;s name and how many students you have</span>
        </a>
        <Link href="/signup" className="flex flex-col rounded-xl border border-border bg-card px-5 py-4 no-underline">
          <span className="text-lg font-extrabold text-foreground">Start a free 30-day trial</span>
          <span className="text-sm text-muted-foreground">Set up your school yourself in about ten minutes</span>
        </Link>
        <Link href="/demo" className="flex flex-col rounded-xl border border-border bg-card px-5 py-4 no-underline">
          <span className="text-lg font-extrabold text-foreground">Try the demo school</span>
          <span className="text-sm text-muted-foreground">Every role, one click, no sign-up</span>
        </Link>
      </div>
    </section>
  );
}
