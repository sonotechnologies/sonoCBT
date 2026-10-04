import type { Metadata } from "next";
import { asc, eq, ne } from "drizzle-orm";
import { Logo } from "@/components/brand/logo";
import { DEFAULT_SCHOOL_COLOR } from "@/components/school-header";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { Photo } from "@/components/ui/photo";
import { listTerms } from "@/lib/data/terms";
import { getDb } from "@/lib/db";
import { resultBatch, school as schoolTable } from "@/lib/db/schema";
import { getSchoolBySlug } from "@/lib/tenant/context";
import { tenantScope } from "@/lib/tenant/scope";
import { CheckResultForm } from "./check-form";

export const metadata: Metadata = {
  title: "Check a result",
  description: "Parents: check your child's released result with the PIN from your school.",
};

export default async function ResultsPage({ searchParams }: PageProps<"/results">) {
  const { school: slug } = await searchParams;
  const school = typeof slug === "string" ? await getSchoolBySlug(slug) : null;
  return school && school.status !== "suspended" ? <SchoolChecker school={school} /> : <PickSchool />;
}

/** P1 · school-branded checker (reached from the school's link). */
async function SchoolChecker({ school }: { school: NonNullable<Awaited<ReturnType<typeof getSchoolBySlug>>> }) {
  const scope = tenantScope(getDb(), school.id);
  const [terms, released] = await Promise.all([
    listTerms(scope),
    scope.findMany(resultBatch, eq(resultBatch.status, "released")),
  ]);
  const releasedTermIds = new Set(released.map((r) => r.termId));
  const defaultTermId = terms.find((t) => releasedTermIds.has(t.id))?.id ?? terms[0]?.id;

  return (
    <main className="flex min-h-dvh flex-1 flex-col bg-background">
      <div className="h-1.5 flex-none" style={{ background: school.brandColor ?? DEFAULT_SCHOOL_COLOR }} />
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-[480px] items-center gap-3 p-[22px]">
          <Photo src={school.logoUrl} alt={`${school.name} logo`} className="size-10 rounded-md" />
          <div>
            <div className="text-sm font-extrabold">{school.name}</div>
            <div className="text-xs text-muted-foreground">Result checker</div>
          </div>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-[480px] flex-1 flex-col gap-4 px-[22px] py-[26px]">
        <h1 className="text-[22px] font-extrabold">Check your child&apos;s result</h1>
        {terms.length ? (
          <CheckResultForm
            schoolSlug={school.slug}
            terms={terms.map((t) => ({ id: t.id, label: t.label.replace(" Term ", " Term · ") }))}
            defaultTermId={defaultTermId}
          />
        ) : (
          <p className="text-[15px] text-ink-2">This school hasn&apos;t published any results yet.</p>
        )}
      </div>
    </main>
  );
}

/** L4 · generic entry at /results: choose the school first. */
async function PickSchool() {
  const schools = await getDb()
    .select({ slug: schoolTable.slug, name: schoolTable.name, locality: schoolTable.locality })
    .from(schoolTable)
    .where(ne(schoolTable.status, "suspended"))
    .orderBy(asc(schoolTable.name));

  return (
    <main className="flex min-h-dvh flex-1 flex-col bg-background">
      <header className="flex h-14 flex-none items-center border-b border-border bg-card px-5">
        <Logo size={20} />
      </header>
      <form method="get" className="mx-auto flex w-full max-w-[480px] flex-1 flex-col gap-3.5 px-5 py-6">
        <div>
          <h1 className="text-2xl font-extrabold">Check a result</h1>
          <p className="mt-1 text-[15px] leading-normal text-ink-2">
            Use the PIN from your scratch card or the link your school sent.
          </p>
        </div>
        <Field label="School">
          <Select name="school" required defaultValue="">
            <option value="" disabled>
              Choose your child&apos;s school
            </option>
            {schools.map((s) => (
              <option key={s.slug} value={s.slug}>
                {[s.name, s.locality].filter(Boolean).join(", ")}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" className="mt-1 h-[52px] text-base">
          Continue
        </Button>
        <p className="text-[13px] leading-normal text-muted-foreground">Each PIN works 5 times for one student and one term.</p>
      </form>
    </main>
  );
}
