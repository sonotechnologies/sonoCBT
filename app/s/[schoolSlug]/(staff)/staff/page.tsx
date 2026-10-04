import type { Metadata } from "next";
import Link from "next/link";
import { InviteForm, StaffList } from "@/components/staff/staff-manager";
import { buttonVariants } from "@/components/ui/button";
import { inviteOptions, listStaff } from "@/lib/staff/list";
import { requireCan } from "@/lib/tenant/context";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Staff" };

export default async function StaffPage({ params }: PageProps<"/s/[schoolSlug]/staff">) {
  const { schoolSlug } = await params;
  const { scope } = await requireCan(schoolSlug, "staff.manage");
  const [rows, options] = await Promise.all([listStaff(scope), inviteOptions(scope)]);
  return (
    <main className="flex min-w-0 max-w-[960px] flex-col gap-5 p-4 lg:p-8">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <h1 className="text-[28px] font-extrabold">Staff</h1>
          <p className="text-sm text-ink-2">Each person gets an email to set their password. Roles decide what they can see.</p>
        </div>
        <Link href={`/s/${schoolSlug}/staff/departments`} className={cn(buttonVariants({ variant: "outline", size: "md" }))}>
          Departments
        </Link>
        <Link href={`/s/${schoolSlug}/staff/allocation`} className={cn(buttonVariants({ variant: "outline", size: "md" }))}>
          Who teaches what
        </Link>
      </div>
      <div>
        <StaffList slug={schoolSlug} rows={rows} />
        <InviteForm slug={schoolSlug} subjects={options.subjects} arms={options.arms} />
      </div>
    </main>
  );
}
