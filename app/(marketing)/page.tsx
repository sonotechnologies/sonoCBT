import type { Metadata } from "next";
import Link from "next/link";
import { Faq, PhoneMock } from "@/components/marketing/parts";
import { SITE, whatsappLink } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: "SonoCBT · CBT and results software for Nigerian schools" },
  description: SITE.description,
  alternates: { canonical: "/" },
};

const PILLARS = [
  { title: "Exams that survive bad network and power cuts.", body: "Answers save on the device first. A student whose PC restarts continues from the same question with the same time left." },
  { title: "Teachers keep writing in Word.", body: "Upload the document. SonoCBT reads questions, options and answers, and shows you exactly which ones need a second look." },
  { title: "Results you can stand behind.", body: "CA, exams and theory marks flow into one broadsheet. Nothing reaches parents until it has been reviewed and approved." },
];
const STEPS = [
  { n: "01", title: "Upload", body: "Drop in the Word document. Questions appear in seconds with a confidence badge each." },
  { n: "02", title: "Schedule", body: "Pick classes, a time and an integrity preset. Print PIN slips for the lab." },
  { n: "03", title: "Sit", body: "Students sit on lab PCs or phones. You watch every seat from the live monitor." },
  { n: "04", title: "Release", body: "Objectives mark themselves. Approve the broadsheet, print report cards, let parents check." },
];

export default function Home() {
  const wa = whatsappLink();
  return (
    <>
      <section className="mx-auto grid max-w-[1200px] items-center gap-12 px-5 pt-14 pb-16 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:px-10 lg:pt-20">
        <div>
          <div className="text-sm font-bold tracking-wide text-[#8A430B] uppercase">{SITE.tagline}</div>
          <h1 className="mt-4 text-[40px] leading-[1.05] font-extrabold tracking-tight md:text-[56px]">Exams and results your school can trust.</h1>
          <p className="mt-5 max-w-[560px] text-lg leading-relaxed text-ink-2">
            Upload the Word document your teachers already write. SonoCBT turns it into a computer-based exam that keeps working when the network doesn&apos;t, then marks it, builds the broadsheet and prints the report cards.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/demo" className="rounded-lg bg-ink px-6 py-3.5 text-base font-bold text-white no-underline">
              Try the demo school
            </Link>
            {wa ? (
              <a href={wa} className="rounded-lg border-[1.5px] border-ink px-6 py-3.5 text-base font-bold text-foreground no-underline">
                Book a demo on WhatsApp
              </a>
            ) : (
              <Link href="/pricing" className="rounded-lg border-[1.5px] border-ink px-6 py-3.5 text-base font-bold text-foreground no-underline">
                See pricing
              </Link>
            )}
          </div>
          <p className="mt-5 text-sm text-muted-foreground">JSS1–SS3 · 1st, 2nd and 3rd term · works on lab PCs and students&apos; phones</p>
        </div>
        <PhoneMock />
      </section>

      <section className="border-y border-border bg-card">
        <div className="mx-auto grid max-w-[1200px] gap-8 px-5 py-14 md:grid-cols-3 lg:px-10">
          {PILLARS.map((p) => (
            <div key={p.title}>
              <div className="flex gap-1.5" aria-hidden>
                <span className="size-3 rounded-full border-2 border-ink" />
                <span className="size-3 rounded-full bg-pencil" />
                <span className="size-3 rounded-full border-2 border-ink" />
              </div>
              <h2 className="mt-4 text-xl font-extrabold">{p.title}</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-5 py-16 lg:px-10">
        <h2 className="text-3xl font-extrabold tracking-tight">From Word document to released result.</h2>
        <ol className="mt-8 grid gap-4 md:grid-cols-4">
          {STEPS.map((s) => (
            <li key={s.n} className="rounded-xl border border-border bg-card p-5">
              <div className="font-mono text-sm font-semibold text-[#8A430B]">{s.n}</div>
              <div className="mt-1 text-lg font-extrabold">{s.title}</div>
              <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="bg-ink text-white">
        <div className="mx-auto grid max-w-[1200px] items-center gap-10 px-5 py-16 lg:grid-cols-2 lg:px-10">
          <div>
            <h2 className="text-3xl font-extrabold tracking-tight">When the network drops, the exam doesn&apos;t.</h2>
            <p className="mt-4 text-[17px] leading-relaxed text-white/80">
              Every answer is saved on the device first and synced when the connection returns. If a PC restarts, the student signs back in and continues from the same question with the same time left. The server keeps the clock, so nobody gains minutes by switching off.
            </p>
          </div>
          <div className="flex flex-col gap-3 text-[15px]">
            <div className="rounded-xl bg-[#FDF1E6] px-5 py-4 text-[#7A3B0A]">
              <strong>Offline — your answers are safe on this device.</strong> Keep going.
            </div>
            <div className="rounded-xl bg-[#E8F4EC] px-5 py-4 text-[#155E34]">
              <strong>Reconnected — all answers saved.</strong>
            </div>
            <div className="rounded-xl bg-white px-5 py-4 text-ink">
              <strong>Welcome back, Chiamaka.</strong> Continue from question 23.
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-[1200px] gap-10 px-5 py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:px-10">
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight">Report cards parents can check.</h2>
          <p className="mt-4 text-[17px] leading-relaxed text-ink-2">
            Positions with ties handled properly, class averages, highest and lowest, remarks, ratings and attendance — on an A4 PDF with your crest and colour, and a QR code that proves it&apos;s genuine. Parents check with a scratch-card PIN on any phone.
          </p>
          <Link href="/features" className="mt-5 inline-block font-bold">
            See every feature →
          </Link>
        </div>
        <div>
          <h2 className="mb-4 text-2xl font-extrabold">Questions schools ask</h2>
          <Faq />
        </div>
      </section>
    </>
  );
}
