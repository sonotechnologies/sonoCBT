import type { Metadata } from "next";
import { Locked } from "@/components/billing/locked";
import { getBilling } from "@/lib/billing/context";
import { hasFeature } from "@/lib/billing/state";
import type { Feature } from "@/lib/billing/plans";
import Link from "next/link";
import { aiConfigured } from "@/lib/ai";
import { formatDate } from "@/lib/format";
import { listImportJobs } from "@/lib/import/service";
import { editorChoices } from "@/lib/questions/editor-data";
import { requireCan } from "@/lib/tenant/context";
import { AiGenerateForm, PhotoImportForm, SheetImportForm, WordImportForm } from "./import-forms";

export const metadata: Metadata = { title: "Smart import" };

const KIND = { word: "Word", photo: "Photos", sheet: "Spreadsheet", ai: "AI" } as const;

export default async function SmartImportPage({ params }: PageProps<"/s/[schoolSlug]/import">) {
  const { schoolSlug } = await params;
  const ctx = await requireCan(schoolSlug, "question.create");
  const [choices, jobs] = await Promise.all([editorChoices(ctx), listImportJobs(ctx.scope, ctx.actor)]);
  const c = { subjects: choices.subjects, levels: choices.levels, defaultSubjectId: choices.mySubjectIds[0] ?? "" };
  const aiReady = aiConfigured();
  const billing = await getBilling(ctx.school.id);
  const has = (f: Feature) => hasFeature(billing, f);
  const admin = ctx.actor.roles.some((r) => r.role === "school_admin");

  return (
    <main className="flex min-w-0 flex-col gap-6 p-4 lg:p-8">
      <div>
        <div className="text-[13px] font-semibold text-muted-foreground">Question bank</div>
        <h1 className="text-[28px] font-extrabold">Smart import</h1>
        <p className="text-sm text-ink-2">Paste your Word doc, get a ready exam. Every question is checked by you before it reaches the bank.</p>
      </div>

      {jobs.length > 0 && (
        <section aria-labelledby="recent" className="flex flex-col gap-2">
          <h2 id="recent" className="eyebrow">
            Recent imports
          </h2>
          <ul className="overflow-hidden rounded-lg border border-border bg-card">
            {jobs.map((j) => (
              <li key={j.id} className="border-t border-divider first:border-t-0">
                <Link href={`/s/${schoolSlug}/import/${j.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm no-underline hover:bg-background">
                  <span className="rounded bg-chip px-2 py-0.5 font-mono text-[11px] font-semibold">{KIND[j.kind]}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold">{j.title}</span>
                  <span className="text-ink-2">{j.subjectName}</span>
                  <span className="font-mono text-[13px]">
                    {j.savedCount}/{j.total} added
                  </span>
                  <span className="text-xs text-muted-foreground">{j.status === "saved" ? "Done" : "In review"} · {formatDate(j.updatedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {has("smart_import") ? <WordImportForm slug={schoolSlug} c={c} /> : <Locked compact feature="smart_import" billing={billing} slug={schoolSlug} canManage={admin} />}
        {has("smart_import") && <SheetImportForm slug={schoolSlug} c={c} />}
        {has("photo_import") ? <PhotoImportForm slug={schoolSlug} c={c} aiReady={aiReady} /> : <Locked compact feature="photo_import" billing={billing} slug={schoolSlug} canManage={admin} />}
        {has("ai_assistant") ? <AiGenerateForm slug={schoolSlug} c={c} aiReady={aiReady} /> : <Locked compact feature="ai_assistant" billing={billing} slug={schoolSlug} canManage={admin} />}
      </div>
    </main>
  );
}
