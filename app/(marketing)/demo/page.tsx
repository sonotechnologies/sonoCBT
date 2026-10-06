import type { Metadata } from "next";
import Link from "next/link";
import { enterDemoAction, type DemoRole } from "@/lib/demo/actions";
import { DEMO_PEOPLE, demoEnabled } from "@/lib/demo/config";

export const metadata: Metadata = {
  title: "Try the demo school",
  description: "Walk around Crestview Model College as an admin, exam officer, teacher, student or parent. One click, no sign-up; the demo resets every night.",
  alternates: { canonical: "/demo" },
};

const ROLES: { role: DemoRole; label: string; initial: string; who: string; body: string }[] = [
  { role: "admin", label: "Admin", initial: "A", who: DEMO_PEOPLE.admin.name, body: "See the term at a glance, release results, print report cards and check analytics for every class." },
  { role: "examOfficer", label: "Exam officer", initial: "E", who: DEMO_PEOPLE.examOfficer.name, body: "Watch the JSS3 mock that's running now on the live monitor, and handle a flagged student." },
  { role: "teacher", label: "Teacher", initial: "T", who: DEMO_PEOPLE.teacher.name, body: "Mark theory answers from the mock with the guide beside them, then try smart import with a sample Word paper." },
  { role: "student", label: "Student", initial: "S", who: "a new student in JSS3A", body: "Sit the JSS3 mock: maths notation, a diagram and a theory question. Switch off your Wi-Fi mid-way if you like." },
  { role: "parent", label: "Parent", initial: "P", who: "a parent", body: "Open a released report card on your phone, download the A4 PDF and check its QR code." },
];

const SAMPLES = [
  ["sample-basic-science-exam.docx", "Basic Science · JSS3 exam", "Numbered questions with “Ans:” lines"],
  ["sample-mathematics-with-theory.docx", "Mathematics · JSS3 with theory", "Objective and theory sections, maths notation"],
  ["sample-english-comprehension.docx", "English · JSS2 comprehension", "A passage with its questions"],
];

export default async function DemoPage({ searchParams }: PageProps<"/demo">) {
  const { error } = await searchParams;
  const on = demoEnabled();
  const problem = error === "off" || !on ? "One-click demo sign-in is switched off on this server." : error === "missing" ? "The demo school is being rebuilt. Try again in a minute." : typeof error === "string" ? error : null;
  return (
    <>
      <section className="mx-auto max-w-[1200px] px-5 pt-14 pb-8 lg:px-10">
        <h1 className="text-[40px] leading-tight font-extrabold tracking-tight md:text-5xl">Walk around Crestview Model College.</h1>
        <p className="mt-4 max-w-[680px] text-lg text-ink-2">
          A demo school in Ibadan with real-looking classes, exams and results. Pick a role — no sign-up, and nothing you do here affects a real school. Everything resets every night.
        </p>
        {problem && (
          <p role="alert" className="mt-5 max-w-[680px] rounded-lg border border-[#F3D3B5] bg-[#FDF1E6] px-4 py-3 text-[15px] font-semibold text-[#7A3B0A]">
            {problem}
          </p>
        )}
      </section>
      <section className="mx-auto grid max-w-[1200px] gap-4 px-5 pb-12 md:grid-cols-2 lg:grid-cols-5 lg:px-10" aria-label="Choose a role">
        {ROLES.map((r) => (
          <form key={r.role} action={enterDemoAction.bind(null, r.role)} className="flex">
            <button
              type="submit"
              disabled={!on}
              aria-label={`Enter as ${r.label}`}
              className="grid w-full grid-cols-[40px_1fr] items-start gap-x-3.5 gap-y-1.5 rounded-xl border border-border bg-card p-4 text-left sm:flex sm:flex-col sm:gap-3 sm:p-5 transition hover:border-ink hover:shadow-[0_4px_12px_rgba(20,33,61,.08)] disabled:opacity-60"
            >
              <span className="row-span-4 flex size-10 items-center justify-center rounded-full bg-ink text-base font-extrabold text-white sm:size-11 sm:text-lg" aria-hidden>
                {r.initial}
              </span>
              <span className="text-[17px] leading-tight font-extrabold sm:text-lg">{r.label}</span>
              <span className="flex-1 text-sm leading-snug text-ink-2 sm:leading-relaxed">{r.body}</span>
              <span className="text-xs text-muted-foreground">
                Signed in as <strong className="text-foreground">{r.who}</strong>
              </span>
              <span className="text-sm font-bold">Enter as {r.label} →</span>
            </button>
          </form>
        ))}
      </section>
      <section className="border-t border-border bg-card">
        <div className="mx-auto grid max-w-[1200px] gap-8 px-5 py-12 md:grid-cols-2 lg:px-10">
          <div>
            <h2 className="text-2xl font-extrabold">Try smart import with your own eyes</h2>
            <p className="mt-2 text-[15px] text-ink-2">Download a sample paper, then as the Teacher open Smart import and upload it. Or try a paper of your own.</p>
            <ul className="mt-4 flex flex-col gap-2">
              {SAMPLES.map(([file, title, note]) => (
                <li key={file}>
                  <a href={`/samples/${file}`} download className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 no-underline">
                    <span className="rounded bg-[#2B579A] px-1.5 py-0.5 font-mono text-[11px] font-bold text-white">DOCX</span>
                    <span>
                      <span className="block font-bold text-foreground">{title}</span>
                      <span className="text-sm text-muted-foreground">{note}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-2xl font-extrabold">Check a result the way parents do</h2>
            <p className="mt-2 text-[15px] text-ink-2">
              Go to the{" "}
              <Link href="/results?school=crestview" className="font-bold">
                result checker
              </Link>{" "}
              and enter:
            </p>
            <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 rounded-lg border border-border bg-background px-4 py-3 text-[15px]">
              <dt className="text-muted-foreground">Admission no.</dt>
              <dd className="font-mono font-semibold">CMC/2023/0101</dd>
              <dt className="text-muted-foreground">PIN</dt>
              <dd className="font-mono font-semibold">2504 1336 9087</dd>
              <dt className="text-muted-foreground">Term</dt>
              <dd className="font-semibold">3rd Term · 2025/2026</dd>
            </dl>
            <p className="mt-3 text-sm text-muted-foreground">Try PIN 6172 5093 8442 with 1st Term · 2026/2027 to see what happens before results are released.</p>
          </div>
        </div>
      </section>
    </>
  );
}
