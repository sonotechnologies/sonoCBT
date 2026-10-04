import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Features",
  description: "CBT exams from Word documents, offline-safe exam runtime, live monitoring, CA grid, broadsheet with positions, report cards with QR verification and a parent result checker — for Nigerian secondary schools.",
  alternates: { canonical: "/features" },
};

const FEATURES = [
  { who: "Exam officers", title: "Run exam day from one screen.", items: ["Integrity presets: Practice, Standard, Strict", "Live monitor with add time, reset and force submit", "Printable PIN sheets and seat lists", "Event timeline for every student", "One device per student, school-network-only exams"] },
  { who: "Teachers", title: "Upload first, edit second.", items: ["Smart import from Word with green, amber and red checks", "Maths with proper notation, pictures and passages", "Theory marking with the marking guide beside the answer", "CA grid that behaves like Excel, paste included"] },
  { who: "Students", title: "A quiet exam hall on any screen.", items: ["One question in focus, large legible text", "Flag questions and jump back", "Full keyboard use: A–D, P, F, N", "Answers saved even offline; the clock is the server's"] },
  { who: "Proprietors", title: "Know where every result stands.", items: ["Draft, review, approved, released — per class", "Who changed what, and when", "School-wide performance by subject and topic", "Students at risk, before the report card"] },
  { who: "Parents", title: "Results on the phone they already have.", items: ["Check results with a scratch-card PIN", "Download the A4 report card as PDF", "QR code proves the result is genuine"] },
];

export default function FeaturesPage() {
  return (
    <>
      <section className="mx-auto max-w-[1200px] px-5 pt-14 pb-8 lg:px-10">
        <h1 className="text-[40px] leading-tight font-extrabold tracking-tight md:text-5xl">Everything a term needs.</h1>
        <p className="mt-4 max-w-[640px] text-lg text-ink-2">One system for the people who set the exam, sit it, mark it and read the result.</p>
      </section>
      <section className="mx-auto grid max-w-[1200px] gap-4 px-5 pb-16 md:grid-cols-2 lg:grid-cols-3 lg:px-10">
        {FEATURES.map((f) => (
          <div key={f.who} className="rounded-xl border border-border bg-card p-6">
            <div className="text-sm font-bold tracking-wide text-[#8A430B] uppercase">{f.who}</div>
            <h2 className="mt-2 text-xl font-extrabold">{f.title}</h2>
            <ul className="mt-4 flex flex-col gap-2 text-[15px]">
              {f.items.map((it) => (
                <li key={it} className="flex gap-2.5">
                  <span aria-hidden className="mt-2 size-2 flex-none rounded-full bg-pencil" />
                  {it}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="flex flex-col justify-center rounded-xl bg-ink p-6 text-white">
          <h2 className="text-xl font-extrabold">See it with real data.</h2>
          <p className="mt-2 text-[15px] text-white/80">Walk around Crestview Model College as an admin, exam officer, teacher, student or parent. No sign-up.</p>
          <Link href="/demo" className="mt-4 self-start rounded-md bg-pencil px-4 py-2.5 font-bold text-ink no-underline">
            Try the demo school
          </Link>
        </div>
      </section>
    </>
  );
}
