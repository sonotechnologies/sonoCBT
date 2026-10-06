import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { checkoutAction } from "@/lib/billing/actions";
import { paymentsReady } from "@/lib/billing/flutterwave";
import { naira, PLANS, planByCode, type PlanCode } from "@/lib/billing/plans";
import { paymentHistory } from "@/lib/billing/service";
import { billingState } from "@/lib/billing/state";
import { getDb } from "@/lib/db";
import { term } from "@/lib/db/schema";
import { formatDate, termLabel } from "@/lib/format";
import { requireCan } from "@/lib/tenant/context";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Billing" };

const RANK: Record<PlanCode, number> = { starter: 1, standard: 2, premium: 3 };
const days = (d: Date) => Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86_400_000));

export default async function BillingPage({ params, searchParams }: PageProps<"/s/[schoolSlug]/billing">) {
  const { schoolSlug } = await params;
  const sp = await searchParams;
  const ctx = await requireCan(schoolSlug, "billing.manage");
  const db = getDb();
  const [b, history] = await Promise.all([billingState(db, ctx.school.id), paymentHistory(db, ctx.school.id)]);
  const cur = b.currentTermId ? await ctx.scope.findFirst(term, eq(term.id, b.currentTermId)) : null;
  const curLabel = cur ? termLabel(cur.number, (await ctx.scope.query((d) => d.query.academicSession.findFirst({ where: (s, { eq: e }) => e(s.id, cur.sessionId) })))?.name ?? "") : "this term";
  const ready = paymentsReady();
  const error = typeof sp.error === "string" ? sp.error : null;
  const want = typeof sp.plan === "string" ? sp.plan : null;

  const banner =
    b.status === "trial"
      ? { tone: "info", title: `Free trial · ${days(b.trialEndsAt!)} days left`, body: `Every feature is on until ${formatDate(b.trialEndsAt!)}. Choose a plan any time; you pay per student for the term.` }
      : b.status === "active"
        ? { tone: "good", title: `${planByCode(b.paidPlan!).name} · paid for ${curLabel}`, body: `Thank you. Your plan renews at the start of next term.` }
        : b.status === "grace"
          ? { tone: "warn", title: "Payment due", body: `Pay for ${curLabel} by ${formatDate(b.graceEndsAt!)} to keep ${planByCode(b.plan!).name} features. Until then everything keeps working.` }
          : b.status === "lapsed"
            ? { tone: "bad", title: "Subscription lapsed", body: "Paid features and new exams are paused. Your data is safe; pay for this term to switch everything back on." }
            : { tone: "bad", title: "Account suspended", body: "Contact SonoCBT to reactivate your school." };
  const tone = { info: "border-[#C5D6EA] bg-[#EAF1F9] text-[#1D4B80]", good: "border-[#BFE0CB] bg-[#E8F4EC] text-[#155E34]", warn: "border-[#F3D3B5] bg-[#FDF1E6] text-[#7A3B0A]", bad: "border-[#F2C6C2] bg-[#FBEAE9] text-[#7A1F18]" }[banner.tone];

  return (
    <main className="min-w-0 flex-1">
      <div className="flex max-w-[1100px] flex-col gap-6 px-4 pt-7 pb-12 lg:px-10">
        <div>
          <div className="text-[13px] font-semibold text-muted-foreground">Billing · {curLabel}</div>
          <h1 className="mt-1 text-[28px] font-extrabold">Plan and payments</h1>
        </div>

        <section role="status" className={cn("rounded-xl border px-5 py-4", tone)}>
          <h2 className="text-base font-extrabold">{banner.title}</h2>
          <p className="mt-1 text-sm">{banner.body}</p>
        </section>
        {error && (
          <p role="alert" className="rounded-md border border-[#F2C6C2] bg-[#FBEAE9] px-4 py-3 text-sm font-semibold text-[#7A1F18]">
            {error}
          </p>
        )}
        {!ready && <p className="rounded-md bg-secondary px-4 py-3 text-sm text-ink-2">Card payments aren&apos;t set up on this server yet (FLUTTERWAVE_SECRET_KEY). Plans are shown for reference.</p>}

        <div>
          <h2 className="text-lg font-extrabold">Priced per student, per term</h2>
          <p className="mt-1 text-sm text-ink-2">
            {b.activeStudents} students in classes now. Pay by card, bank transfer or USSD through Flutterwave.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {PLANS.map((p) => {
            const paidThis = b.paidPlan === p.code;
            const below = b.paidPlan ? RANK[p.code] < RANK[b.paidPlan] : false;
            const upgrade = b.paidPlan && RANK[p.code] > RANK[b.paidPlan] ? planByCode(b.paidPlan) : null;
            const total = (p.naira - (upgrade?.naira ?? 0)) * 100 * b.activeStudents;
            return (
              <section key={p.code} aria-label={`${p.name} plan`} className={cn("flex flex-col gap-3 rounded-xl border bg-card p-6", want === p.code || paidThis ? "border-2 border-ink" : "border-border")}>
                <div className="flex items-center gap-2">
                  <h3 className="flex-1 text-lg font-extrabold">{p.name}</h3>
                  {paidThis && <span className="rounded-full bg-[#E8F4EC] px-2.5 py-1 text-xs font-bold text-[#155E34]">Paid this term</span>}
                  {b.status === "trial" && p.code === "premium" && <span className="rounded-full bg-[#EAF1F9] px-2.5 py-1 text-xs font-bold text-[#1D4B80]">Your trial</span>}
                </div>
                <p className="text-sm text-ink-2">{p.blurb}</p>
                <div>
                  <span className="font-mono text-3xl font-semibold">₦{p.naira.toLocaleString("en-NG")}</span>
                  <span className="text-sm text-muted-foreground"> / student / term</span>
                </div>
                <ul className="flex flex-1 flex-col gap-1.5 text-sm">
                  {p.includes.map((x) => (
                    <li key={x} className="flex gap-2">
                      <span aria-hidden className="font-bold text-[#155E34]">
                        ✓
                      </span>
                      {x}
                    </li>
                  ))}
                </ul>
                {paidThis || below ? (
                  <p className="text-[13px] font-semibold text-muted-foreground">{paidThis ? `Paid for ${curLabel}.` : "Already covered by your plan."}</p>
                ) : (
                  <form action={checkoutAction.bind(null, schoolSlug, p.code)}>
                    <div className="mb-2.5 rounded-md bg-background px-3 py-2 text-sm">
                      {upgrade ? `Upgrade from ${upgrade.name}: ` : `For ${b.activeStudents} students: `}
                      <b className="font-mono">{naira(total)}</b> {upgrade ? "difference" : "this term"}
                    </div>
                    <button type="submit" disabled={!ready || b.activeStudents < 1 || b.status === "suspended"} className="h-12 w-full rounded-md bg-ink text-[15px] font-bold text-white disabled:opacity-50">
                      {upgrade ? `Upgrade to ${p.name}` : `Pay for ${p.name}`}
                    </button>
                  </form>
                )}
              </section>
            );
          })}
        </div>

        <section aria-labelledby="hist">
          <h2 id="hist" className="mb-2.5 text-lg font-extrabold">
            Payments
          </h2>
          {history.length ? (
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
                {history.map((h) => (
                  <tr key={h.id} className="border-t border-divider">
                    <td className="px-4 py-2.5 font-mono text-[13px]">{formatDate(h.paidAt ?? h.createdAt)}</td>
                    <td data-label="Plan" className="px-4 py-2.5">{planByCode(h.plan).name}</td>
                    <td data-label="Students" className="px-4 py-2.5 text-right font-mono">{h.studentCount}</td>
                    <td data-label="Amount" className="px-4 py-2.5 text-right font-mono">{naira(h.amount)}</td>
                    <td data-label="Status" className="px-4 py-2.5">{h.status === "paid" ? "✓ Paid" : h.status === "failed" ? "✕ Failed" : "Not completed"}</td>
                    <td data-label="Reference" className="px-4 py-2.5 font-mono text-xs">{h.reference}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">No payments yet.</p>
          )}
        </section>
      </div>
    </main>
  );
}
