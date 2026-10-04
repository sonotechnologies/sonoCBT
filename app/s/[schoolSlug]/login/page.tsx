import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { SchoolBrandHeader } from "@/components/school-header";
import { getSchoolBySlug, getTenantContext } from "@/lib/tenant/context";
import { StudentSignInForm } from "./student-sign-in-form";

export async function generateMetadata({ params }: PageProps<"/s/[schoolSlug]/login">): Promise<Metadata> {
  const school = await getSchoolBySlug((await params).schoolSlug);
  return { title: school ? `Student sign in · ${school.name}` : "Student sign in" };
}

export default async function StudentLoginPage({ params }: PageProps<"/s/[schoolSlug]/login">) {
  const { schoolSlug } = await params;
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) notFound();

  const ctx = await getTenantContext(schoolSlug);
  if (ctx) redirect(ctx.isStaff ? `/s/${schoolSlug}/dashboard` : `/s/${schoolSlug}/student`);

  return (
    <main className="flex flex-1 flex-col bg-background">
      <SchoolBrandHeader school={school} />
      <div className="flex flex-1 justify-center">
        <div className="flex w-full max-w-[520px] flex-col justify-center gap-4 px-5 py-8 sm:px-16">
          <div>
            <h1 className="text-2xl font-extrabold">Student sign in</h1>
            <p className="mt-1 text-[15px] text-ink-2">Use the details on your school ID card.</p>
          </div>
          <StudentSignInForm schoolSlug={schoolSlug} />
          <p className="text-sm text-muted-foreground">Forgot your password? Ask your form teacher to reset it.</p>
        </div>
      </div>
      <footer className="flex items-center justify-between border-t border-border px-5 py-3.5 text-xs text-muted-foreground sm:px-7">
        <Link href="/" className="underline-offset-2 hover:underline">
          Wrong school?
        </Link>
        <span className="flex items-center gap-1.5">
          Powered by <Logo size={13} />
        </span>
      </footer>
    </main>
  );
}
