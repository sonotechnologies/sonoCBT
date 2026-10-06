import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { InstallAppButton } from "@/components/pwa/install";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { school, student } from "@/lib/db/schema";
import { StudentChoice } from "./student-choice";

export const metadata: Metadata = { title: "Open SonoCBT", robots: { index: false } };

/**
 * Where the installed app opens. Signed in: straight to that person's home.
 * Signed out: staff, student or parent.
 */
export default async function Start() {
  const s = await getAuth().api.getSession({ headers: await headers() });
  if (s) {
    const schoolId = (s.user as { schoolId?: string | null }).schoolId;
    if (!schoolId) redirect("/platform");
    const db = getDb();
    const [[sch], [kid]] = await Promise.all([
      db.select({ slug: school.slug }).from(school).where(eq(school.id, schoolId)).limit(1),
      db.select({ id: student.id }).from(student).where(eq(student.userId, s.user.id)).limit(1),
    ]);
    if (sch) redirect(`/s/${sch.slug}/${kid ? "student" : "dashboard"}`);
  }

  const choice = "flex min-h-[72px] w-full flex-col justify-center rounded-xl border border-border bg-card px-5 py-3.5 text-left text-foreground no-underline hover:border-ink";
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-background px-5 py-10">
      <div className="flex w-full max-w-[400px] flex-col gap-3">
        <div className="mb-3 flex flex-col items-center gap-3 text-center">
          <Logo size={34} />
          <h1 className="text-xl font-extrabold">Who&apos;s signing in?</h1>
        </div>
        <Link href="/login" className={choice}>
          <span className="text-base font-extrabold">Staff</span>
          <span className="text-sm text-ink-2">Teachers, exam officers and school admins</span>
        </Link>
        <StudentChoice className={choice} />
        <Link href="/results" className={choice}>
          <span className="text-base font-extrabold">Parent</span>
          <span className="text-sm text-ink-2">Check a result with a scratch-card PIN</span>
        </Link>
        <InstallAppButton className="mt-3" />
      </div>
    </main>
  );
}
