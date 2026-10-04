import type { Metadata } from "next";
import { Logo } from "@/components/brand/logo";
import { getSchoolBySlug } from "@/lib/tenant/context";

export const metadata: Metadata = { title: "Account suspended", robots: { index: false } };

export default async function SuspendedPage({ searchParams }: PageProps<"/suspended">) {
  const { school: slug } = await searchParams;
  const school = typeof slug === "string" ? await getSchoolBySlug(slug) : null;
  return (
    <main className="flex min-h-dvh flex-1 flex-col bg-background">
      <header className="flex h-14 flex-none items-center border-b border-border bg-card px-5">
        <Logo size={20} />
      </header>
      <div className="mx-auto flex max-w-[480px] flex-1 flex-col justify-center gap-3 px-5 py-10 text-center">
        <h1 className="text-2xl font-extrabold">{school ? `${school.name}'s account is paused` : "This account is paused"}</h1>
        <p className="text-[15px] leading-relaxed text-ink-2">
          SonoCBT has suspended this school&apos;s account, so staff and students can&apos;t sign in for now. Nothing has been deleted. The school&apos;s proprietor can contact us at hello@sonocbt.ng to sort it out.
        </p>
      </div>
    </main>
  );
}
