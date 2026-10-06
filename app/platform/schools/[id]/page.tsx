import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SuspendForm } from "@/components/platform/suspend-form";
import { naira, planByCode } from "@/lib/billing/plans";
import { paymentHistory } from "@/lib/billing/service";
import { billingState } from "@/lib/billing/state";
import { getDb } from "@/lib/db";
import { formatDate, formatTime } from "@/lib/format";
import { startSupportAction } from "@/lib/platform/actions";
import { requirePlatformOwner } from "@/lib/platform/context";
import { PlatformError, schoolDetail } from "@/lib/platform/service";
import { cn } from "@/lib/utils";
import { STATUS_CHIP } from "@/components/platform/status";

export const metadata: Metadata = { title: "School" };

const ACTION: Record<string, string> = {
  "platform.suspend": "Suspended",
  "platform.reactivate": "Reactivated",
  "platform.impersonate": "Support sign-in started",
  "platform.impersonate_end": "Support sign-in ended",
  "billing.paid": "Payment received",
  "billing.mismatch": "Payment amount didn't match",
};

export default async function PlatformSchool({ params }: PageProps<"/platform/schools/[id]">) {
  const { id } = await params;
  const { actor } = await requirePlatformOwner();
  const db = getDb();
  let detail: Awaited<ReturnType<typeof schoolDetail>> | null = null;
  try {
    detail = await schoolDetail(db, actor, id);
  } catch (e) {
    if (!(e instanceof PlatformError)) throw e;
  }
  if (!detail) notFound();
  const [b, payments] = await Promise.all([billingState(db, id), paymentHistory(db, id)]);
  const s = detail.school;

  return (
    <main className="mx-auto flex w-full max-w-[1100px] flex-col gap-6 px-4 pt-7 pb-12 lg:px-10">
      <div>
        <Link href="/platform" className="text-[13px] font-semibold text-muted-foreground">
          Schools
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-[28px] font-extrabold">{s.name}</h1>
          <span className={cn("rounded-full px-2.5 py-1 text-xs font-bold", STATUS_CHIP[b.status].cls)}>{STATUS_CHIP[b.status].label}</span>
        </div>
        <p className="mt-1 text-sm text-ink-2">
          {[s.locality, s.state, s.email, s.phone].filter(Boolean).join(" · ")} · joined {formatDate(s.createdAt)}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section aria-label="Plan" className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-extrabold">Plan</h2>
          <dl className="mt-3 flex flex-col gap-1.5 text-sm">
            <div>Paid this term: <b>{b.paidPlan ? planByCode(b.paidPlan).name : "no"}</b></div>
            <div>Features now: <b>{b.plan ? planByCode(b.plan).name : "core only"}</b></div>
            <div>Trial ends: <span className="font-mono">{b.trialEndsAt ? formatDate(b.trialEndsAt) : "—"}</span></div>
            {b.graceEndsAt && <div>Grace ends: <span className="font-mono">{formatDate(b.graceEndsAt)}</span></div>}
            <div>Students in classes: <span className="font-mono">{b.activeStudents}</span></div>
          </dl>
        </section>
        <section aria-label="Support sign-in" className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-extrabold">Support sign-in</h2>
          <p className="mt-1 text-sm text-ink-2">
            Sign in as {detail.admins[0]?.name ?? "the school admin"} for up to an hour to help them. It&apos;s recorded in the school&apos;s log, and they see who did what.
          </p>
          <form action={startSupportAction.bind(null, id)} className="mt-3">
            <button type="submit" disabled={!detail.admins.length} className="h-11 rounded-md bg-ink px-4 text-sm font-bold text-white disabled:opacity-50">
              Sign in as school admin
            </button>
          </form>
        </section>
        <section aria-label={s.status === "suspended" ? "Reactivate" : "Suspend"} className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-extrabold">{s.status === "suspended" ? "Suspended" : "Suspend"}</h2>
          <p className="mb-3 mt-1 text-sm text-ink-2">{s.status === "suspended" ? "Staff and students can't sign in. Nothing has been deleted." : "Stops staff and students signing in, e.g. after a dispute. Data is kept."}</p>
          <SuspendForm schoolId={id} suspended={s.status === "suspended"} demo={s.isDemo} />
        </section>
      </div>

      <section aria-labelledby="pay">
        <h2 id="pay" className="mb-2.5 text-lg font-extrabold">
          Payments
        </h2>
        {payments.length ? (
          <table className="stack-table w-full overflow-hidden rounded-xl border border-border bg-card text-sm">
            <thead className="bg-secondary text-left text-xs text-ink-2">
              <tr>
                <th className="px-4 py-2.5">Date</th>
                <th className="px-4 py-2.5">Plan</th>
                <th className="px-4 py-2.5 text-right">Students</th>
                <th className="px-4 py-2.5 text-right">Amount</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Reference</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-t border-divider">
                  <td className="px-4 py-2.5 font-mono text-[13px]">{formatDate(p.paidAt ?? p.createdAt)}</td>
                  <td data-label="Plan" className="px-4 py-2.5">{planByCode(p.plan).name}</td>
                  <td data-label="Students" className="px-4 py-2.5 text-right font-mono">{p.studentCount}</td>
                  <td data-label="Amount" className="px-4 py-2.5 text-right font-mono">{naira(p.amount)}</td>
                  <td data-label="Status" className="px-4 py-2.5">{p.status}</td>
                  <td data-label="Reference" className="px-4 py-2.5 font-mono text-xs">{p.reference}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-muted-foreground">No payments yet.</p>
        )}
      </section>

      <section aria-labelledby="log">
        <h2 id="log" className="mb-2.5 text-lg font-extrabold">
          Account log
        </h2>
        {detail.log.length ? (
          <ul className="rounded-xl border border-border bg-card text-sm">
            {detail.log.map((l, i) => (
              <li key={i} className="flex flex-wrap gap-x-3 border-t border-divider px-4 py-2.5 first:border-t-0">
                <span className="font-mono text-[13px] text-muted-foreground">
                  {formatDate(l.at)} {formatTime(l.at)}
                </span>
                <span className="font-semibold">{ACTION[l.action] ?? l.action}</span>
                <span className="text-ink-2">{l.who ?? "System"}</span>
                {(l.meta as { reason?: string } | null)?.reason && <span className="text-ink-2">· {(l.meta as { reason: string }).reason}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing yet.</p>
        )}
      </section>
    </main>
  );
}
