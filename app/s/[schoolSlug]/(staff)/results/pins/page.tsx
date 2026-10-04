import type { Metadata } from "next";
import Link from "next/link";
import { PinGenerator } from "@/components/results/pin-generator";
import { getCurrentTerm, listTerms } from "@/lib/data/terms";
import { formatDate, formatTime } from "@/lib/format";
import { pinBatches, pinUsage } from "@/lib/results/pins";
import { requireCan } from "@/lib/tenant/context";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Result PINs" };

export default async function ResultPinsPage({ params, searchParams }: PageProps<"/s/[schoolSlug]/results/pins">) {
  const { schoolSlug } = await params;
  const sp = await searchParams;
  const ctx = await requireCan(schoolSlug, "resultPins.manage");
  const terms = await listTerms(ctx.scope);
  const term = terms.find((t) => t.id === sp.term) ?? (await getCurrentTerm(ctx.scope));
  if (!term) return <main className="p-8 text-sm text-ink-2">Set up a session and term first.</main>;
  const [batches, usage] = await Promise.all([pinBatches(ctx.scope, ctx.actor, term.id), pinUsage(ctx.scope, ctx.actor, term.id)]);

  return (
    <main className="min-w-0 flex-1 overflow-auto">
      <div className="flex max-w-[960px] flex-col gap-6 px-4 pt-7 pb-12 lg:px-10">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[220px] flex-1">
            <div className="text-[13px] font-semibold text-muted-foreground">
              <Link href={`/s/${schoolSlug}/results?term=${term.id}`} className="text-muted-foreground">
                Results
              </Link>{" "}
              · PINs
            </div>
            <h1 className="mt-1 text-[28px] font-extrabold">Result-checker PINs</h1>
            <p className="mt-1 text-sm text-ink-2">
              Parents check at <span className="font-mono">/results?school={ctx.school.slug}</span> with the admission number and a PIN.
            </p>
          </div>
          <nav aria-label="Term" className="flex w-full flex-wrap gap-1.5">
            {terms.slice(0, 4).map((t) => (
              <Link key={t.id} href={`?term=${t.id}`} aria-current={t.id === term.id ? "page" : undefined} className={cn("h-9 rounded-md border px-3 text-[13px] leading-[34px] font-semibold no-underline", t.id === term.id ? "border-ink bg-ink text-white" : "border-border bg-card text-foreground")}>
                {t.label}
              </Link>
            ))}
          </nav>
        </div>

        <PinGenerator key={term.id} slug={schoolSlug} termId={term.id} termLabel={term.label} />

        <section aria-labelledby="batches-title">
          <h2 id="batches-title" className="mb-2.5 text-lg font-extrabold">
            Batches
          </h2>
          {batches.length ? (
            <table className="w-full overflow-hidden rounded-xl border border-border bg-card text-sm">
              <thead className="bg-secondary text-left text-xs text-ink-2">
                <tr>
                  <th className="px-4 py-2.5">Batch</th>
                  <th className="px-4 py-2.5">Serials</th>
                  <th className="px-4 py-2.5 text-right">PINs</th>
                  <th className="px-4 py-2.5 text-right">Used</th>
                  <th className="px-4 py-2.5 text-right">Used up</th>
                  <th className="px-4 py-2.5">Made</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.batch} className="border-t border-divider">
                    <td className="px-4 py-2.5 font-mono font-semibold">{b.batch}</td>
                    <td className="px-4 py-2.5 font-mono text-[13px]">
                      {b.first}
                      {b.count > 1 ? ` – ${b.last.slice(-6)}` : ""}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono">{b.count}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{b.used}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{b.usedUp}</td>
                    <td className="px-4 py-2.5 text-[13px] text-ink-2">
                      {formatDate(new Date(b.createdAt))}
                      {b.by ? ` · ${b.by}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">No PINs for {term.label} yet.</p>
          )}
        </section>

        <section aria-labelledby="usage-title">
          <h2 id="usage-title" className="mb-2.5 text-lg font-extrabold">
            Usage log
          </h2>
          {usage.length ? (
            <table className="w-full overflow-hidden rounded-xl border border-border bg-card text-sm">
              <thead className="bg-secondary text-left text-xs text-ink-2">
                <tr>
                  <th className="px-4 py-2.5">Serial</th>
                  <th className="px-4 py-2.5">Student</th>
                  <th className="px-4 py-2.5 text-right">Views</th>
                  <th className="px-4 py-2.5">Last used</th>
                </tr>
              </thead>
              <tbody>
                {usage.map((u) => (
                  <tr key={u.serial} className="border-t border-divider">
                    <td className="px-4 py-2.5 font-mono">{u.serial}</td>
                    <td className="px-4 py-2.5">
                      {u.studentName ?? "—"} {u.admissionNo && <span className="font-mono text-[13px] text-muted-foreground">{u.admissionNo}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono">
                      {u.uses} of {u.maxUses}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[13px]">{u.lastUsedAt ? `${formatDate(u.lastUsedAt)} ${formatTime(u.lastUsedAt)}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">No PIN has been used for {term.label} yet.</p>
          )}
        </section>
      </div>
    </main>
  );
}
