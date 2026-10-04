import type { Metadata } from "next";
import Link from "next/link";
import { PromotionPlanner } from "@/components/students/promotion-planner";
import { formatDate } from "@/lib/format";
import { promotionPlan } from "@/lib/students/moves";
import { requireCan } from "@/lib/tenant/context";

export const metadata: Metadata = { title: "Promote students" };

export default async function PromotePage({ params }: PageProps<"/s/[schoolSlug]/students/promote">) {
  const { schoolSlug } = await params;
  const ctx = await requireCan(schoolSlug, "student.manage");
  const plan = await promotionPlan(ctx.scope, ctx.actor);
  const done = plan.alreadyPromoted ? `${plan.alreadyPromoted.who ?? "Someone"} promoted students for ${plan.term?.session} on ${formatDate(plan.alreadyPromoted.at)}.` : null;

  return (
    <main className="min-w-0 flex-1">
      <div className="flex max-w-[1000px] flex-col gap-5 px-4 pt-7 pb-12 lg:px-10">
        <div>
          <div className="text-[13px] font-semibold text-muted-foreground">
            <Link href={`/s/${schoolSlug}/students`} className="text-muted-foreground">
              Students
            </Link>{" "}
            · {plan.term ? `${plan.term.session}` : "No session"}
          </div>
          <h1 className="mt-1 text-[28px] font-extrabold">Promote to the next class</h1>
          <p className="mt-1 max-w-[680px] text-sm text-ink-2">
            At the start of a new session, move every class up at once. Each class goes to the matching class a level up and the final year graduates; change any class, or open its exceptions to keep a student back or record that they left.
          </p>
        </div>
        {!plan.ready ? (
          <section role="status" className="rounded-xl border border-[#F3D3B5] bg-[#FDF1E6] p-5 text-[#7A3B0A]">
            <h2 className="text-base font-extrabold">Start the new session first</h2>
            <p className="mt-1.5 text-sm">
              Promotion moves students into the new session&apos;s classes.{" "}
              {plan.term ? `The current term is ${["", "1st", "2nd", "3rd"][plan.term.number]} Term ${plan.term.session}. ` : ""}
              In School setup → Session, add the next session and make its 1st term current, then come back here.
            </p>
            <Link href={`/s/${schoolSlug}/setup/session`} className="mt-3 inline-block text-sm font-bold text-[#7A3B0A]">
              Go to School setup → Session
            </Link>
          </section>
        ) : !plan.classes.length ? (
          <p className="text-sm text-muted-foreground">No students are on a class register yet.</p>
        ) : (
          <>
            {done && (
              <p role="status" className="rounded-md border border-[#C5D6EA] bg-[#EAF1F9] px-4 py-3 text-sm font-semibold text-[#1D4B80]">
                {done} Only promote again if something went wrong.
              </p>
            )}
            <PromotionPlanner slug={schoolSlug} plan={{ classes: plan.classes, arms: plan.arms }} sessionName={plan.term!.session} alreadyPromoted={done} />
          </>
        )}
      </div>
    </main>
  );
}
