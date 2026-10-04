import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { ComponentsEditor, ScaleEditor } from "@/components/results/setup-client";
import { can } from "@/lib/auth/permissions";
import { getCurrentTerm, listTerms } from "@/lib/data/terms";
import { scoreEntry } from "@/lib/db/schema";
import { getScale, listComponents } from "@/lib/results/pipeline";
import { requireStaff } from "@/lib/tenant/context";

export const metadata: Metadata = { title: "Results setup" };

export default async function ResultsSetupPage({ params, searchParams }: PageProps<"/s/[schoolSlug]/results/setup">) {
  const { schoolSlug } = await params;
  const sp = await searchParams;
  const ctx = await requireStaff(schoolSlug);
  if (!can(ctx.actor, "school.manage", { schoolId: ctx.school.id })) notFound();
  const terms = await listTerms(ctx.scope);
  const term = terms.find((t) => t.id === sp.term) ?? (await getCurrentTerm(ctx.scope));
  if (!term) return <main className="p-8 text-sm text-ink-2">Set up a session and term first.</main>;
  const [components, scale, used] = await Promise.all([
    listComponents(ctx.scope, term.id),
    getScale(ctx.scope),
    ctx.scope.query((db, owns) =>
      db
        .select({ componentId: scoreEntry.componentId, n: sql<number>`count(*)::int` })
        .from(scoreEntry)
        .where(owns(scoreEntry, eq(scoreEntry.termId, term.id)))
        .groupBy(scoreEntry.componentId),
    ),
  ]);
  return (
    <main className="min-w-0 flex-1 overflow-auto">
      <div className="flex max-w-[860px] flex-col gap-6 px-4 pt-7 pb-12 lg:px-10">
        <div>
          <div className="text-[13px] font-semibold text-muted-foreground">Results · Setup</div>
          <h1 className="mt-1 text-[28px] font-extrabold">How results are worked out</h1>
        </div>
        <ComponentsEditor
          slug={schoolSlug}
          termId={term.id}
          termLabel={term.label}
          initial={components.map((c) => ({ id: c.id, name: c.name, weight: c.weight }))}
          used={Object.fromEntries(used.map((u) => [u.componentId, u.n]))}
        />
        <ScaleEditor slug={schoolSlug} initial={scale.bands} />
        <p className="text-[13px] text-muted-foreground">
          Positions: students with the same average share a position and the next one is skipped (1st, 2nd, 2nd, 4th). The class average is over the subjects each student took.
        </p>
      </div>
    </main>
  );
}
