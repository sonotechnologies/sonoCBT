import type { Metadata } from "next";
import Link from "next/link";
import { naira, planByCode } from "@/lib/billing/plans";
import { getDb } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { requirePlatformOwner } from "@/lib/platform/context";
import { listSchools } from "@/lib/platform/service";
import { STATUS_CHIP } from "@/components/platform/status";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Schools" };


export default async function PlatformHome() {
  const { actor } = await requirePlatformOwner();
  const schools = await listSchools(getDb(), actor);
  const count = (s: string) => schools.filter((x) => x.status === s).length;
  const stats: [string, string][] = [
    ["Schools", String(schools.length)],
    ["Paying this term", String(count("active"))],
    ["On trial", String(count("trial"))],
    ["Payment due or lapsed", String(count("grace") + count("lapsed"))],
    ["Students", schools.reduce((a, s) => a + s.students, 0).toLocaleString("en-NG")],
  ];
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-4 pt-7 pb-12 lg:px-10">
      <h1 className="text-[28px] font-extrabold">Schools</h1>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {stats.map(([k, v]) => (
          <div key={k} className="rounded-xl border border-border bg-card px-4 py-3.5">
            <dt className="text-[13px] text-muted-foreground">{k}</dt>
            <dd className="mt-1 font-mono text-2xl font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-left text-xs text-ink-2">
            <tr>
              <th className="px-4 py-2.5">School</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5">Plan</th>
              <th className="px-3 py-2.5 text-right">Students</th>
              <th className="px-3 py-2.5 text-right">Staff</th>
              <th className="px-3 py-2.5">Last active</th>
              <th className="px-4 py-2.5 text-right">Paid to date</th>
            </tr>
          </thead>
          <tbody>
            {schools.map((s) => (
              <tr key={s.id} className="border-t border-divider">
                <td className="px-4 py-3">
                  <Link href={`/platform/schools/${s.id}`} className="font-bold">
                    {s.name}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {[s.locality, s.slug, s.isDemo ? "demo" : null].filter(Boolean).join(" · ")}
                  </div>
                </td>
                <td className="px-3 py-3">
                  <span className={cn("rounded-full px-2.5 py-1 text-xs font-bold", STATUS_CHIP[s.status].cls)}>{STATUS_CHIP[s.status].label}</span>
                  {s.status === "trial" && s.trialEndsAt && <div className="mt-1 text-xs text-muted-foreground">ends {formatDate(s.trialEndsAt)}</div>}
                </td>
                <td className="px-3 py-3">{s.paidPlan ? planByCode(s.paidPlan).name : s.plan ? `${planByCode(s.plan).name} (unpaid)` : "—"}</td>
                <td className="px-3 py-3 text-right font-mono">{s.students}</td>
                <td className="px-3 py-3 text-right font-mono">{s.staff}</td>
                <td className="px-3 py-3 font-mono text-[13px]">{s.lastActive ? formatDate(s.lastActive) : "—"}</td>
                <td className="px-4 py-3 text-right font-mono">{naira(s.paidTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
