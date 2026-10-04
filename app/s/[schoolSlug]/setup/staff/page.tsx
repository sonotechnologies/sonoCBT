import { InviteForm, StaffList } from "@/components/staff/staff-manager";
import { inviteOptions, listStaff } from "@/lib/staff/list";
import { requireCan } from "@/lib/tenant/context";
import { StepPage } from "../step-shell";

export default async function StaffStep({ params }: PageProps<"/s/[schoolSlug]/setup/staff">) {
  const { schoolSlug } = await params;
  const { scope } = await requireCan(schoolSlug, "school.manage");
  const [rows, options] = await Promise.all([listStaff(scope), inviteOptions(scope)]);
  return (
    <StepPage base={`/s/${schoolSlug}/setup`} step="staff">
      <StaffList slug={schoolSlug} rows={rows} />
      <InviteForm slug={schoolSlug} subjects={options.subjects} arms={options.arms} />
    </StepPage>
  );
}
