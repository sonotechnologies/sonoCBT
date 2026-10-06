import { redirect } from "next/navigation";
import { BillingBanner } from "@/components/billing/banner";
import { DemoBanner } from "@/components/demo/banner";
import { getBilling } from "@/lib/billing/context";
import { planFor, type Feature } from "@/lib/billing/plans";
import { hasFeature } from "@/lib/billing/state";
import { signOut } from "@/lib/auth/actions";
import { endSupportAction } from "@/lib/platform/actions";
import { can, ROLE_LABEL, STAFF_ROLES, type Action } from "@/lib/auth/permissions";
import { getCurrentTerm } from "@/lib/data/terms";
import { countAwaitingReview } from "@/lib/questions/service";
import { termLabel } from "@/lib/format";
import { requireStaff } from "@/lib/tenant/context";
import { MobileNav, StaffSidebar, type NavItem } from "./staff-sidebar";

export default async function StaffLayout({ children, params }: LayoutProps<"/s/[schoolSlug]">) {
  const { schoolSlug } = await params;
  const ctx = await requireStaff(schoolSlug);
  if (ctx.user.mustChangePassword) redirect(`/s/${schoolSlug}/change-password`);

  const [current, awaiting, billing] = await Promise.all([getCurrentTerm(ctx.scope), countAwaitingReview(ctx.scope, ctx.actor), getBilling(ctx.school.id)]);
  const lockedBadge = (f: Feature) => (hasFeature(billing, f) ? {} : { badge: planFor(f).name });
  const base = `/s/${schoolSlug}`;
  // Sections light up as their phases ship.
  const allowed = (action: Action) => can(ctx.actor, action, { schoolId: ctx.school.id });
  const isFormTeacher = ctx.actor.roles.some((r) => r.role === "form_teacher");
  const items: NavItem[] = [
    { label: "Dashboard", href: `${base}/dashboard` },
    ...(allowed("student.manage") || isFormTeacher ? [{ label: "Students", href: `${base}/students` }] : []),
    ...(allowed("staff.manage") ? [{ label: "Staff", href: `${base}/staff` }] : []),
    ...(allowed("question.create")
      ? [{ label: "Question bank", href: `${base}/questions`, badge: awaiting ? String(awaiting) : undefined }]
      : []),
    ...(allowed("question.create") ? [{ label: "Smart import", href: `${base}/import` }] : []),
    ...(allowed("exam.manage") || ctx.actor.roles.some((r) => r.role === "hod") ? [{ label: "Exams", href: `${base}/exams` }] : []),
    { label: "Live monitor", href: `${base}/monitor` },
    { label: "Marking", href: `${base}/marking` },
    { label: "CA & broadsheet", href: `${base}/results/classes` },
    ...(allowed("results.review") || allowed("results.release") ? [{ label: "Results", href: `${base}/results` }] : []),
    ...(allowed("analytics.view") || ctx.actor.roles.some((r) => r.role === "teacher" || r.role === "hod") ? [{ label: "Analytics", href: `${base}/analytics`, ...lockedBadge("analytics") }] : []),
    ...(allowed("results.review") || allowed("results.release") || isFormTeacher ? [{ label: "Report cards", href: `${base}/report-cards`, ...lockedBadge("report_cards") }] : []),
    ...(allowed("school.manage") ? [{ label: "School setup", href: `${base}/setup/details` }] : []),
    ...(allowed("billing.manage") ? [{ label: "Billing", href: `${base}/billing`, ...(billing.status === "grace" || billing.status === "lapsed" ? { badge: "Due" } : {}) }] : []),
  ];
  const primaryRole = ctx.actor.roles.find((r) => STAFF_ROLES.has(r.role))?.role;
  const signOutAction = signOut.bind(null, "/login");
  const sidebar = {
    schoolName: ctx.school.name,
    termLabel: current ? termLabel(current.number, current.sessionName, " · ") : "No term set",
    userName: ctx.user.name,
    userRole: primaryRole ? ROLE_LABEL[primaryRole] : "Staff",
    items,
  };

  return (
    <div className="flex min-h-dvh min-w-0 flex-1">
      <div className="sticky top-0 hidden h-dvh flex-none lg:block print:hidden">
        <StaffSidebar {...sidebar} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-border bg-card px-4 lg:static lg:px-8 print:hidden">
          <span className="flex min-w-0 items-center gap-2 lg:hidden">
            <MobileNav {...sidebar} />
            <span className="truncate text-sm font-bold">{ctx.school.name}</span>
          </span>
          <span className="hidden text-sm font-semibold text-ink-2 lg:block">{ctx.school.name}</span>
          <form action={signOutAction}>
            <button type="submit" className="h-10 rounded-md px-3 text-sm font-semibold text-ink-2 hover:bg-secondary">
              Sign out
            </button>
          </form>
        </header>
        {ctx.school.isDemo && <DemoBanner />}
        {ctx.supportBy && (
          <form action={endSupportAction.bind(null, ctx.school.id)} role="status" className="flex flex-wrap items-center gap-3 bg-[#7A1F18] px-4 py-2.5 text-sm font-semibold text-white lg:px-8 print:hidden">
            <span>Support session: you are signed in as {ctx.user.name} at {ctx.school.name}. Everything you do is logged.</span>
            <button type="submit" className="rounded-md bg-white px-3 py-1 text-[13px] font-bold text-[#7A1F18]">
              End support session
            </button>
          </form>
        )}
        <BillingBanner billing={billing} slug={schoolSlug} canManage={allowed("billing.manage")} />
        {children}
      </div>
    </div>
  );
}
