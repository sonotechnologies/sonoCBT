import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { getDb } from "@/lib/db";
import { formatDate, num } from "@/lib/format";
import { ordinal } from "@/lib/grading";
import { verifyReportCard } from "@/lib/results/verify";

export const metadata: Metadata = { title: "Report card check", robots: { index: false, follow: false } };

export default async function VerifyCodePage({ params }: PageProps<"/verify/[code]">) {
  const { code } = await params;
  const res = await verifyReportCard(getDb(), decodeURIComponent(code));

  return (
    <main className="flex min-h-dvh flex-1 flex-col bg-background">
      <header className="flex h-14 flex-none items-center border-b border-border bg-card px-5">
        <Logo size={20} />
      </header>
      <div className="mx-auto flex w-full max-w-[560px] flex-1 flex-col gap-4 px-5 py-6">
        {res.status === "unknown" ? (
          <section role="alert" className="rounded-xl border border-[#F2C6C2] bg-[#FBEAE9] p-5">
            <h1 className="text-xl font-extrabold text-[#A1271F]">✕ No report card has this code</h1>
            <p className="mt-2 text-[15px] leading-normal text-[#7A1F18]">
              Check the code against the card. If it&apos;s typed correctly, this card was not issued through SonoCBT — contact the school.
            </p>
          </section>
        ) : res.status === "withdrawn" ? (
          <section role="alert" className="rounded-xl border border-[#F3D3B5] bg-[#FDF1E6] p-5">
            <h1 className="text-xl font-extrabold text-[#8A430B]">! This result has been withdrawn</h1>
            <p className="mt-2 text-[15px] leading-normal text-[#7A3B0A]">
              {res.schoolName} has taken back the {res.termLabel} result for this card, usually to correct it. Ask the school for the corrected report card.
            </p>
          </section>
        ) : (
          <>
            <section className="rounded-xl border border-[#BFE0CB] bg-[#E8F4EC] p-5">
              <h1 className="text-xl font-extrabold text-[#155E34]">✓ Genuine report card</h1>
              <p className="mt-1.5 text-[15px] leading-normal text-[#1F4D33]">
                Issued by <b>{res.card.school.name}</b>
                {res.card.issuedOn ? ` on ${formatDate(res.card.issuedOn)}` : ""}. These are the school&apos;s records today; the printed card should show the same.
              </p>
            </section>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border bg-card p-5 text-[15px] sm:grid-cols-3">
              {[
                ["Student", res.card.student.name],
                ["Class", res.card.classArmName],
                ["Term", res.card.termLabel],
                ["Average", `${num(res.card.average)}%`],
                ["Position", `${ordinal(res.card.position)} of ${res.card.numberInClass}`],
                ["Code", res.card.verifyCode ?? ""],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs font-semibold text-muted-foreground">{k}</dt>
                  <dd className={k === "Code" || k === "Average" || k === "Position" ? "font-mono font-semibold" : "font-bold"}>{v}</dd>
                </div>
              ))}
            </dl>
            <table className="w-full overflow-hidden rounded-xl border border-border bg-card text-sm">
              <caption className="sr-only">Subjects</caption>
              <thead className="bg-secondary text-left text-xs text-ink-2">
                <tr>
                  <th className="px-4 py-2.5">Subject</th>
                  <th className="px-4 py-2.5 text-right">Total</th>
                  <th className="px-4 py-2.5 text-center">Grade</th>
                </tr>
              </thead>
              <tbody>
                {res.card.subjects.map((s) => (
                  <tr key={s.name} className="border-t border-divider">
                    <td className="px-4 py-2.5 font-semibold">{s.name}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{num(s.total)}</td>
                    <td className="px-4 py-2.5 text-center font-mono font-bold">{s.grade}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <Link href="/verify" className="text-sm font-semibold underline">
          Check another code
        </Link>
      </div>
    </main>
  );
}
