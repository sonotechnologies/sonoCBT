import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { setupProgress } from "@/lib/school/progress";
import { requireCan } from "@/lib/tenant/context";
import { WizardSteps } from "./wizard-steps";

export const metadata: Metadata = { title: "Set up your school" };

export default async function SetupLayout({ children, params }: LayoutProps<"/s/[schoolSlug]/setup">) {
  const { schoolSlug } = await params;
  const ctx = await requireCan(schoolSlug, "school.manage");
  const done = await setupProgress(ctx.scope, ctx.school);

  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-background">
      <header className="flex h-16 flex-none items-center gap-4 border-b border-border bg-card px-4 lg:px-8">
        <Logo size={22} />
        <span className="hidden h-6 w-px bg-border sm:block" />
        <span className="hidden truncate text-sm font-semibold text-ink-2 sm:block">Set up {ctx.school.name}</span>
        <span className="flex-1" />
        <span className="hidden text-[13px] text-muted-foreground md:block">Progress saves as you go</span>
        <Link href={`/s/${schoolSlug}/dashboard`} className="text-[13px] font-semibold text-ink-2 underline">
          Exit setup
        </Link>
      </header>
      <div className="grid flex-1 grid-cols-[minmax(0,1fr)] lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="border-b border-border px-4 pt-5 pb-1 lg:border-r lg:border-b-0 lg:px-6 lg:py-8">
          <WizardSteps base={`/s/${schoolSlug}/setup`} done={done} />
        </aside>
        <main className="flex min-w-0 flex-col px-4 py-8 lg:px-[clamp(24px,5vw,72px)] lg:py-12">{children}</main>
      </div>
    </div>
  );
}
